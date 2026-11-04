const mongoose = require('mongoose');
const Schema   = mongoose.Schema;
const moment   = require('moment');

// model dependencies
const TagHourlyStat    = require('./tagHourlyStat');
const TagDailyStat     = require('./tagDailyStat');
const TagMonthlyStat   = require('./tagMonthlyStat');
const TagYearlyStat    = require('./tagYearlyStat');
const CheckHourlyStat  = require('./checkHourlyStat');
const CheckDailyStat   = require('./checkDailyStat');
const CheckMonthlyStat = require('./checkMonthlyStat');
const CheckYearlyStat  = require('./checkYearlyStat');
require('./check'); // registers the Check model; required again lazily below, as it requires this module

// main model
const Tag = new Schema({
  name           : String,
  firstTested    : Date,
  lastUpdated    : Date,
  count          : Number,
  availability   : Number,
  responsiveness : Number,
  responseTime   : Number,
  downtime       : Number,
  outages        : Array,
});
Tag.index({ name: 1 }, { unique: true });
Tag.plugin(require('./plugins/lifecycle'));

Tag.pre('deleteOne', { document: true, query: false }, async function() {
  // stats removal is best effort and never prevents the tag deletion
  await this.removeStats().catch(function() {});
});

Tag.methods.removeStats = function() {
  return Promise.all([
    TagHourlyStat.deleteMany({ name: this.name }),
    TagDailyStat.deleteMany({ name: this.name }),
    TagMonthlyStat.deleteMany({ name: this.name }),
    TagYearlyStat.deleteMany({ name: this.name })
  ]);
};

Tag.methods.getChecks = function() {
  const Check = require('./check');
  return Check.find({ tags: this.name });
};

Tag.methods.getFirstTested = async function() {
  let firstTested = Infinity;
  const checks = await this.getChecks();
  checks.forEach(function(check) {
    if (!check.firstTested) return;
    firstTested = Math.min(firstTested, check.firstTested);
  });
  return firstTested;
};

const statProvider = {
  'day':   { model: 'TagHourlyStat', duration: 60 * 60 * 1000 },
  'month': { model: 'TagDailyStat', duration: 24 * 60 * 60 * 1000 },
  'year':  { model: 'TagMonthlyStat' }
};

Tag.methods.getStatsForPeriod = async function(period, begin, end) {
  const periodPrefs = statProvider[period];
  const query = { name: this.name, timestamp: { $gte: begin, $lte: end } };
  const stats = await this.db.model(periodPrefs['model']).find(query).sort({ timestamp: -1 });
  return stats.map(function(stat) {
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
  'hour':  'TagHourlyStat',
  'day':   'TagDailyStat',
  'month': 'TagMonthlyStat',
  'year':  'TagYearlyStat'
};

Tag.methods.getSingleStatsForPeriod = async function(period, date) {
  const model = singleStatsProvider[period];
  const begin = moment(date).clone().startOf(period).toDate();
  const end   = moment(date).clone().endOf(period).toDate();
  const query = { name: this.name, timestamp: { $gte: begin, $lte: end } };
  const stat = await this.db.model(model).findOne(query);
  if (!stat) return;
  return {
    timestamp: Date.parse(stat.timestamp),
    availability: (stat.availability * 100).toFixed(3),
    responsiveness: (stat.responsiveness * 100).toFixed(3),
    downtime: stat.downtime / 1000,
    responseTime: Math.round(stat.responseTime),
    outages: stat.outages || [],
    begin: begin.valueOf(),
    end: end.valueOf()
  };
};

const checkProvider = {
  'hour':  { model: 'CheckHourlyStat', duration: 60 * 60 * 1000 },
  'day':   { model: 'CheckDailyStat', duration: 24 * 60 * 60 * 1000 },
  'month': { model: 'CheckMonthlyStat' },
  'year':  { model: 'CheckYearlyStat'}
};

Tag.methods.getChecksForPeriod = async function(period, date) {
  const periodPrefs = checkProvider[period];
  const stats = {};
  const checkNames = [];
  const begin = moment(date).clone().startOf(period).toDate();
  const end   = moment(date).clone().endOf(period).toDate();
  const checks = await this.db.model('Check').find({ tags: this.name }).select('_id');
  const ids = checks.map(function(doc) { return doc._id; });
  const query = { check: { $in: ids }, timestamp: { $gte: begin, $lte: end } };
  const checkStats = await this.db.model(periodPrefs['model']).find(query).populate('check');
  checkStats.forEach(function(stat) {
    stats[stat.check.name] = {
      timestamp: Date.parse(stat.timestamp),
      availability: (stat.availability * 100).toFixed(3),
      responsiveness: (stat.responsiveness * 100).toFixed(3),
      downtime: parseInt(stat.downtime / 1000),
      responseTime: parseInt(stat.responseTime),
      outages: stat.outages || [],
      end: stat.end ? stat.end.valueOf() : (Date.parse(stat.timestamp) + periodPrefs['duration']),
      check: stat.check
    };
    checkNames.push(stat.check.name);
  });
  checkNames.sort();
  return checkNames.map(function(checkName) {
    return stats[checkName];
  });
};

Tag.statics.ensureTagsHaveFirstTestedDate = async function() {
  const tags = await this.find({ firstTested: { $exists: false } });
  await Promise.all(tags.map(async function(tag) {
    const firstTested = await tag.getFirstTested();
    if (firstTested == Infinity) return; // no check of this tag was tested yet
    tag.firstTested = firstTested;
    await tag.save();
  }));
};

Tag.statics.removeOrphanTags = async function() {
  const Check = require('./check');
  const tags = await this.find();
  const usedTags = await Check.getAllTags();
  await Promise.all(tags.map(function(tag) {
    if (usedTags.indexOf(tag.name) !== -1) return;
    return tag.deleteOne();
  }));
};

module.exports = mongoose.model('Tag', Tag);
