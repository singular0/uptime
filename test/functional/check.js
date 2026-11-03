const should = require('should');
const mongoose = require('../../bootstrap');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const Ping = require('../../models/ping');
const app = require('../../app');
const { clear, listen, close, request, eventually } = require('../helpers');

const missingId = '000000000000000000000000';

describe('API checks', function() {

  let server, api;

  before(async function() {
    server = await listen(app);
    api = server.url + '/api';
  });

  beforeEach(function() {
    return clear(Check, CheckEvent, Ping);
  });

  after(async function() {
    await clear(Check, CheckEvent, Ping);
    await close(server);
  });

  describe('GET /checks', function() {

    it('should fetch all elements', async function() {
      await Check.create([{ name: 'name1', url: 'http://www.url1.fr' }, { name: 'name2', url: 'http://www.url2.fr' }]);
      const res = await request(api + '/checks');
      res.status.should.eql(200);
      res.body.map(function(check) { return check.name; }).sort().should.eql(['name1', 'name2']);
    });

    it('should filter the elements by tag', async function() {
      await Check.create([{ name: 'tagged', tags: ['foo', 'bar'] }, { name: 'other', tags: ['bar'] }]);
      const res = await request(api + '/checks?tag=foo');
      res.body.map(function(check) { return check.name; }).should.eql(['tagged']);
    });

  });

  describe('GET /checks/count', function() {

    it('should count the checks by status', async function() {
      await Check.create([{ isUp: true }, { isUp: true }, { isUp: false }, { isUp: true, isPaused: true }]);
      const res = await request(api + '/checks/count');
      res.body.should.eql({ up: 2, down: 1, paused: 1, total: 4 });
    });

  });

  describe('GET /checks/needingPoll', function() {

    it('should return the checks that need a poll, without their qos', async function() {
      const minute = 60 * 1000;
      await Check.create([
        { name: 'never tested', qos: { count: 1 } },
        { name: 'paused', isPaused: true },
        { name: 'tested recently', firstTested: new Date(Date.now() - minute), lastTested: new Date() }
      ]);
      const res = await request(api + '/checks/needingPoll');
      res.body.map(function(check) { return check.name; }).should.eql(['never tested']);
      res.body[0].should.not.have.property('qos');
    });

  });

  describe('GET /checks/:id', function() {

    it('should fetch the element', async function() {
      const check = await Check.create({ name: 'name1', url: 'http://www.url1.fr' });
      const res = await request(api + '/checks/' + check.id);
      res.status.should.eql(200);
      res.body._id.should.eql(check.id);
      res.body.name.should.eql('name1');
    });

    it('should return a 404 error if the element does not exist', async function() {
      const res = await request(api + '/checks/' + missingId);
      res.status.should.eql(404);
      res.body.error.should.match(/failed to load check/);
    });

  });

  describe('PUT /checks', function() {

    it('should add a new valid element', async function() {
      const res = await request(api + '/checks', 'PUT', { name: 'test', url: 'http://test.local', interval: 30, tags: 'foo, bar' });
      res.status.should.eql(200);
      const check = await Check.findById(res.body._id);
      check.name.should.eql('test');
      check.type.should.eql('http');
      check.interval.should.eql(30000);
      check.tags.toObject().should.eql(['foo', 'bar']);
    });

    it('should add a new element with url as name if name is empty', async function() {
      const res = await request(api + '/checks', 'PUT', { name: '', url: 'http://mynewurl.test' });
      res.body.name.should.eql('http://mynewurl.test');
    });

    it('should not add an invalid element with no url', async function() {
      const res = await request(api + '/checks', 'PUT', { name: 'test' });
      res.status.should.be.aboveOrEqual(400);
      res.body.error.message.should.eql('URL must be defined');
      (await Check.countDocuments()).should.eql(0);
    });

    it('should not add an element whose url does not match the poller type', async function() {
      const res = await request(api + '/checks', 'PUT', { url: 'http://test.local', type: 'https' });
      res.status.should.be.aboveOrEqual(400);
      res.body.error.message.should.match(/mismatch/);
      (await Check.countDocuments()).should.eql(0);
    });

  });

  describe('POST /checks/:id', function() {

    let check;

    beforeEach(async function() {
      check = await Check.create({ name: 'name1', url: 'http://www.url1.fr' });
    });

    it('should return an error if the id is not valid', async function() {
      const res = await request(api + '/checks/toto', 'POST', { name: 'test' });
      res.status.should.be.aboveOrEqual(400);
      res.body.should.have.property('error');
    });

    it('should return a 404 error if the element does not exist', async function() {
      const res = await request(api + '/checks/' + missingId, 'POST', { name: 'test' });
      res.status.should.eql(404);
    });

    it('should update object if parameters are valid', async function() {
      const res = await request(api + '/checks/' + check.id, 'POST', { name: 'test', url: 'https://newurl.test' });
      res.status.should.eql(200);
      res.body.name.should.eql('test');
      res.body.url.should.eql('https://newurl.test');
      const saved = await Check.findById(check._id);
      saved.url.should.eql('https://newurl.test');
      saved.type.should.eql('https');
    });

    it('should not throw error if called twice on same id', async function() {
      await request(api + '/checks/' + check.id, 'POST', { name: 'test', url: 'http://newurl.test' });
      const res = await request(api + '/checks/' + check.id, 'POST', { name: 'test', url: 'http://newurl.test' });
      res.status.should.eql(200);
      res.body.name.should.eql('test');
    });

  });

  describe('DELETE /checks/:id', function() {

    it('should remove the element and its pings and events', async function() {
      const check = await Check.create({ name: 'name1', url: 'http://www.url1.fr' });
      await Ping.createForCheck(false, Date.now(), 100, check, 'monitor1', 'error');
      const res = await request(api + '/checks/' + check.id, 'DELETE');
      res.status.should.eql(200);
      (await Check.countDocuments()).should.eql(0);
      (await Ping.countDocuments()).should.eql(0);
      (await CheckEvent.countDocuments()).should.eql(0);
    });

    it('should return a 404 error if the element does not exist', async function() {
      const res = await request(api + '/checks/' + missingId, 'DELETE');
      res.status.should.eql(404);
    });

  });

  describe('GET /checks/:id/pause', function() {

    it('should pause and restart the check, and create the matching events', async function() {
      const check = await Check.create({ name: 'name1', url: 'http://www.url1.fr' });
      const getMessages = async function() {
        const events = await CheckEvent.find({ check: check._id }).sort({ timestamp: 1, _id: 1 });
        return events.map(function(event) { return event.message; });
      };

      let res = await request(api + '/checks/' + check.id + '/pause');
      res.status.should.eql(302);
      res.headers.get('location').should.eql('/api/checks/' + check.id);
      (await Check.findById(check._id)).isPaused.should.be.true();
      await eventually(async function() { (await getMessages()).should.eql(['paused']); });

      await request(api + '/checks/' + check.id + '/pause');
      (await Check.findById(check._id)).isPaused.should.be.false();
      await eventually(async function() { (await getMessages()).should.eql(['paused', 'restarted']); });
    });

  });

  describe('PUT /check/:id/test', function() {

    it('should set the last test date, so that the check is not polled twice', async function() {
      const check = await Check.create({ name: 'name1', url: 'http://www.url1.fr' });
      const res = await request(api + '/check/' + check.id + '/test', 'PUT');
      res.body.should.eql({ numberAffected: 1 });
      const saved = await Check.findById(check._id);
      saved.lastTested.getTime().should.be.approximately(Date.now(), 1000);
    });

    it('should not affect anything if the element does not exist', async function() {
      const res = await request(api + '/check/' + missingId + '/test', 'PUT');
      res.body.should.eql({ numberAffected: 0 });
    });

  });

  describe('GET /checks/:id/events', function() {

    it('should return the events of the check, grouped by day', async function() {
      const [check, other] = await Check.create([{ name: 'name1', url: 'http://www.url1.fr' }, { name: 'other' }]);
      const noon = new Date();
      noon.setDate(noon.getDate() - 1);
      noon.setHours(12, 0, 0, 0); // yesterday at noon, so that all events are on the same day
      await Ping.createForCheck(false, noon.getTime() - 2000, 100, check, 'monitor1', 'HTTP status 500');
      await Ping.createForCheck(true, noon.getTime() - 1000, 100, check, 'monitor1');
      await Ping.createForCheck(true, noon.getTime() - 1000, 100, other, 'monitor1');
      const res = await request(api + '/checks/' + check.id + '/events');
      const days = Object.keys(res.body);
      days.should.eql([noon.toLocaleDateString()]);
      const events = res.body[days[0]];
      events.map(function(event) { return event.message; }).should.eql(['up', 'down']);
      events[0].check.should.eql({ _id: check.id, name: 'name1', url: 'http://www.url1.fr' });
      events[0].downtime.should.eql(1000);
      events[1].details.should.eql('HTTP status 500');
    });

  });

  describe('GET /', function() {

    it('should list the API routes', async function() {
      const res = await request(api + '/');
      res.body.should.containEql({ method: 'PUT', path: '/api/checks' });
      res.body.should.containEql({ method: 'POST', path: '/api/pings' });
    });

  });

});
