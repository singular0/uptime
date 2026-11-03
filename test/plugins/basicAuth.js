const should = require('should');
const express = require('express');
const Monitor = require('../../lib/monitor');
const basicAuth = require('../../plugins/basicAuth');
const { listen, close } = require('../helpers');

describe('basicAuth plugin', function() {

  const config = { basicAuth: { username: 'admin', password: 's3cr3t' } };

  describe('webapp', function() {

    let server;

    before(async function() {
      const app = express();
      basicAuth.initWebApp({ app: app, config: config });
      app.emit('beforeFirstRoute', app);
      app.get('/', function(req, res) { res.end('hello ' + req.user); });
      server = await listen(app);
    });

    after(function() {
      return close(server);
    });

    const get = function(credentials) {
      const headers = credentials ? { Authorization: 'Basic ' + Buffer.from(credentials).toString('base64') } : {};
      return fetch(server.url + '/', { headers: headers });
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

  });

  describe('monitor', function() {

    it('should authenticate the monitor calls to the API', function() {
      const monitor = Monitor.createMonitor({ name: 'test', apiUrl: 'http://127.0.0.1/api' });
      basicAuth.initMonitor({ monitor: monitor, config: config });
      const options = {};
      monitor.applyApiHttpOptions(options);
      options.should.eql({ auth: 'admin:s3cr3t' });
    });

  });

});
