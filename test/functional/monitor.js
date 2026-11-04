const should = require('should');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
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
  const targetRequests = [];

  const createMonitor = function(apiUrl, options) {
    return Monitor.createMonitor(Object.assign({ name: 'test-monitor', apiUrl: apiUrl, timeout: 1000, userAgent: 'test' }, options));
  };

  before(async function() {
    apiServer = await listen(app);
    target = await listen(function(req, res) {
      targetRequests.push(req.url);
      if (req.url === '/error') res.statusCode = 500;
      res.end('hello world');
    });
    monitor = createMonitor(apiServer.url + '/api');
    patternMatcher.initMonitor({ monitor: monitor });
  });

  beforeEach(function() {
    targetRequests.length = 0;
    return clear(Check, CheckEvent, Ping);
  });

  after(async function() {
    await clear(Check, CheckEvent, Ping);
    await close(target);
    await close(apiServer);
  });

  // poll all the checks needing a poll, and return their pings by check name
  const pollAll = async function(pollingMonitor) {
    pollingMonitor = pollingMonitor || monitor;
    const checks = await pollingMonitor.findChecksNeedingPoll();
    await Promise.all(checks.map(function(check) { return pollingMonitor.pollCheck(check); }));
    const pings = {};
    for (const check of checks) {
      pings[check.name] = await Ping.find({ check: check._id });
    }
    return pings;
  };

  // run fn, and return the messages of the errors it logged
  const loggedErrors = async function(fn) {
    const errors = [];
    const consoleError = console.error;
    console.error = function(err) { errors.push(err instanceof Error ? err.message : String(err)); };
    try {
      await fn();
    } finally {
      console.error = consoleError;
    }
    return errors;
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
    (await monitor.findChecksNeedingPoll()).should.eql([]);
  });

  it('should poll the checks needing a poll on each interval', async function() {
    const check = await Check.create({ name: 'ok', type: 'http', url: target.url + '/ok' });
    (await loggedErrors(function() { return monitor.pollChecksNeedingPoll(); })).should.eql([]);
    const pings = await Ping.find({ check: check._id });
    pings.length.should.eql(1);
    pings[0].isUp.should.be.true();
  });

  it('should fail the ping when a pollerPolled listener throws', async function() {
    await Check.create({ name: 'pattern', type: 'http', url: target.url + '/ok', pollerParams: { match: '/goodbye/' } });
    const pings = await pollAll();
    pings.pattern[0].isUp.should.be.false();
    pings.pattern[0].error.should.eql('Response body does not match pattern /goodbye/');
  });

  it('should encode the monitor name and the error message', async function() {
    const special = createMonitor(apiServer.url + '/api', { name: 'eu & us 100%+' });
    patternMatcher.initMonitor({ monitor: special });
    const check = await Check.create({ name: 'pattern', type: 'http', url: target.url + '/ok', pollerParams: { match: '/a&b=c%20d+e/' } });
    const checks = await monitor.findChecksNeedingPoll();
    await special.pollCheck(checks[0]);
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

  it('should call an https API', async function() {
    const tlsDir = path.join(__dirname, 'tls');
    const cert = fs.readFileSync(path.join(tlsDir, 'cert.pem'), 'utf8');
    const httpsServer = await listen(app, { cert: cert, key: fs.readFileSync(path.join(tlsDir, 'key.pem')) });
    // trust the self-signed certificate of the server
    const defaultCertificates = tls.getCACertificates('default');
    tls.setDefaultCACertificates(defaultCertificates.concat(cert));
    try {
      httpsServer.url.should.startWith('https://');
      await Check.create({ name: 'ok', type: 'http', url: target.url + '/ok' });
      const pings = await pollAll(createMonitor(httpsServer.url + '/api'));
      pings.ok.length.should.eql(1);
      pings.ok[0].isUp.should.be.true();
    } finally {
      tls.setDefaultCACertificates(defaultCertificates);
      await close(httpsServer);
    }
  });

  describe('when the API fails', function() {

    let fakeApi, apiRequests, respond;
    const check = { _id: '0123456789abcdef01234567', name: 'ok', type: 'http', url: '' };

    before(async function() {
      // an API that records the requests, and lets the tests choose the responses
      fakeApi = await listen(function(req, res) {
        apiRequests.push(req.method + ' ' + req.url);
        respond(req, res);
      });
    });

    beforeEach(function() {
      apiRequests = [];
      check.url = target.url + '/ok';
    });

    after(function() {
      return close(fakeApi);
    });

    const json = function(res, body) {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    it('should report an error when the API is not reachable', async function() {
      const closed = await listen(function() {});
      await close(closed);
      await createMonitor(closed.url + '/api').findChecksNeedingPoll()
        .should.be.rejectedWith('API call GET ' + closed.url + '/api/checks/needingPoll failed: connect ECONNREFUSED ' + closed.url.slice(7));
    });

    it('should report an error when the API responds with something else than JSON', async function() {
      respond = function(req, res) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<html>Please log in</html>');
      };
      await createMonitor(fakeApi.url + '/api').findChecksNeedingPoll()
        .should.be.rejectedWith(/^API call GET http:\/\/127\.0\.0\.1:\d+\/api\/checks\/needingPoll failed: the response is not JSON \(/);
    });

    it('should report an error when the API does not respond in time', async function() {
      respond = function() {};
      const start = Date.now();
      await createMonitor(fakeApi.url + '/api', { timeout: 50 }).findChecksNeedingPoll()
        .should.be.rejectedWith(/needingPoll failed: no response within 50ms$/);
      (Date.now() - start).should.be.below(1000);
    });

    it('should report an error when the API redirects', async function() {
      respond = function(req, res) {
        res.writeHead(302, { Location: '/login' });
        res.end();
      };
      await createMonitor(fakeApi.url + '/api').findChecksNeedingPoll()
        .should.be.rejectedWith(/needingPoll failed: HTTP status 302, redirect to \/login$/);
      apiRequests.should.eql(['GET /api/checks/needingPoll']);
    });

    it('should log the errors instead of throwing them', async function() {
      respond = function(req, res) { res.end('not json'); };
      const errors = await loggedErrors(function() {
        return createMonitor(fakeApi.url + '/api').pollChecksNeedingPoll();
      });
      errors.length.should.eql(1);
      errors[0].should.match(/needingPoll failed: the response is not JSON/);
    });

    it('should not poll a check that it failed to claim', async function() {
      respond = function(req, res) {
        if (req.method === 'GET') return json(res, [check]);
        res.statusCode = 500;
        res.end('Internal Server Error');
      };
      const errors = await loggedErrors(function() {
        return createMonitor(fakeApi.url + '/api').pollChecksNeedingPoll();
      });
      errors.length.should.eql(1);
      errors[0].should.match(/^API call PUT http:\/\/127\.0\.0\.1:\d+\/api\/check\/0123456789abcdef01234567\/test failed: HTTP status 500$/);
      apiRequests.should.eql(['GET /api/checks/needingPoll', 'PUT /api/check/0123456789abcdef01234567/test']);
      targetRequests.should.eql([]);
    });

    it('should report an error when the API rejects the ping', async function() {
      respond = function(req, res) {
        if (req.method === 'PUT') return json(res, { numberAffected: 1 });
        res.statusCode = 403;
        res.end('Error: No existing check with id ' + check._id);
      };
      await createMonitor(fakeApi.url + '/api').pollCheck(check)
        .should.be.rejectedWith(/pings failed: HTTP status 403$/);
      apiRequests.should.eql(['PUT /api/check/0123456789abcdef01234567/test', 'POST /api/pings']);
      targetRequests.should.eql(['/ok']);
    });

    it('should send the credentials of the API URL as a Basic Authorization header', async function() {
      let authorization;
      respond = function(req, res) {
        authorization = req.headers.authorization;
        json(res, []);
      };
      const withCredentials = fakeApi.url.replace('http://', 'http://admin:s%3Acr3t@') + '/api';
      (await createMonitor(withCredentials).findChecksNeedingPoll()).should.eql([]);
      authorization.should.eql('Basic ' + Buffer.from('admin:s:cr3t').toString('base64'));
      // the API key takes precedence, and the credentials don't show in the errors
      respond = function(req, res) {
        authorization = req.headers.authorization;
        res.statusCode = 500;
        res.end();
      };
      await createMonitor(withCredentials, { apiKey: 'api-key' }).findChecksNeedingPoll()
        .should.be.rejectedWith('API call GET ' + fakeApi.url + '/api/checks/needingPoll failed: HTTP status 500');
      authorization.should.eql('Bearer api-key');
    });

  });

  describe('isHealthy()', function() {

    // a monitor that started longer ago than three polling intervals and a timeout (1000ms each)
    const startedLongAgo = function(apiUrl) {
      const healthMonitor = createMonitor(apiUrl, { pollingInterval: 1000 });
      healthMonitor.startedAt = Date.now() - 5000;
      return healthMonitor;
    };

    // run fn without the "Monitor started" and "Monitor stopped" messages
    const quietly = function(fn) {
      const consoleLog = console.log;
      console.log = function() {};
      try {
        fn();
      } finally {
        console.log = consoleLog;
      }
    };

    it('should be healthy from the start until it stops', function() {
      const healthMonitor = createMonitor(apiServer.url + '/api');
      healthMonitor.pollChecksNeedingPoll = function() {}; // no API calls left running after the test
      healthMonitor.isHealthy().should.be.false();
      quietly(function() { healthMonitor.start(); });
      healthMonitor.isHealthy().should.be.true();
      quietly(function() { healthMonitor.stop(); });
      healthMonitor.isHealthy().should.be.false();
    });

    it('should be healthy when it fetched the checks needing a poll lately', async function() {
      await Check.create({ name: 'error', type: 'http', url: target.url + '/error' });
      const healthMonitor = startedLongAgo(apiServer.url + '/api');
      healthMonitor.isHealthy().should.be.false();
      // a target being down doesn't matter
      (await loggedErrors(function() { return healthMonitor.pollChecksNeedingPoll(); })).should.eql([]);
      healthMonitor.isHealthy().should.be.true();
    });

    it('should not be healthy when it fails to fetch the checks needing a poll', async function() {
      const closed = await listen(function() {});
      await close(closed);
      const healthMonitor = startedLongAgo(closed.url + '/api');
      (await loggedErrors(function() { return healthMonitor.pollChecksNeedingPoll(); })).length.should.eql(1);
      healthMonitor.isHealthy().should.be.false();
    });

  });

});
