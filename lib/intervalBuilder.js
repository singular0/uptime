const CheckEvent = require('../models/checkEvent');
const Check = require('../models/check');

const PAUSED = -1;
const DOWN = 0;
const UP = 1;

/*
 * Usage:
 *   var builder = new IntervalBuilder();
 *   builder.addTarget(check1);
 *   builder.addTarget(check2);
 *   const { intervals, downtime, duration } = await builder.build(begin, end);
 */
var IntervalBuilder = function() {
  this.objectIds = [];
  this.nbObjects = 0;
  this.states = {};
  this.intervals = []; // intervals are [begin, end, state]
  this.currentState = null;
  this.currentInterval = [];
  this.downtime = 0;
  this.duration = 0;
};

IntervalBuilder.prototype.addTarget = function(objectId) {
  this.objectIds.push(objectId._id ? objectId._id : objectId);
  this.nbObjects++;
};

/**
 * Build the outage intervals of the targets between two timestamps.
 *
 * Resolves to { intervals, downtime, duration }: the intervals are
 * [begin, end, state] arrays, downtime and duration are in milliseconds.
 *
 * For a single check, the intervals, the downtime and the duration (the tested time,
 * without the paused time) are limited to the time the check was tested during the period,
 * i.e. from its first test to its latest test.
 */
IntervalBuilder.prototype.build = async function(begin, end) {
  begin = this.getTimestamp(begin);
  end = this.getTimestamp(end);
  await this.determineInitialState(begin);
  await this.buildIntervalsForPeriod(begin, end);
  // the state at the end of the period lasts until the end of the period
  this.completeCurrentInterval(end);
  const check = await this.getCurrentCheck();
  if (this.isMultiTarget()) {
    // it's a tag - no other way than using the tested time of its first check
    this.duration = Math.min(end, check.lastTested) - Math.max(begin, check.firstTested);
    this.downtime = this.currentState == DOWN ? this.duration : 0;
  } else {
    this.clipIntervals(Math.max(begin, check.firstTested), Math.min(end, check.lastTested));
    this.duration = this.calculateTestedTime(check, begin, end);
    this.downtime = this.sumIntervals(DOWN);
  }
  return { intervals: this.intervals, downtime: this.downtime, duration: this.duration };
};

/**
 * Limit the intervals to the [begin, end] range, and drop the intervals outside of it.
 */
IntervalBuilder.prototype.clipIntervals = function(begin, end) {
  this.intervals = this.intervals
    .map(function(interval) {
      return [Math.max(begin, interval[0]), Math.min(end, interval[1]), interval[2]];
    })
    .filter(function(interval) {
      return interval[0] < interval[1]; // also drops everything when begin or end is NaN (check never tested)
    });
};

IntervalBuilder.prototype.sumIntervals = function(state) {
  return this.intervals.reduce(function(sum, interval) {
    return interval[2] == state ? sum + interval[1] - interval[0] : sum;
  }, 0);
};

/**
 * Time during which a single check was tested and not paused, once the intervals are clipped.
 */
IntervalBuilder.prototype.calculateTestedTime = function(check, begin, end) {
  if (!check.firstTested || !check.lastTested) return 0;
  const testedTime = Math.min(end, check.lastTested) - Math.max(begin, check.firstTested);
  return Math.max(0, testedTime - this.sumIntervals(PAUSED));
};


IntervalBuilder.prototype.getCurrentCheck = function() {
  return Check.findOne({ _id: this.objectIds[0] });
};


IntervalBuilder.prototype.isMultiTarget = function() {
  return this.nbObjects > 1;
};

IntervalBuilder.prototype.determineInitialState = async function(timestamp) {
  const self = this;
  await Promise.all(this.objectIds.map(async function(objectId) {
    const checkEvent = await CheckEvent
      .findOne({ check: objectId, timestamp: { $lte: timestamp } })
      .sort({ timestamp: -1 });
    if (!checkEvent) {
      // No ping ever - start the period as paused
      self.addEvent(objectId, 'paused', timestamp);
      return;
    }
    self.addEvent(objectId, checkEvent.message);
  }));
  this.updateCurrentState(timestamp);
};

IntervalBuilder.prototype.buildIntervalsForPeriod = async function(begin, end) {
  const self = this;
  const checkEvents = await CheckEvent
    .find({ check: { $in: this.objectIds }, timestamp: { $gt: begin, $lte: end } })
    .sort({ timestamp: 1 });
  checkEvents.forEach(function(checkEvent) {
    if (self.addEvent(checkEvent.check, checkEvent.message)) {
      self.updateCurrentState(checkEvent.timestamp);
    }
  });
};

/**
 * Add an event for a given check.
 *
 * Returns true if the event modifies the state of a given check, false otherwise
 */
IntervalBuilder.prototype.addEvent = function(objectId, message) {
  switch (message) {
    case 'up':
      if (!this.isUp(objectId)) {
        this.states[objectId] = UP;
        return true;
      }
      break;
    case 'down':
      if (!this.isDown(objectId)) {
        this.states[objectId] = DOWN;
        return true;
      }
      break;
    case 'paused':
    case 'restarted':
    default:
      if (!this.isPaused(objectId)) {
        this.states[objectId] = PAUSED;
        return true;
      }
      break;
  }
  return false;
};

/**
 * Return true if the global state was updated, false otherwise.
 */
IntervalBuilder.prototype.updateCurrentState = function(timestamp) {
  timestamp = this.getTimestamp(timestamp);
  var currentState = this.getGlobalState();
  if (currentState !== this.currentState) {
    this.completeCurrentInterval(timestamp);
    this.currentInterval = currentState == 1 ? [] : [timestamp];
    this.currentState = currentState;
    return true;
  }
  return false;
};

IntervalBuilder.prototype.getGlobalState = function() {
  var ups = 0;
  var paused = 0;
  for (var objectId in this.states) {
    if (this.isUp(objectId)) ups++;
    if (this.isPaused(objectId)) paused++;
  }
  if (!this.isMultiTarget() && paused > 0) {
    return PAUSED; // global state is paused because there is only one check
  }
  if ((ups + paused) == this.nbObjects) {
    return UP; // ignore paused in multiTarget
  }
  return DOWN; // at least one of the targets is paused
};

IntervalBuilder.prototype.isUp = function(objectId) {
  return this.states[objectId] == UP;
};

IntervalBuilder.prototype.isDown = function(objectId) {
  return this.states[objectId] == DOWN;
};

IntervalBuilder.prototype.isPaused = function(objectId) {
  return this.states[objectId] == PAUSED;
};

IntervalBuilder.prototype.getTimestamp = function(date) {
  return date.valueOf ? date.valueOf() : date;
};

IntervalBuilder.prototype.completeCurrentInterval = function(timestamp) {
  if (this.currentInterval.length != 1) {
    // no current interval - ignore
    return false;
  }
  if (this.currentState == DOWN) {
    this.downtime += timestamp - this.currentInterval[0];
  }

  this.intervals.push(this.currentInterval.concat([timestamp, this.currentState]));
  return true;
};

module.exports = IntervalBuilder;
