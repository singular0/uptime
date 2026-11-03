const should = require('should');
const mongoose = require('../../bootstrap');
const Ping = require('../../models/ping');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const { clear } = require('../helpers');

const minute = 60 * 1000;

describe('Ping', function() {

  let now;

  // pings at a number of minutes from now
  const createPings = async function(check, pings) {
    let ping;
    for (const [minutes, isUp] of pings) {
      ping = await Ping.createForCheck(isUp, now + minutes * minute, 100, check, 'monitor1', isUp ? undefined : 'HTTP status 500', null);
    }
    return ping;
  };

  // [message, minutes from now, downtime in minutes] for the events of a check
  const getEvents = async function(check) {
    const events = await CheckEvent.find({ check: check._id }).sort({ timestamp: 1 });
    return events.map(function(event) {
      const summary = [event.message, (event.timestamp - now) / minute];
      if (event.downtime !== undefined) summary.push(event.downtime / minute);
      return summary;
    });
  };

  beforeEach(function() {
    now = Date.now();
    return clear(Ping, Check, CheckEvent);
  });

  after(function() {
    return clear(Ping, Check, CheckEvent);
  });

  describe('.createForCheck()', function() {

    it('should save a ping with the check data', async function() {
      const check = await new Check({ name: 'check', tags: ['foo', 'bar'], maxTime: 1500 }).save();
      const ping = await Ping.createForCheck(true, now, 100, check, 'monitor1', undefined, '{"statusCode":200}');
      const saved = await Ping.findById(ping._id);
      saved.isUp.should.be.true();
      saved.isResponsive.should.be.true();
      saved.time.should.eql(100);
      saved.timestamp.getTime().should.eql(now);
      saved.tags.should.eql(['foo', 'bar']);
      saved.monitorName.should.eql('monitor1');
      saved.details.should.eql({ statusCode: 200 });
      // the check is stored as an identifier, not as a populated document
      saved.check.should.be.an.instanceOf(mongoose.Types.ObjectId);
      String(ping.check).should.eql(check.id);
    });

    it('should accept the timestamp as a string, as sent by the monitor', async function() {
      const check = await new Check({ name: 'check' }).save();
      const ping = await Ping.createForCheck(true, String(now), 100, check, 'monitor1');
      ping.timestamp.getTime().should.eql(now);
    });

    it('should mark pings slower than the check max time as not responsive', async function() {
      const check = await new Check({ name: 'check', maxTime: 1500 }).save();
      const ping = await Ping.createForCheck(true, now, 2000, check, 'monitor1');
      ping.isUp.should.be.true();
      ping.isResponsive.should.be.false();
    });

    it('should record the error and the downtime of a down ping', async function() {
      const check = await new Check({ name: 'check', interval: 30000 }).save();
      const ping = await Ping.createForCheck(false, now, 100, check, 'monitor1', 'HTTP status 500');
      ping.isUp.should.be.false();
      ping.isResponsive.should.be.false();
      ping.error.should.eql('HTTP status 500');
      ping.downtime.should.eql(30000);
    });

    it('should update and save the check status', async function() {
      const check = await new Check({ name: 'check' }).save();
      await createPings(check, [[0, true], [1, true], [2, false], [3, false]]);
      const saved = await Check.findById(check._id);
      saved.isUp.should.be.false();
      saved.firstTested.getTime().should.eql(now);
      saved.lastTested.getTime().should.eql(now + 3 * minute);
      saved.lastChanged.getTime().should.eql(now + 2 * minute);
      saved.downtime.should.eql(minute);
      saved.uptime.should.eql(0);
    });

  });

  describe('events', function() {

    it('should create an event on the first ping', async function() {
      const check = await new Check({ name: 'check' }).save();
      await createPings(check, [[0, false]]);
      (await getEvents(check)).should.eql([['down', 0]]);
      (await CheckEvent.findOne({ check: check._id })).details.should.eql('HTTP status 500');
    });

    it('should create an event when the check changes status, with the downtime when it comes back up', async function() {
      const check = await new Check({ name: 'check' }).save();
      await createPings(check, [[0, true], [1, true], [2, false], [3, false], [4, true], [5, true]]);
      (await getEvents(check)).should.eql([['up', 0], ['down', 2], ['up', 4, 2]]);
    });

    it('should wait for alertTreshold down pings before creating a down event', async function() {
      const check = await new Check({ name: 'check', alertTreshold: 3 }).save();
      await createPings(check, [[0, true], [1, false], [2, false], [3, false], [4, false], [5, true]]);
      // the downtime starts with the first down ping
      (await getEvents(check)).should.eql([['up', 0], ['down', 3], ['up', 5, 4]]);
    });

    it('should not create events when the check comes back up before alertTreshold down pings', async function() {
      const check = await new Check({ name: 'check', alertTreshold: 3 }).save();
      await createPings(check, [[0, true], [1, false], [2, false], [3, true]]);
      (await getEvents(check)).should.eql([['up', 0]]);
    });

    it('should not record a downtime when a restarted check is up', async function() {
      const check = await new Check({ name: 'check' }).save();
      await createPings(check, [[0, false]]);
      check.togglePause();
      check.togglePause(); // restarted: the status is unknown
      await check.save();
      await createPings(check, [[1, true]]);
      (await getEvents(check)).should.eql([['down', 0], ['up', 1]]);
    });

  });

  describe('.cleanup()', function() {

    it('should remove the pings older than the given age', async function() {
      const check = await new Check({ name: 'check' }).save();
      await createPings(check, [[-10, true], [-1, true]]);
      await Ping.cleanup(5 * minute);
      const pings = await Ping.find();
      pings.map(function(ping) { return (ping.timestamp - now) / minute; }).should.eql([-1]);
    });

  });

});
