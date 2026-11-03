const should = require('should');
const EventEmitter = require('events');
const Check = require('../../models/check');
const patternMatcher = require('../../plugins/patternMatcher');

describe('patternMatcher plugin', function() {

  describe('dashboard', function() {

    let dashboard, check;

    beforeEach(function() {
      dashboard = new EventEmitter();
      patternMatcher.initWebApp({ dashboard: dashboard });
      check = new Check({ type: 'http' });
    });

    it('should store the pattern as a regular expression', function() {
      dashboard.emit('populateFromDirtyCheck', check, { match: '/hello/i' }, 'http');
      check.getPollerParam('match').should.eql('/hello/i');
    });

    it('should wrap a plain string pattern in slashes', function() {
      dashboard.emit('populateFromDirtyCheck', check, { match: 'hello' }, 'https');
      check.getPollerParam('match').should.eql('/hello/');
    });

    it('should reject malformed regular expressions', function() {
      (function() {
        dashboard.emit('populateFromDirtyCheck', check, { match: '/(/' }, 'http');
      }).should.throw('Malformed regular expression /(/');
    });

    it('should ignore checks that are not http or https', function() {
      dashboard.emit('populateFromDirtyCheck', check, { match: 'hello' }, 'udp');
      should(check.getPollerParam('match')).be.undefined();
    });

    it('should add the pattern field to the check edit form', function() {
      check.setPollerParam('match', '/hello/i');
      const partials = [];
      dashboard.emit('checkEdit', 'http', check, partials);
      partials.length.should.eql(1);
      partials[0].should.containEql('name="check[match]" value="/hello/i"');
    });

  });

  describe('monitor', function() {

    let monitor;

    beforeEach(function() {
      monitor = new EventEmitter();
      patternMatcher.initMonitor({ monitor: monitor });
    });

    it('should accept a response body matching the pattern', function() {
      const check = { type: 'http', pollerParams: { match: '/hello/i' } };
      monitor.emit('pollerPolled', check, { body: 'Hello world' }, {});
    });

    it('should fail the ping when the response body does not match the pattern', function() {
      const check = { type: 'http', pollerParams: { match: '/hello/' } };
      (function() {
        monitor.emit('pollerPolled', check, { body: 'Hello world' }, {});
      }).should.throw('Response body does not match pattern /hello/');
    });

    it('should ignore checks without a pattern', function() {
      monitor.emit('pollerPolled', { type: 'http' }, { body: 'Hello world' }, {});
      monitor.emit('pollerPolled', { type: 'udp', pollerParams: { match: '/hello/' } }, { command: 'pong' }, {});
    });

  });

});
