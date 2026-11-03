const should = require('should');
const util = require('util');
const mongoose = require('../../bootstrap');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const Ping = require('../../models/ping');
const Monitor = require('../../lib/monitor');
const patternMatcher = require('../../plugins/patternMatcher');
const app = require('../../app');
const { clear, listen, close } = require('../helpers');

describe('monitor', function() {

  let apiServer, target, monitor;

  before(async function() {
    apiServer = await listen(app);
    target = await listen(function(req, res) {
      if (req.url === '/error') res.statusCode = 500;
      res.end('hello world');
    });
    monitor = Monitor.createMonitor({ name: 'test-monitor', apiUrl: apiServer.url + '/api', timeout: 1000, userAgent: 'test' });
    patternMatcher.initMonitor({ monitor: monitor });
  });

  beforeEach(function() {
    return clear(Check, CheckEvent, Ping);
  });

  after(async function() {
    await clear(Check, CheckEvent, Ping);
    await close(target);
    await close(apiServer);
  });

  const findChecksNeedingPoll = function() {
    return util.promisify(monitor.findChecksNeedingPoll).call(monitor);
  };

  const pollCheck = function(check) {
    return util.promisify(monitor.pollCheck).call(monitor, check);
  };

  // poll all the checks needing a poll, and return their pings by check name
  const pollAll = async function() {
    const checks = await findChecksNeedingPoll();
    await Promise.all(checks.map(pollCheck));
    const pings = {};
    for (const check of checks) {
      pings[check.name] = await Ping.find({ check: check._id });
    }
    return pings;
  };

  it('should poll the checks and report the pings to the API', async function() {
    await Check.create([
      { name: 'ok', type: 'http', url: target.url + '/ok' },
      { name: 'error', type: 'http', url: target.url + '/error' },
      { name: 'paused', type: 'http', url: target.url + '/ok', isPaused: true }
    ]);
    const pings = await pollAll();
    Object.keys(pings).sort().should.eql(['error', 'ok']);

    pings.ok.length.should.eql(1);
    pings.ok[0].isUp.should.be.true();
    pings.ok[0].monitorName.should.eql('test-monitor');
    pings.ok[0].time.should.be.a.Number();

    pings.error.length.should.eql(1);
    pings.error[0].isUp.should.be.false();
    pings.error[0].error.should.eql('HTTP status 500');

    const events = await CheckEvent.find().sort({ message: 1 });
    events.map(function(event) { return event.message; }).should.eql(['down', 'up']);
    // the polled checks are not polled again before their interval
    (await findChecksNeedingPoll()).should.eql([]);
  });

  it('should fail the ping when a pollerPolled listener throws', async function() {
    await Check.create({ name: 'pattern', type: 'http', url: target.url + '/ok', pollerParams: { match: '/goodbye/' } });
    const pings = await pollAll();
    pings.pattern[0].isUp.should.be.false();
    pings.pattern[0].error.should.eql('Response body does not match pattern /goodbye/');
  });

  it('should encode the monitor name and the error message', async function() {
    const special = Monitor.createMonitor({ name: 'eu & us 100%+', apiUrl: apiServer.url + '/api', timeout: 1000, userAgent: 'test' });
    patternMatcher.initMonitor({ monitor: special });
    const check = await Check.create({ name: 'pattern', type: 'http', url: target.url + '/ok', pollerParams: { match: '/a&b=c%20d+e/' } });
    const checks = await findChecksNeedingPoll();
    await util.promisify(special.pollCheck).call(special, checks[0]);
    const pings = await Ping.find({ check: check._id });
    pings.length.should.eql(1);
    pings[0].monitorName.should.eql('eu & us 100%+');
    pings[0].error.should.eql('Response body does not match pattern /a&b=c%20d+e/');
  });

  it('should fail the ping when the poller type is unknown', async function() {
    await Check.create({ name: 'unknown', type: 'ftp', url: 'ftp://127.0.0.1/' });
    const pings = await pollAll();
    pings.unknown[0].isUp.should.be.false();
    pings.unknown[0].error.should.eql('Undefined poller type: ftp');
  });

  it('should report an error when the API is not reachable', async function() {
    const closed = await listen(function() {});
    await close(closed);
    const unreachable = Monitor.createMonitor({ name: 'test-monitor', apiUrl: closed.url + '/api' });
    await util.promisify(unreachable.findChecksNeedingPoll).call(unreachable).should.be.rejectedWith(/resource not available/);
  });

});
