const should = require('should');
const apiKey = require('../../lib/apiKey');
const Monitor = require('../../lib/monitor');

describe('apiKey', function() {

  const request = function(authorization) {
    return { headers: authorization === undefined ? {} : { authorization: authorization } };
  };

  describe('verifier()', function() {

    it('should accept the requests with the monitor.apiKey setting as a Bearer token', function() {
      const hasApiKey = apiKey.verifier({ monitor: { apiKey: 'api-key' } });
      hasApiKey(request('Bearer api-key')).should.be.true();
      hasApiKey(request('bearer api-key')).should.be.true();
      hasApiKey(request('Bearer wrong-key')).should.be.false();
      hasApiKey(request('Bearer api-key-and-more')).should.be.false();
      hasApiKey(request('api-key')).should.be.false();
      hasApiKey(request('Basic ' + Buffer.from('admin:api-key').toString('base64'))).should.be.false();
      hasApiKey(request()).should.be.false();
    });

    it('should accept the key generated for a monitor of the same process when monitor.apiKey is empty', function() {
      const hasApiKey = apiKey.verifier({ monitor: { apiKey: null } });
      const generated = apiKey.forMonitor({ monitor: {} });
      generated.should.be.a.String().and.have.length(43);
      hasApiKey(request('Bearer ' + generated)).should.be.true();
      // generated once per process, for every plugin
      apiKey.verifier({})(request('Bearer ' + generated)).should.be.true();
    });

  });

  describe('forMonitor()', function() {

    it('should prefer the monitor.apiKey setting to the generated key', function() {
      apiKey.verifier({});
      apiKey.forMonitor({ monitor: { apiKey: 'api-key' } }).should.eql('api-key');
    });

  });

  describe('monitor', function() {

    it('should send its API key with the API calls', function() {
      const monitor = Monitor.createMonitor({ name: 'test', apiUrl: 'http://127.0.0.1/api', apiKey: 'api-key' });
      monitor.addApiHttpOption('headers', { 'X-Plugin': 'other' });
      // e.g. the call that sends a ping
      const options = monitor.apiFetchOptions({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      options.method.should.eql('POST');
      options.headers.should.eql({
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': 'Bearer api-key',
        'X-Plugin':      'other'
      });
    });

    it('should send no Authorization header without an API key', function() {
      const monitor = Monitor.createMonitor({ name: 'test', apiUrl: 'http://127.0.0.1/api' });
      monitor.apiFetchOptions({}).should.eql({ headers: {} });
    });

  });

});
