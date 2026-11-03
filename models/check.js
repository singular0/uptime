const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const moment   = require('moment');

// models dependencies
const Ping             = require('../models/ping');
const CheckEvent       = require('../models/checkEvent');
const CheckHourlyStat  = require('../models/checkHourlyStat');
const CheckDailyStat   = require('../models/checkDailyStat');
const CheckMonthlyStat = require('../models/checkMonthlyStat');
const CheckYearlyStat  = require('../models/checkYearlyStat');
const Tag              = require('../models/tag');

// main model
const Check = new Schema({
  name        : String,
  type        : String,
  url         : String,
  interval    : { type: Number, default: 60000 }, // interval between two pings
  maxTime     : { type: Number, default: 1500 },  // time under which a ping is considered responsive
  alertTreshold : { type: Number, default: 1 },   // nb of errors from which to trigger a new CheckEvent
  errorCount  : { type: Number, default: 0 },     // count number of errors
  tags        : [String],
  lastChanged : Date,
  firstTested : Date,
  lastTested  : Date,
  isUp        : Boolean,
  isPaused    : { type: Boolean, default: false },
  uptime      : { type: Number, default: 0 },
  downtime    : { type: Number, default: 0 },
  qos         : {},
  pollerParams : Schema.Types.Mixed
});
Check.plugin(require('./plugins/lifecycle'));

Check.pre('deleteOne', { document: true, query: false }, async function() {
  // related data removal is best effort and never prevents the check deletion
  await Promise.allSettled([this.removePings(), this.removeEvents(), this.removeStats()]);
});

Check.methods.setPollerParam = function(name, value) {
  if (!this.pollerParams) this.pollerParams = {};
  this.pollerParams[name] = value;
  this.markModified('pollerParams');
};

Check.methods.getPollerParam = function(name) {
  if (!this.pollerParams) return;
  return this.pollerParams[name];
};

Check.methods.removePings = function() {
  return Ping.deleteMany({ check: this._id });
};

Check.methods.removeEvents = function() {
  return CheckEvent.deleteMany({ check: this._id });
};

Check.methods.removeStats = function() {
  return Promise.all([
    CheckHourlyStat.deleteMany({ check: this._id }),
    CheckDailyStat.deleteMany({ check: this._id }),
    CheckMonthlyStat.deleteMany({ check: this._id }),
    CheckYearlyStat.deleteMany({ check: this._id })
  ]);
};

Check.methods.needsPoll = function() {
  if (this.isPaused) return false;
  if (!this.firstTested) return true;
  const delay = (this.lastTested.getTime() - this.firstTested.getTime()) % this.interval;
  return (Date.now() - this.lastTested.getTime() + delay) >= (this.interval || 60000);
};

Check.methods.togglePause = function() {
  this.isPaused = !this.isPaused;
  if (!this.isPaused) {
    // restarted
    this.isUp = undefined;
  }
  this.lastChanged = new Date();
};

Check.methods.setLastTest = function(status, time, error) {
  const now = time ? new Date(time) : new Date();
  const mustNotifyEvent = this.mustNotifyEvent(status);
  // state before this test, to measure the downtime when the check comes back up
  const wasDown = this.isUp === false;
  const previousChange = this.lastChanged;

  if (!this.firstTested) {
    this.firstTested = now;
  }

  this.lastTested = now;

  if (this.isUp != status) {
    this.lastChanged = now;
    this.isUp = status;
    this.uptime = 0;
    this.downtime = 0;
  }

  if (mustNotifyEvent) {
    const event = new CheckEvent({
      timestamp: now,
      check: this._id,
      tags: this.tags,
      message: status ? 'up' : 'down',
      details: error
    });
    if (status && wasDown && previousChange) {
      // Check comes back up
      event.downtime = now.getTime() - previousChange.getTime();
    }
    // errors are logged and never reject, see Ping.createForCheck()
    this.$locals.lastEventSave = event.save().catch(function(err) { console.error(err); });
    this.markEventNotified();
  }
  const durationSinceLastChange = now.getTime() - this.lastChanged.getTime();
  if (status) {
    this.uptime = durationSinceLastChange;
  } else {
    this.downtime = durationSinceLastChange;
  }
  return this;
};

