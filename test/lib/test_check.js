const should = require('should');
const mongoose = require('../../bootstrap');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const CheckHourlyStat = require('../../models/checkHourlyStat');
const Ping = require('../../models/ping');
const { clear } = require('../helpers');

const minute = 60 * 1000;

describe('Check', function() {

  beforeEach(function() {
    return clear(Check, CheckEvent, CheckHourlyStat, Ping);
  });

  after(function() {
    return clear(Check, CheckEvent, CheckHourlyStat, Ping);
  });

  describe('#togglePause()', function() {

    it('should pause and restart the check', function() {
      const check = new Check({ isUp: false, lastChanged: new Date(0) });
      check.togglePause();
      check.isPaused.should.be.true();
      check.isUp.should.be.false();
      check.lastChanged.getTime().should.be.above(0);
      check.togglePause();
      check.isPaused.should.be.false();
      should(check.isUp).be.undefined(); // the status is unknown until the next ping
    });

  });

  describe('.convertTags()', function() {

    it('should split a comma separated string', function() {
      Check.convertTags('foo, bar ,baz').should.eql(['foo', 'bar', 'baz']);
      Check.convertTags('').should.eql([]);
    });

    it('should keep arrays unchanged', function() {
      Check.convertTags(['foo', 'bar']).should.eql(['foo', 'bar']);
    });

  });

  describe('.getAllTags()', function() {

    it('should return the tags of all checks without duplicates', async function() {
      await Check.create([{ tags: ['foo', 'bar'] }, { tags: ['bar', 'baz'] }, { tags: [] }]);
      (await Check.getAllTags()).sort().should.eql(['bar', 'baz', 'foo']);
    });

    it('should return an empty array when there is no tag', async function() {
      (await Check.getAllTags()).should.eql([]);
    });

  });

  describe('#updateUptime()', function() {

    it('should compute the status since the latest ping with the opposite status', async function() {
      const now = Date.now();
      const check = await new Check({ name: 'check' }).save();
      await Ping.create([
        { check: check._id, timestamp: new Date(now - 3 * minute), isUp: true },
        { check: check._id, timestamp: new Date(now - 2 * minute), isUp: false },
        { check: check._id, timestamp: new Date(now - minute), isUp: false }
      ]);
      await check.updateUptime();
      const saved = await Check.findById(check._id);
      saved.isUp.should.be.false();
      saved.lastTested.getTime().should.eql(now - minute);
      saved.lastChanged.getTime().should.eql(now - 3 * minute);
      saved.downtime.should.eql(2 * minute);
      saved.uptime.should.eql(0);
    });

    it('should use the first ping when the status never changed', async function() {
      const now = Date.now();
      const check = await new Check({ name: 'check' }).save();
      await Ping.create([
        { check: check._id, timestamp: new Date(now - 3 * minute), isUp: true },
        { check: check._id, timestamp: new Date(now - minute), isUp: true }
      ]);
      await check.updateUptime();
      const saved = await Check.findById(check._id);
      saved.isUp.should.be.true();
      saved.uptime.should.eql(2 * minute);
    });

  });

  describe('#deleteOne()', function() {

    it('should remove the pings, events and stats of the check only', async function() {
      const [check, other] = await Check.create([{ name: 'deleted' }, { name: 'kept' }]);
      for (const c of [check, other]) {
        await Ping.create({ check: c._id, isUp: true });
        await CheckEvent.create({ check: c._id, message: 'up' });
        await CheckHourlyStat.create({ check: c._id, timestamp: new Date() });
      }
      await check.deleteOne();
      (await Check.find()).map(function(c) { return c.name; }).should.eql(['kept']);
      for (const model of [Ping, CheckEvent, CheckHourlyStat]) {
        const remaining = await model.find();
        remaining.map(function(doc) { return String(doc.check); }).should.eql([other.id]);
      }
    });

  });

  describe('.needingPoll()', function() {

    it('should return the same checks as #needsPoll()', async function() {
      const now = Date.now();
      const minute = 60 * 1000;
      const fixtures = {
        'never tested': {},
        'never tested, paused': { isPaused: true },
        'tested long ago': { firstTested: new Date(now - 60 * minute), lastTested: new Date(now - 10 * minute) },
        'tested long ago, paused': { isPaused: true, firstTested: new Date(now - 60 * minute), lastTested: new Date(now - 10 * minute) },
        // the delay ((lastTested - firstTested) % interval) aligns the polls on the first test
        'tested recently': { firstTested: new Date(now - 10 * 1000 - 59 * minute), lastTested: new Date(now - 10 * 1000) },
        'tested recently, with delay due': { interval: 5 * minute, firstTested: new Date(now - minute - 64.5 * minute), lastTested: new Date(now - minute) },
        'tested recently, with delay not due': { interval: 5 * minute, firstTested: new Date(now - minute - 61 * minute), lastTested: new Date(now - minute) },
        'zero interval': { interval: 0, firstTested: new Date(now - 60 * minute), lastTested: new Date(now - 10 * minute) },
        'tested but never polled': { firstTested: new Date(now - 60 * minute) }
      };
      const checks = await Promise.all(Object.keys(fixtures).map(function(name) {
        return new Check(Object.assign({ name: name }, fixtures[name])).save();
      }));
      const expected = checks.filter(function(check) {
        try {
          return check.needsPoll();
        } catch (err) {
          return false; // #needsPoll() fails on inconsistent data, the query ignores such checks
        }
      }).map(function(check) { return check.name; }).sort();
      const needingPoll = await Check.needingPoll();
      needingPoll.map(function(check) { return check.name; }).sort().should.eql(expected);
      expected.should.eql(['never tested', 'tested long ago', 'tested recently, with delay due']);
    });

  });

});
