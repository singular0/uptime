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
 * The intervals, the downtime and the duration (the tested time, without the paused time)
 * are limited to the time the targets were tested during the period, i.e. from the first test
 * of any target to the latest test of any target.
 */
IntervalBuilder.prototype.build = async function(begin, end) {
  begin = this.getTimestamp(begin);
  end = this.getTimestamp(end);
  await this.determineInitialState(begin);
  await this.buildIntervalsForPeriod(begin, end);
  // the state at the end of the period lasts until the end of the period
  this.completeCurrentInterval(end);
  const tested = await this.getTestedRange();
  if (tested) {
    const testedBegin = Math.max(begin, tested.firstTested);
    const testedEnd = Math.min(end, tested.lastTested);
    this.clipIntervals(testedBegin, testedEnd);
    this.duration = Math.max(0, testedEnd - testedBegin - this.sumIntervals(PAUSED));
  } else {
    // never tested
    this.intervals = [];
    this.duration = 0;
  }
  this.downtime = this.sumIntervals(DOWN);
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
      return interval[0] < interval[1]; // also drops everything when begin > end (not tested during the period)
    });
};

IntervalBuilder.prototype.sumIntervals = function(state) {
  return this.intervals.reduce(function(sum, interval) {
    return interval[2] == state ? sum + interval[1] - interval[0] : sum;
  }, 0);
};

/**
 * Resolves to { firstTested, lastTested }, the timestamps of the first test of any target
 * and of the latest test of any target, or to null when no target was ever tested.
 */
IntervalBuilder.prototype.getTestedRange = async function() {
  const checks = await Check
    .find({ _id: { $in: this.objectIds }, firstTested: { $ne: null }, lastTested: { $ne: null } })
    .select({ firstTested: 1, lastTested: 1 });
  if (!checks.length) return null;
  return {
    firstTested: Math.min(...checks.map(function(check) { return check.firstTested.getTime(); })),
    lastTested: Math.max(...checks.map(function(check) { return check.lastTested.getTime(); }))
  };
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
  if (paused == this.nbObjects) {
    return PAUSED; // all the targets are paused (or not tested yet)
  }
  if ((ups + paused) == this.nbObjects) {
    return UP; // the paused targets are ignored
  }
  return DOWN; // at least one of the targets is down
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