Check.methods.mustNotifyEvent = function(status) {
  if (!this.firstTested) {
    return true;
  }
  if (!status) {
    // check is down
    if (this.isUp != status) {
      // check goes down for the first time
      this.errorCount = 1;
    }
    if (this.errorCount < this.alertTreshold) {
      // repeated down pings - increase error count until reaching the down alert treshold
      this.errorCount++;
      return false;
    }
    if (this.errorCount === this.alertTreshold) {
      // enough down pings to trigger notification
      return true;
    }
    // error count higher than treshold, that means the alert was already sent
    return false;
  }
  // check is up
  if (this.isUp != status && this.errorCount > this.alertTreshold) {
    // check goes up after reaching the down alert treshold before
    return true;
  }
  // check either goes up after less than alertTreshold down pings, or is already up for long
  return false;
};

Check.methods.markEventNotified = function() {
  // increase error count to disable notification if the next ping has the same status
  this.errorCount = this.alertTreshold + 1;
};

Check.methods.getQosPercentage = function() {
  if (!this.qos) return false;
  return (this.qos.ups / this.qos.count) * 100;
};

Check.methods.updateUptime = async function() {
  const latestPing = await Ping.findOne({ check: this._id }).sort({ timestamp: -1 });
  if (!latestPing) return;
  this.lastTested = latestPing.timestamp;
  this.isUp = latestPing.isUp;
  // lastChanged is the latest ping with the opposite status,
  // or the first ping if the check never changed status
  const latestChangePing = await Ping
    .findOne({ check: this._id, isUp: !latestPing.isUp, timestamp: { $lt: latestPing.timestamp } })
    .sort({ timestamp: -1 });
  const changePing = latestChangePing || await Ping.findOne({ check: this._id }).sort({ timestamp: 1 });
  const duration = latestPing.timestamp.getTime() - changePing.timestamp.getTime();
  this.lastChanged = changePing.timestamp;
  if (latestPing.isUp) {
    this.uptime = duration;
    this.downtime = 0;
  } else {
    this.uptime = 0;
    this.downtime = duration;
  }
  return this.save();
};

const statProvider = {
  'hour':  { model: 'Ping', beginMethod: 'resetHour', endMethod: 'completeHour' },
  'day':   { model: 'CheckHourlyStat', beginMethod: 'resetDay', endMethod: 'completeDay', duration: 60 * 60 * 1000 },
  'month': { model: 'CheckDailyStat', beginMethod: 'resetMonth', endMethod: 'completeMonth', duration: 24 * 60 * 60 * 1000 },
  'year':  { model: 'CheckMonthlyStat', beginMethod: 'resetYear', endMethod: 'completeYear' }
};

Check.methods.getStatsForPeriod = async function(period, begin, end) {
  const periodPrefs = statProvider[period];
  const query = { check: this._id, timestamp: { $gte: begin, $lte: end } };
  const stats = await this.db.model(periodPrefs['model']).find(query).sort({ timestamp: -1 });
  return stats.map(function(stat) {
    if (typeof stat.isUp != 'undefined') {
      // stat is a Ping
      return stat;
    }
    // stat is an aggregation
    return {
      timestamp: Date.parse(stat.timestamp),
      availability: (stat.availability * 100).toFixed(3),
      responsiveness: (stat.responsiveness * 100).toFixed(3),
      downtime: parseInt(stat.downtime / 1000),
      responseTime: parseInt(stat.responseTime),
      outages: stat.outages || [],
      end: stat.end ? stat.end.valueOf() : (Date.parse(stat.timestamp) + periodPrefs['duration'])
    };
  });
};

const singleStatsProvider = {
  'hour':  'CheckHourlyStat',
  'day':   'CheckDailyStat',
  'month': 'CheckMonthlyStat',
  'year':  'CheckYearlyStat'
};

