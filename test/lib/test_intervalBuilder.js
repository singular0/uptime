const should = require('should');
const mongoose = require('../../bootstrap');
const IntervalBuilder = require('../../lib/intervalBuilder');
const Ping = require('../../models/ping');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const { clear } = require('../helpers');

const PAUSED = -1;
const DOWN = 0;

describe('intervalBuilder', function() {

  // fixtures: timestamps are relative to now, in milliseconds
  let now, flapping, neverTested, stillDown, paused, alwaysUp, lateStarter, pausedToo;

  const createPings = async function(check, pings) {
    for (const [offset, isUp] of pings) {
      await Ping.createForCheck(isUp, now + offset, 100, check, 'dummy', isUp ? '' : 'error', null);
    }
  };

  const build = function(targets, begin, end) {
    const builder = new IntervalBuilder();
    targets.forEach(function(target) { builder.addTarget(target); });
    return builder.build(now + begin, now + end);
  };

  // intervals relative to now, easier to read in assertions
  const relative = function(intervals) {
    return intervals.map(function(interval) { return [interval[0] - now, interval[1] - now, interval[2]]; });
  };

  before(function() {
    return clear(Ping, Check, CheckEvent);
  });

  before(async function() {
    now = Date.now();
    // events: down at -3000, up at -1000, down at +2000, up at +3000
    flapping = await new Check({ name: 'flapping' }).save();
    await createPings(flapping, [[-3000, false], [-2000, false], [-1000, true], [0, true], [1000, true], [2000, false], [3000, true]]);

    neverTested = await new Check({ name: 'never tested' }).save();

    // events: up at -3000, down at -2500, up at -2000, down at -1000; last tested at -500
    stillDown = await new Check({ name: 'still down' }).save();
    await createPings(stillDown, [[-3000, true], [-2500, false], [-2000, true], [-1000, false], [-500, false]]);

    // paused events are created by the API, not by pings
    paused = await new Check({ name: 'paused', firstTested: new Date(now - 3000), lastTested: new Date(now), isUp: true }).save();
    await CheckEvent.insertMany([
      { check: paused._id, timestamp: new Date(now - 3000), message: 'up' },
      { check: paused._id, timestamp: new Date(now - 2000), message: 'paused' },
      { check: paused._id, timestamp: new Date(now - 1000), message: 'up' }
    ]);

    alwaysUp = await new Check({ name: 'always up' }).save();
    await createPings(alwaysUp, [[-3000, true], [3000, true]]);

    // events: up at 1000; last tested at 3000
    lateStarter = await new Check({ name: 'late starter' }).save();
    await createPings(lateStarter, [[1000, true], [3000, true]]);

    // paused from -2500 to -1500, which overlaps the pause of the 'paused' check
    pausedToo = await new Check({ name: 'paused too', firstTested: new Date(now - 3000), lastTested: new Date(now), isUp: true }).save();
    await CheckEvent.insertMany([
      { check: pausedToo._id, timestamp: new Date(now - 3000), message: 'up' },
      { check: pausedToo._id, timestamp: new Date(now - 2500), message: 'paused' },
      { check: pausedToo._id, timestamp: new Date(now - 1500), message: 'up' }
    ]);
  });

  after(function() {
    return clear(Ping, Check, CheckEvent);
  });

  describe('addTarget', function() {

    it('should accept Check objects', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(flapping);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(1);
    });

    it('should accept Check identifiers', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(flapping._id);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(1);
    });

  });

  describe('#determineInitialState', function() {

    it('should set initial state to PAUSED for new Checks', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(neverTested);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(PAUSED);
    });

    it('should set the initial state according to the latest event', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(flapping);
      await builder.determineInitialState(now - 2000);
      builder.currentState.should.eql(DOWN);
    });

  });

  describe('#build', function() {

    it('should return no interval and no tested time when the check was never tested', async function() {
      const result = await build([neverTested], 0, 1000);
      result.should.eql({ intervals: [], downtime: 0, duration: 0 });
    });

    it('should return no interval when the check stays up', async function() {
      const result = await build([flapping], -1000, 1000);
      result.should.eql({ intervals: [], downtime: 0, duration: 2000 });
    });

    it('should close the outage at the end of the period when the check is down at the end, even if it is up now', async function() {
      const { intervals, downtime, duration } = await build([flapping], -2500, -2000);
      relative(intervals).should.eql([[-2500, -2000, DOWN]]);
      downtime.should.eql(500);
      duration.should.eql(500);
    });

    it('should return an outage period even if the state at the beginning and at the end are up', async function() {
      const { intervals, downtime, duration } = await build([flapping], -1000, 3000);
      relative(intervals).should.eql([[2000, 3000, DOWN]]);
      downtime.should.eql(1000);
      duration.should.eql(4000);
    });

    it('should return several outage periods, and ignore the time before the first test', async function() {
      const { intervals, downtime, duration } = await build([flapping], -4000, 3000);
      relative(intervals).should.eql([[-3000, -1000, DOWN], [2000, 3000, DOWN]]);
      downtime.should.eql(3000);
      duration.should.eql(6000);
    });

    it('should ignore the time after the latest test', async function() {
      const { intervals, downtime, duration } = await build([stillDown], -1500, 1000);
      relative(intervals).should.eql([[-1000, -500, DOWN]]);
      downtime.should.eql(500);
      duration.should.eql(1000);
    });

    it('should not count the up time between two outages as downtime', async function() {
      const { intervals, downtime, duration } = await build([stillDown], -3000, 1000);
      relative(intervals).should.eql([[-2500, -2000, DOWN], [-1000, -500, DOWN]]);
      downtime.should.eql(1000);
      duration.should.eql(2500);
    });

    it('should return pause periods, and not count them as tested time', async function() {
      const { intervals, downtime, duration } = await build([paused], -3000, 0);
      relative(intervals).should.eql([[-2000, -1000, PAUSED]]);
      downtime.should.eql(0);
      duration.should.eql(2000);
    });

    it('should consider several targets down as soon as one of them is down', async function() {
      const { intervals } = await build([flapping, alwaysUp], -4000, 3000);
      relative(intervals).should.eql([[-3000, -1000, DOWN], [2000, 3000, DOWN]]);
    });

    it('should count the outages of several targets as downtime, even if they are all up at the end of the period', async function() {
      const { downtime, duration } = await build([flapping, alwaysUp], -4000, 3000);
      downtime.should.eql(3000);
      duration.should.eql(6000);
    });

    it('should not count the whole period as downtime when one of several targets is down at the end', async function() {
      const { intervals, downtime, duration } = await build([flapping, alwaysUp], -4000, 2500);
      relative(intervals).should.eql([[-3000, -1000, DOWN], [2000, 2500, DOWN]]);
      downtime.should.eql(2500);
      duration.should.eql(5500);
    });

    it('should use the tested time of all the targets, from the first test of any of them to the latest', async function() {
      const { intervals, downtime, duration } = await build([stillDown, lateStarter], -4000, 4000);
      relative(intervals).should.eql([[-2500, -2000, DOWN], [-1000, 3000, DOWN]]);
      downtime.should.eql(4500);
      duration.should.eql(6000);
    });

    it('should return pause periods when all the targets are paused, and not count them as tested time', async function() {
      const { intervals, downtime, duration } = await build([paused, pausedToo], -3000, 0);
      relative(intervals).should.eql([[-2000, -1500, PAUSED]]);
      downtime.should.eql(0);
      duration.should.eql(2500);
    });

    it('should return no interval and no tested time when none of the targets was ever tested', async function() {
      const neverTestedToo = await new Check({ name: 'never tested too' }).save();
      const result = await build([neverTested, neverTestedToo], 0, 1000);
      result.should.eql({ intervals: [], downtime: 0, duration: 0 });
    });

  });

});
