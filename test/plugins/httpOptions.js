const should = require('should');
const EventEmitter = require('events');
const Check = require('../../models/check');
const HttpPoller = require('../../lib/pollers/http/httpPoller');
const httpOptions = require('../../plugins/httpOptions');
const { listen, close } = require('../helpers');

describe('httpOptions plugin', function() {

  describe('dashboard', function() {

    let dashboard, check;

    beforeEach(function() {
      dashboard = new EventEmitter();
      httpOptions.initWebApp({ dashboard: dashboard });
      check = new Check({ type: 'http' });
    });

    it('should store the options parsed from YAML', function() {
      dashboard.emit('populateFromDirtyCheck', check, { http_options: 'method: HEAD\nheaders:\n  X-Foo: bar' }, 'http');
      check.getPollerParam('http_options').should.eql({ method: 'HEAD', headers: { 'X-Foo': 'bar' } });
    });

    it('should reject malformed YAML', function() {
      (function() {
        dashboard.emit('populateFromDirtyCheck', check, { http_options: 'method: [HEAD' }, 'http');
      }).should.throw(/Malformed YAML configuration/);
    });

    it('should ignore checks that are not http or https', function() {
      dashboard.emit('populateFromDirtyCheck', check, { http_options: 'method: HEAD' }, 'udp');
      should(check.getPollerParam('http_options')).be.undefined();
    });

    it('should add the options as YAML to the check edit form', function() {
      check.setPollerParam('http_options', { method: 'HEAD' });
      const partials = [];
      dashboard.emit('checkEdit', 'http', check, partials);
      partials.length.should.eql(1);
      partials[0].should.match(/name="check\[http_options\]"[^>]*>method: HEAD\n<\/textarea>/);
    });

  });

  describe('monitor', function() {

    let monitor, server;

    before(async function() {
      server = await listen(function(req, res) {
        res.end(req.method + ' ' + req.headers['x-foo']);
      });
    });

    after(function() {
      return close(server);
    });

    beforeEach(function() {
      monitor = new EventEmitter();
      httpOptions.initMonitor({ monitor: monitor });
    });

    it('should add the options to the poller request', function(done) {
      const check = { type: 'http', pollerParams: { http_options: { method: 'POST', headers: { 'X-Foo': 'bar' } } } };
      const poller = new HttpPoller(server.url + '/', 1000, function(err, time, res) {
        if (err) return done(err);
        res.body.should.eql('POST bar');
        done();
      });
      monitor.emit('pollerCreated', poller, check, {});
      poller.poll();
    });

    it('should ignore checks without options', function() {
      const poller = new HttpPoller(server.url + '/', 1000, function() {});
      const target = Object.assign({}, poller.target);
      monitor.emit('pollerCreated', poller, { type: 'http' }, {});
      poller.target.should.eql(target);
    });

  });

});
