const should = require('should');
const express = require('express');
const { Server } = require('socket.io');
const Monitor = require('../../lib/monitor');
const basicAuth = require('../../plugins/basicAuth');
const { listen, close } = require('../helpers');

describe('basicAuth plugin', function() {

  const config = { basicAuth: { username: 'admin', password: 's3cr3t' }, monitor: { apiKey: 'api-key' } };

  describe('webapp', function() {

    let server, io;

    before(async function() {
      const app = express();
      server = await listen(app);
      io = new Server(server);
      basicAuth.initWebApp({ app: app, io: io, config: config });
      app.emit('beforeFirstRoute', app);
      app.get('/', function(req, res) { res.end('hello ' + req.user); });
    });

    after(function() {
      io.engine.close();
      return close(server);
    });

    // credentials are user:password, or a Bearer authorization
    const get = function(credentials, path) {
      const headers = {};
      if (credentials) {
        headers.Authorization = credentials.startsWith('Bearer ') ? credentials : 'Basic ' + Buffer.from(credentials).toString('base64');
      }
      return fetch(server.url + (path || '/'), { headers: headers });
    };

    it('should ask for credentials', async function() {
      const res = await get();
      res.status.should.eql(401);
      res.headers.get('www-authenticate').should.eql('Basic realm="Authorization Required"');
    });

    it('should reject wrong credentials', async function() {
      (await get('admin:wrong')).status.should.eql(401);
      (await get('root:s3cr3t')).status.should.eql(401);
    });

    it('should accept the configured credentials', async function() {
      const res = await get('admin:s3cr3t');
      res.status.should.eql(200);
      (await res.text()).should.eql('hello admin');
    });

    it('should accept the API key', async function() {
      (await get('Bearer api-key')).status.should.eql(200);
      (await get('Bearer wrong-key')).status.should.eql(401);
    });

    it('should protect the socket.io connection', async function() {
      const handshake = '/socket.io/?EIO=4&transport=polling';
      (await get(undefined, handshake)).status.should.eql(401);
      (await get('admin:wrong', handshake)).status.should.eql(401);
      const res = await get('admin:s3cr3t', handshake);
      res.status.should.eql(200);
      (await res.text()).should.startWith('0{"sid":');
      (await get('Bearer api-key', handshake)).status.should.eql(200);
    });

  });

  describe('monitor', function() {

    it('should authenticate the monitor calls to the API with the credentials', function() {
      const monitor = Monitor.createMonitor({ name: 'test', apiUrl: 'http://127.0.0.1/api' });
      basicAuth.initMonitor({ monitor: monitor, config: config });
      const options = {};
      monitor.applyApiHttpOptions(options);
      options.should.eql({ auth: 'admin:s3cr3t' });
    });

    it('should let a monitor with an API key send it instead of the credentials', function() {
      const monitor = Monitor.createMonitor({ name: 'test', apiUrl: 'http://127.0.0.1/api', apiKey: 'api-key' });
      basicAuth.initMonitor({ monitor: monitor, config: config });
      const options = {};
      monitor.applyApiHttpOptions(options);
      options.should.eql({ headers: { Authorization: 'Bearer api-key' } });
    });

  });

});
