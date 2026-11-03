const should = require('should');
const dgram = require('dgram');
const PollerCollection = require('../../lib/pollers/pollerCollection');
const HttpPoller = require('../../lib/pollers/http/httpPoller');
const HttpsPoller = require('../../lib/pollers/https/httpsPoller');
const UdpPoller = require('../../lib/pollers/udp/udpPoller');
const { listen, close } = require('../helpers');

// Poll a target, and resolve with the arguments of the poller callback
const poll = function(Poller, target, timeout, setup) {
  return new Promise(function(resolve) {
    let calls = 0;
    const poller = new Poller(target, timeout || 1000, function(err, time, res, details) {
      calls++;
      resolve({ err: err, time: time, res: res, details: details, calls: function() { return calls; } });
    });
    if (setup) setup(poller);
    poller.poll();
  });
};

const wait = function(ms) {
  return new Promise(function(resolve) { setTimeout(resolve, ms); });
};

describe('pollers', function() {

  let server;

  before(async function() {
    server = await listen(function(req, res) {
      switch (req.url) {
        case '/ok':
          return res.end('hello world');
        case '/error':
          res.statusCode = 500;
          return res.end('error');
        case '/redirect':
          res.writeHead(302, { Location: '/ok' });
          return res.end();
        case '/redirect-ftp':
          res.writeHead(302, { Location: 'ftp://example.com/' });
          return res.end();
        case '/user-agent':
          return res.end(req.headers['user-agent']);
        case '/slow':
          return; // never responds
        default:
          res.statusCode = 404;
          res.end();
      }
    });
  });

  after(function() {
    return close(server);
  });

  describe('PollerCollection', function() {

    const pollerCollection = new PollerCollection();

    it('should contain the default pollers', function() {
      pollerCollection.getTypes().should.eql(['http', 'https', 'udp', 'webpagetest']);
      pollerCollection.getForType('udp').should.equal(UdpPoller);
    });

    it('should throw an error for unknown poller types', function() {
      (function() { pollerCollection.getForType('ftp'); }).should.throw('Undefined poller type: ftp');
    });

    it('should guess the poller type from the url protocol', function() {
      pollerCollection.guessTypeForUrl('https://example.com').should.eql('https');
      (function() { pollerCollection.guessTypeForUrl('example.com'); }).should.throw(/Unable to determine poller type/);
    });

  });

  describe('HttpPoller', function() {

    it('should only accept http urls', function() {
      HttpPoller.validateTarget('http://example.com/').should.be.true();
      HttpPoller.validateTarget('https://example.com/').should.be.false();
      HttpPoller.validateTarget('example.com').should.be.false();
    });

    it('should call back with the response and its body for a 2xx response', async function() {
      const { err, time, res } = await poll(HttpPoller, server.url + '/ok');
      should(err).be.undefined();
      res.statusCode.should.eql(200);
      res.body.should.eql('hello world');
      time.should.be.a.Number().and.not.be.below(0);
    });

    it('should call back with an error for a non-2xx response', async function() {
      const { err } = await poll(HttpPoller, server.url + '/error');
      err.should.eql({ name: 'NonOkStatusCode', message: 'HTTP status 500' });
    });

    it('should follow redirects', async function() {
      const { err, res } = await poll(HttpPoller, server.url + '/redirect');
      should(err).be.undefined();
      res.body.should.eql('hello world');
    });

    it('should call back with an error when redirected to an unsupported protocol', async function() {
      const { err } = await poll(HttpPoller, server.url + '/redirect-ftp');
      err.name.should.eql('WrongRedirectUrl');
    });

    it('should call back once with an error when the request times out', async function() {
      const { err, time, calls } = await poll(HttpPoller, server.url + '/slow', 100);
      err.should.eql({ name: 'TimeOutError', message: 'Request Timeout' });
      time.should.be.aboveOrEqual(90); // the timer uses Date.now(), and setTimeout() can fire 1ms early by that clock
      await wait(50); // the aborted request must not call back again
      calls().should.eql(1);
    });

    it('should call back with an error when the server is not reachable', async function() {
      const closed = await listen(function() {});
      await close(closed);
      const { err } = await poll(HttpPoller, closed.url + '/ok');
      err.code.should.eql('ECONNREFUSED');
    });

    it('should send the user agent', async function() {
      const { res } = await poll(HttpPoller, server.url + '/user-agent', 1000, function(poller) {
        poller.setUserAgent('Uptime test');
      });
      res.body.should.eql('Uptime test');
    });

  });

  describe('HttpsPoller', function() {

    it('should only accept https urls', function() {
      HttpsPoller.validateTarget('https://example.com/').should.be.true();
      HttpsPoller.validateTarget('http://example.com/').should.be.false();
    });

    it('should call back with an error when the server does not use TLS', async function() {
      const { err } = await poll(HttpsPoller, server.url.replace('http:', 'https:') + '/ok');
      err.should.be.an.Error();
    });

  });

  describe('UdpPoller', function() {

    let udpServer, port;

    before(function(done) {
      udpServer = dgram.createSocket('udp4');
      udpServer.on('message', function(message, sender) {
        if (JSON.parse(message).command !== 'ping' || udpServer.mute) return;
        const pong = Buffer.from(JSON.stringify({ command: 'pong' }));
        udpServer.send(pong, 0, pong.length, sender.port, sender.address);
      });
      udpServer.bind(0, '127.0.0.1', function() {
        port = udpServer.address().port;
        done();
      });
    });

    after(function() {
      udpServer.close();
    });

    it('should only accept udp urls with a port', function() {
      UdpPoller.validateTarget('udp://127.0.0.1:1234').should.be.true();
      UdpPoller.validateTarget('udp://127.0.0.1').should.be.false();
      UdpPoller.validateTarget('http://127.0.0.1:1234').should.be.false();
    });

    it('should call back with the pong answer', async function() {
      const { err, res } = await poll(UdpPoller, 'udp://127.0.0.1:' + port);
      should(err).be.null();
      res.should.eql({ command: 'pong' });
    });

    it('should call back with an error when there is no answer', async function() {
      udpServer.mute = true;
      try {
        const { err } = await poll(UdpPoller, 'udp://127.0.0.1:' + port, 100);
        err.name.should.eql('TimeOutError');
      } finally {
        udpServer.mute = false;
      }
    });

  });

});
