const should = require('should');
const mongoose = require('../../bootstrap');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const Ping = require('../../models/ping');
const app = require('../../app');
const { clear, listen, close, request } = require('../helpers');

describe('API pings', function() {

  let server, api, check;

  // POST /pings the way the monitor does: URL-encoded form fields
  const postPing = async function(fields) {
    const res = await fetch(api + '/pings', { method: 'POST', body: new URLSearchParams(fields) });
    const text = await res.text();
    return { status: res.status, body: res.ok ? JSON.parse(text) : text };
  };

  before(async function() {
    server = await listen(app);
    api = server.url + '/api';
  });

  beforeEach(async function() {
    await clear(Check, CheckEvent, Ping);
    check = await Check.create({ name: 'name1', url: 'http://www.url1.fr', maxTime: 1500 });
  });

  after(async function() {
    await clear(Check, CheckEvent, Ping);
    await close(server);
  });

  describe('POST /pings', function() {

    it('should create an up ping and update the check', async function() {
      const timestamp = Date.now();
      const res = await postPing({ checkId: check.id, status: 'true', timestamp: timestamp, time: 120, name: 'monitor1', details: '{"statusCode":200}' });
      res.status.should.eql(200);
      const ping = await Ping.findById(res.body._id);
      ping.isUp.should.be.true();
      ping.isResponsive.should.be.true();
      ping.time.should.eql(120);
      ping.monitorName.should.eql('monitor1');
      ping.timestamp.getTime().should.eql(timestamp);
      ping.details.should.eql({ statusCode: 200 });
      const saved = await Check.findById(check._id);
      saved.isUp.should.be.true();
      saved.lastTested.getTime().should.eql(timestamp);
    });

    it('should create a down ping and a down event with the error', async function() {
      const res = await postPing({ checkId: check.id, status: 'false', timestamp: Date.now(), time: 5000, name: 'monitor1', error: 'Request Timeout' });
      res.status.should.eql(200);
      res.body.isUp.should.be.false();
      res.body.error.should.eql('Request Timeout');
      // the event is saved before the response
      const events = await CheckEvent.find({ check: check._id });
      events.map(function(event) { return [event.message, event.details]; }).should.eql([['down', 'Request Timeout']]);
    });

    it('should refuse pings for unknown checks', async function() {
      const res = await postPing({ checkId: '000000000000000000000000', status: 'true', timestamp: Date.now(), time: 100, name: 'monitor1' });
      res.status.should.eql(403);
      res.body.should.match(/No existing check/);
      (await Ping.countDocuments()).should.eql(0);
    });

    it('should return a 400 error for invalid check identifiers', async function() {
      const res = await postPing({ checkId: 'toto', status: 'true' });
      res.status.should.eql(400);
    });

    it('should return a 400 error for invalid ping data, without updating the check', async function() {
      for (const fields of [{ time: 'abc' }, { timestamp: 'abc' }, { details: '{' }]) {
        const res = await postPing(Object.assign({ checkId: check.id, status: 'true', timestamp: Date.now(), time: 100, name: 'monitor1' }, fields));
        res.status.should.eql(400, JSON.stringify(fields));
      }
      (await Ping.countDocuments()).should.eql(0);
      should.not.exist((await Check.findById(check._id)).lastTested);
    });

  });

  describe('GET /pings', function() {

    it('should return the pings of a check, latest first', async function() {
      const other = await Check.create({ name: 'other' });
      const now = Date.now();
      await Ping.createForCheck(true, now - 2000, 100, check, 'monitor1');
      await Ping.createForCheck(false, now - 1000, 100, check, 'monitor1', 'error');
      await Ping.createForCheck(true, now, 100, other, 'monitor1');
      const res = await request(api + '/pings?check=' + check.id);
      res.body.map(function(ping) { return [ping.isUp, Date.parse(ping.timestamp)]; }).should.eql([[false, now - 1000], [true, now - 2000]]);
      (await request(api + '/pings')).body.length.should.eql(3);
    });

    it('should paginate the pings by 50', async function() {
      const now = Date.now();
      await Ping.insertMany(Array.from({ length: 60 }, function(value, i) {
        return { check: check._id, isUp: true, timestamp: new Date(now - i * 1000) };
      }));
      (await request(api + '/pings?check=' + check.id)).body.length.should.eql(50);
      const page2 = (await request(api + '/pings?check=' + check.id + '&page=2')).body;
      page2.length.should.eql(10);
      Date.parse(page2[0].timestamp).should.eql(now - 50 * 1000);
    });

  });

  describe('GET /pings/events', function() {

    it('should return the events of the last week, grouped by day', async function() {
      const noon = new Date();
      noon.setDate(noon.getDate() - 1);
      noon.setHours(12, 0, 0, 0); // yesterday at noon, so that all events are on the same day
      await CheckEvent.create([
        { check: check._id, timestamp: noon, message: 'down', details: 'error' },
        { check: check._id, timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), message: 'up' }
      ]);
      const res = await request(api + '/pings/events');
      res.body.should.eql({
        [noon.toLocaleDateString()]: [{ check: { _id: check.id, name: 'name1', url: 'http://www.url1.fr' }, timestamp: noon.toISOString(), message: 'down', details: 'error' }]
      });
    });

  });

});