Check.methods.getSingleStatForPeriod = async function(period, date) {
  const model = singleStatsProvider[period];
  const begin = moment(date).clone().startOf(period).toDate();
  const end   = moment(date).clone().endOf(period).toDate();
  const query = { check: this._id, timestamp: { $gte: begin, $lte: end } };
  const stat = await this.db.model(model).findOne(query);
  if (!stat) return;
  return {
    timestamp: Date.parse(stat.timestamp),
    availability: (stat.availability * 100).toFixed(3),
    responsiveness: (stat.responsiveness * 100).toFixed(3),
    downtime: parseInt(stat.downtime / 1000),
    responseTime: parseInt(stat.responseTime),
    outages: stat.outages || [],
    begin: begin.valueOf(),
    end: end.valueOf()
  };
};

Check.methods.populateFromDirtyCheck = function(dirtyCheck, pollerCollection) {
  this.url = dirtyCheck.url || this.url;
  this.maxTime = dirtyCheck.maxTime || this.maxTime;
  this.isPaused = dirtyCheck.isPaused || this.isPaused;
  this.alertTreshold = dirtyCheck.alertTreshold || this.alertTreshold;
  this.interval = dirtyCheck.interval * 1000 || this.interval;

  if (typeof(dirtyCheck.name) !== 'undefined' && dirtyCheck.name.length) {
      this.name = dirtyCheck.name;
  } else if (typeof(this.name) === 'undefined' || !this.name.length ) {
      this.name = dirtyCheck.url;
  }

  if (typeof(dirtyCheck.tags) != 'undefined') {
    this.tags = this.constructor.convertTags(dirtyCheck.tags);
  }

  if (typeof(this.url) == 'undefined') {
    throw new Error('URL must be defined');
  }

  if (dirtyCheck.type) {
    if (!pollerCollection.getForType(dirtyCheck.type).validateTarget(this.url)) {
      throw new Error('URL ' + this.url + ' and poller type ' + dirtyCheck.type + ' mismatch');
    }
    this.type = dirtyCheck.type;
  } else {
    this.type = pollerCollection.guessTypeForUrl(this.url);
  }
};

Check.statics.getAllTags = async function() {
  const res = await this.aggregate([
    { $unwind: "$tags" },
    { $group: {
      _id: null,
      tags: { $addToSet: "$tags" }
    } }
  ]);
  return res.length ? res[0].tags : [];
};

Check.statics.findForTag = function(tag) {
  return this.find().where('tags').equals(tag);
};

Check.statics.convertTags = function(tags) {
  if (typeof(tags) === 'string') {
    if (tags) {
      tags = tags.replace(/\s*,\s*/g, ',').split(',');
    } else {
      tags = [];
    }
  }
  return tags;
};

/**
 * Calls a function for all checks that need to be polled.
 *
 * A check needs to be polled if it was last polled since a longer time than its own interval.
 *
 * @param {Function} Callback function to be called with each Check
 * @api   public
 */
Check.statics.callForChecksNeedingPoll = function(callback) {
  this.needingPoll().cursor()
    .on('data', callback)
    .on('error', function(err) { console.error(err); });
};

/**
 * Query for the checks that need to be polled, i.e. the checks for which
 * Check.methods.needsPoll() returns true, evaluated by the database.
 */
Check.statics.needingPoll = function() {
  const now = new Date();
  return this.find({
    isPaused: { $ne: true },
    $or: [
      { firstTested: null }, // never tested
      { $expr: { $cond: {
        if: { $gt: ['$interval', 0] },
        then: { $gte: [
          { $add: [
            { $subtract: [now, '$lastTested'] },
            // delay: keep polls aligned on the first test date
            { $mod: [{ $subtract: ['$lastTested', '$firstTested'] }, '$interval'] }
          ] },
          '$interval'
        ] },
        else: false
      } } }
    ]
  });
};

module.exports = mongoose.model('Check', Check);
