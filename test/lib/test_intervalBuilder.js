const should = require('should');
const mongoose = require('../../bootstrap');
const IntervalBuilder = require('../../lib/intervalBuilder');
const Ping = require('../../models/ping');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');

let check1, check2, now; // fixtures

const removeAll = function() {
  return Promise.all([
    Ping.collection.deleteMany({}),
    Check.collection.deleteMany({}),
    CheckEvent.collection.deleteMany({})
  ]);
};

describe('intervalBuilder', function() {

  before(removeAll);

  before(function() {
    now = Date.now();
  });

  before(async function() {
    check1 = new Check();
    await check1.save();
    await Ping.createForCheck(false, now - 3000, 100, check1, 'dummy1', '', null);
    await Ping.createForCheck(false, now - 2000, 100, check1, 'dummy2', '', null);
    await Ping.createForCheck(true,  now - 1000, 100, check1, 'dummy3', '', null);
    await Ping.createForCheck(true,  now,        100, check1, 'dummy4', '', null);
    await Ping.createForCheck(true,  now + 1000, 100, check1, 'dummy5', '', null);
    await Ping.createForCheck(false, now + 2000, 100, check1, 'dummy6', '', null);
    await Ping.createForCheck(true,  now + 3000, 100, check1, 'dummy7', '', null);
  });

  before(async function() {
    check2 = new Check();
    await check2.save();
  });

  describe('addTarget', function() {

    it('should accept Check objects', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check1);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(1);
    });

    it('should accept Check identifiers', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check1._id);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(1);
    });

  });

  describe('#determineInitialState', function() {

    it('should set initial state to PAUSED for new Checks', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check2);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(-1);
    });

    it('should set the initial state according to the latest ping', async function() {
      const builder = new IntervalBuilder(check1);
      builder.addTarget(check1);
      await builder.determineInitialState(now);
      builder.currentState.should.eql(1);
    });

  });

  describe('#build', function() {

    it('should return a full pause array when there is no ping at all', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check2);
      const { intervals } = await builder.build(now, now + 1000);
      intervals.should.eql([[now, now + 1000, -1]]);
    });

    it('should return an empty array when there is no down ping', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check1);
      const { intervals } = await builder.build(now + 3000, now + 6000);
      intervals.should.eql([]);
    });

    it('should return a period ending at the end of the lookup period when the latest ping is down', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check1);
      const { intervals } = await builder.build(now - 2500, now - 2000);
      intervals.should.eql([ [now - 2500, now - 2000, 0] ]);
    });

    it('should return an outage period even if the state at the beginning and at the end are up', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check1);
      const { intervals } = await builder.build(now - 1000, now + 3000);
      intervals.should.eql([ [ now + 2000, now + 3000, 0]]);
    });

    it('should return several periods when an uptime period lies in the middle of the interval', async function() {
      const builder = new IntervalBuilder();
      builder.addTarget(check1);
      const { intervals } = await builder.build(now - 4000, now + 3000);
      intervals.should.eql([ [now - 4000, now - 3000, -1], [now - 3000, now - 1000, 0], [now + 2000, now + 3000, 0] ]);
    });
  });

  after(removeAll);
});
