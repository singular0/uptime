const should = require('should');
const mongoose = require('../../bootstrap');
const app = require('../../app');
const { listen, close, request } = require('../helpers');

describe('GET /health', function() {

  let server, health;

  before(async function() {
    server = await listen(app);
    health = server.url + '/health';
    // the first test may run before the connection opens
    await mongoose.connection.asPromise();
  });

  afterEach(function() {
    app.set('monitor', undefined);
    delete mongoose.connection.readyState; // see 'should fail when MongoDB is disconnected'
  });

  after(function() {
    return close(server);
  });

  it('should succeed when MongoDB is connected', async function() {
    const res = await request(health);
    res.status.should.eql(200);
    res.body.should.eql({ status: 'ok', mongodb: 'connected' });
    res.headers.get('cache-control').should.eql('no-store');
    should.not.exist(res.headers.get('set-cookie'));
  });

  it('should fail when MongoDB is disconnected', async function() {
    // shadows the readyState getter of the connection, without disconnecting the other suites
    Object.defineProperty(mongoose.connection, 'readyState', { value: 0, configurable: true });
    const res = await request(health);
    res.status.should.eql(503);
    res.body.should.eql({ status: 'error', mongodb: 'disconnected' });
  });

  it('should report the monitor of the process', async function() {
    app.set('monitor', { isHealthy: function() { return true; } });
    const res = await request(health);
    res.status.should.eql(200);
    res.body.should.eql({ status: 'ok', mongodb: 'connected', monitor: 'ok' });
  });

  it('should fail when the monitor of the process stopped reaching the API', async function() {
    app.set('monitor', { isHealthy: function() { return false; } });
    const res = await request(health);
    res.status.should.eql(503);
    res.body.should.eql({ status: 'error', mongodb: 'connected', monitor: 'stale' });
  });

});
