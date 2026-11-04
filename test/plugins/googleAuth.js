const should = require('should');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');
const { Server } = require('socket.io');
const Monitor = require('../../lib/monitor');
const onlyForHandshake = require('../../lib/onlyForHandshake');
const googleAuth = require('../../plugins/googleAuth');
const { listen, close } = require('../helpers');

const ONE_DAY = 24 * 60 * 60 * 1000;

const sha256 = function(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
};

// an ID token with an invalid signature, which the plugin doesn't check
const idToken = function(claims) {
  const encode = function(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); };
  return encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode(claims) + '.signature';
};

describe('googleAuth plugin', function() {

  // fake Google token endpoint, which answers the codes given by comeBack()
  let google;
  const codes = new Map();
  const tokenRequests = [];

  before(async function() {
    const app = express();
    app.use(express.urlencoded({ extended: false }));
    app.post('/token', function(req, res) {
      tokenRequests.push(req.body);
      const grant = codes.get(req.body.code);
      codes.delete(req.body.code);
      if (!grant || req.body.grant_type !== 'authorization_code' || req.body.client_id !== 'client-id' ||
        req.body.client_secret !== 'client-secret' || req.body.redirect_uri !== grant.redirectUri ||
        sha256(req.body.code_verifier) !== grant.codeChallenge) {
        return res.status(400).json({ error: 'invalid_grant' });
      }
      res.json({ access_token: 'access-token', token_type: 'Bearer', expires_in: 3599, id_token: idToken(grant.claims) });
    });
    google = await listen(app);
  });

  after(function() {
    return close(google);
  });

  // the webapp of app.js, with the plugin
  const startApp = async function(settings) {
    const app = express();
    const server = await listen(app);
    const io = server.io = new Server(server);
    const session = cookieSession({ name: 'uptime', secret: 'session secret', maxAge: 60 * 60 * 1000, sameSite: 'lax' });
    app.use(session);
    io.engine.use(onlyForHandshake(session));
    googleAuth.initWebApp({ app: app, io: io, config: {
      url: server.url,
      monitor: { apiKey: 'api-key' },
      googleAuth: Object.assign({
        clientId:         'client-id',
        clientSecret:     'client-secret',
        allowedDomains:   ['Example.com'],
        allowedEmails:    ['Jane.Doe@gmail.com'],
        authorizationUrl: google.url + '/auth',
        tokenUrl:         google.url + '/token'
      }, settings)
    } });
    app.emit('beforeFirstRoute', app);
    app.get('/dashboard/vendor/bootstrap.css', function(req, res) { res.send('css'); });
    app.get('/dashboard/checks', function(req, res) { res.json({ user: req.user, locals: res.locals.user }); });
    app.post('/dashboard/checks', function(req, res) { res.json('created'); });
    app.get('/api/checks', function(req, res) { res.json([]); });
    return server;
  };

  const stopApp = function(server) {
    server.io.engine.close();
    return close(server);
  };

  // a browser, which keeps the cookies and doesn't follow redirects
  const browser = function(server) {
    const cookies = {};
    const get = async function(path, options) {
      options = Object.assign({ redirect: 'manual' }, options);
      options.headers = Object.assign({ Accept: 'text/html,*/*;q=0.8' }, options.headers);
      const cookie = Object.keys(cookies).map(function(name) { return name + '=' + cookies[name]; }).join('; ');
      if (cookie) options.headers.Cookie = cookie;
      const res = await fetch(server.url + path, options);
      res.headers.getSetCookie().forEach(function(header) {
        const pair = header.split(';')[0];
        const name = pair.slice(0, pair.indexOf('='));
        const value = pair.slice(pair.indexOf('=') + 1);
        if (value === '' || /expires=Thu, 01 Jan 1970/i.test(header)) {
          delete cookies[name];
        } else {
          cookies[name] = value;
        }
      });
      res.text = await res.text();
      return res;
    };
    get.cookies = cookies;
    return get;
  };

  // follows the redirects of the browser up to Google, and returns the parameters of the authorization request
  const goToGoogle = async function(get, path) {
    let res = await get(path);
    while (res.status === 302 && !res.headers.get('location').startsWith(google.url)) {
      res = await get(res.headers.get('location'));
    }
    res.status.should.eql(302);
    return new URL(res.headers.get('location')).searchParams;
  };

  // Google sends the browser back to the callback, with a code for an account with these claims
  const comeBack = function(get, params, claims) {
    const code = crypto.randomUUID();
    codes.set(code, {
      codeChallenge: params.get('code_challenge'),
      redirectUri:   params.get('redirect_uri'),
      claims: Object.assign({
        iss:   'https://accounts.google.com',
        aud:   'client-id',
        exp:   Math.floor(Date.now() / 1000) + 3600,
        nonce: params.get('nonce')
      }, claims)
    });
    return get('/auth/google/callback?' + new URLSearchParams({ code: code, state: params.get('state') }));
  };

  const login = async function(get, claims, path) {
    return comeBack(get, await goToGoogle(get, path || '/dashboard/checks'), claims);
  };

  const john = { email: 'john@example.com', email_verified: true, hd: 'example.com', name: 'John Smith' };
  const jane = { email: 'jane.doe@gmail.com', email_verified: true, name: 'Jane Doe' };

  describe('webapp', function() {

    let server, get;

    before(async function() {
      server = await startApp();
    });

    after(function() {
      return stopApp(server);
    });

    beforeEach(function() {
      get = browser(server);
    });

    it('should send a browser to Google to log in, then back to the page it asked for', async function() {
      let res = await get('/dashboard/checks?tag=web');
      res.status.should.eql(302);
      res.headers.get('location').should.eql('/auth/google?returnTo=%2Fdashboard%2Fchecks%3Ftag%3Dweb');
      res = await get(res.headers.get('location'));
      res.status.should.eql(302);
      const authorization = new URL(res.headers.get('location'));
      (authorization.origin + authorization.pathname).should.eql(google.url + '/auth');
      const params = Object.fromEntries(authorization.searchParams);
      params.should.have.properties({
        client_id:             'client-id',
        redirect_uri:          server.url + '/auth/google/callback',
        response_type:         'code',
        scope:                 'openid email profile',
        code_challenge_method: 'S256'
      });
      params.should.have.properties(['state', 'nonce', 'code_challenge']);
      params.should.not.have.property('prompt');
      res = await comeBack(get, authorization.searchParams, john);
      res.status.should.eql(302);
      res.headers.get('location').should.eql('/dashboard/checks?tag=web');
    });

    it('should log in an account of an allowed domain', async function() {
      (await login(get, john)).status.should.eql(302);
      const res = await get('/dashboard/checks');
      res.status.should.eql(200);
      JSON.parse(res.text).should.eql({
        user:   'john@example.com',
        locals: { name: 'John Smith', email: 'john@example.com', logoutUrl: '/auth/logout' }
      });
    });

    it('should log in an allowed email', async function() {
      (await login(get, jane)).status.should.eql(302);
      (await get('/dashboard/checks')).status.should.eql(200);
    });

    it('should refuse a personal account with an email of an allowed domain', async function() {
      const res = await login(get, { email: 'john@example.com', email_verified: true });
      res.status.should.eql(403);
      res.text.should.containEql('john@example.com is not allowed');
      res.text.should.containEql('/auth/google?prompt=select_account');
      (await get('/dashboard/checks')).status.should.eql(302);
    });

    it('should refuse an allowed email that Google did not verify', async function() {
      (await login(get, Object.assign({}, jane, { email_verified: false }))).status.should.eql(403);
      (await get('/dashboard/checks')).status.should.eql(302);
    });

    it('should refuse an ID token issued for another login', async function() {
      const cases = [
        { nonce: 'other nonce' },
        { aud: 'other-client-id' },
        { iss: 'https://evil.example' },
        { exp: Math.floor(Date.now() / 1000) - 60 }
      ];
      for (const claims of cases) {
        get = browser(server);
        const res = await login(get, Object.assign({}, john, claims));
        res.status.should.eql(502, JSON.stringify(claims));
        (await get('/dashboard/checks')).status.should.eql(302);
      }
    });

    it('should refuse a callback with another state', async function() {
      const params = await goToGoogle(get, '/dashboard/checks');
      params.set('state', 'forged');
      const nbTokenRequests = tokenRequests.length;
      const res = await comeBack(get, params, john);
      res.status.should.eql(400);
      tokenRequests.length.should.eql(nbTokenRequests);
      (await get('/dashboard/checks')).status.should.eql(302);
    });

    it('should refuse a code that Google rejects', async function() {
      const params = await goToGoogle(get, '/dashboard/checks');
      const res = await get('/auth/google/callback?' + new URLSearchParams({ code: 'unknown', state: params.get('state') }));
      res.status.should.eql(502);
      res.text.should.containEql('invalid_grant');
    });

    it('should tell when the user cancels the login', async function() {
      const params = await goToGoogle(get, '/dashboard/checks');
      const res = await get('/auth/google/callback?' + new URLSearchParams({ error: 'access_denied', state: params.get('state') }));
      res.status.should.eql(401);
      res.text.should.containEql('access_denied');
    });

    it('should only return to a page of the site', async function() {
      for (const returnTo of ['//evil.example/', '/\\evil.example', '/\t/evil.example', 'https://evil.example/']) {
        get = browser(server);
        const res = await login(get, john, '/auth/google?' + new URLSearchParams({ returnTo: returnTo }));
        res.headers.get('location').should.eql('/', returnTo);
      }
      get = browser(server);
      const res = await login(get, john, '//evil.example/');
      res.headers.get('location').should.eql('/');
    });

    it('should let the user choose another account', async function() {
      const params = await goToGoogle(get, '/auth/google?prompt=select_account');
      params.get('prompt').should.eql('select_account');
    });

    it('should log out', async function() {
      await login(get, john);
      const res = await get('/auth/logout', { method: 'POST' });
      res.status.should.eql(200);
      res.text.should.containEql('You are logged out');
      get.cookies.should.be.empty();
      (await get('/dashboard/checks')).status.should.eql(302);
    });

    it('should end a session unused for sessionMaxAge', async function() {
      await login(get, john);
      const now = Date.now;
      try {
        // each request more than a minute after the last one extends the session
        Date.now = function() { return now() + 2 * 60 * 1000; };
        let res = await get('/dashboard/checks');
        res.status.should.eql(200);
        res.headers.getSetCookie().length.should.be.above(0);
        Date.now = function() { return now() + 2 * 60 * 1000 + ONE_DAY - 60 * 1000; };
        (await get('/dashboard/checks')).status.should.eql(200);
        Date.now = function() { return now() + 2 * 60 * 1000 + 2 * ONE_DAY; };
        (await get('/dashboard/checks')).status.should.eql(302);
      } finally {
        Date.now = now;
      }
    });

    it('should answer API clients, scripts and forms with a 401', async function() {
      let res = await get('/api/checks');
      res.status.should.eql(401);
      res.headers.get('www-authenticate').should.eql('Bearer');
      (await get('/dashboard/checks', { headers: { Accept: '*/*' } })).status.should.eql(401);
      (await get('/dashboard/checks', { headers: { Accept: 'application/json' } })).status.should.eql(401);
      (await get('/dashboard/checks', { method: 'POST' })).status.should.eql(401);
    });

    it('should let API clients in with the API key', async function() {
      (await get('/api/checks', { headers: { Authorization: 'Bearer api-key' } })).status.should.eql(200);
      (await get('/dashboard/checks', { method: 'POST', headers: { Authorization: 'Bearer api-key' } })).status.should.eql(200);
      (await get('/api/checks', { headers: { Authorization: 'Bearer wrong-key' } })).status.should.eql(401);
      (await get('/api/checks', { headers: { Authorization: 'api-key' } })).status.should.eql(401);
    });

    it('should serve the files of the login pages without login', async function() {
      (await get('/dashboard/vendor/bootstrap.css')).status.should.eql(200);
    });

  });

  describe('socket.io', function() {

    let server;

    before(async function() {
      server = await startApp();
    });

    after(function() {
      return stopApp(server);
    });

    const handshake = '/socket.io/?EIO=4&transport=polling';

    // resolves with true when the WebSocket opens, false when the server refuses it
    const openWebSocket = function(headers) {
      return new Promise(function(resolve) {
        const ws = new WebSocket(server.url.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket', { headers: headers });
        ws.onopen = function() { ws.close(); resolve(true); };
        ws.onerror = function() { resolve(false); };
      });
    };

    it('should refuse an anonymous connection', async function() {
      (await browser(server)(handshake)).status.should.eql(401);
      (await openWebSocket({})).should.be.false();
    });

    it('should accept the connection of a logged in user', async function() {
      const get = browser(server);
      await login(get, john);
      const res = await get(handshake);
      res.status.should.eql(200);
      res.text.should.startWith('0{"sid":');
      const cookie = Object.keys(get.cookies).map(function(name) { return name + '=' + get.cookies[name]; }).join('; ');
      (await openWebSocket({ Cookie: cookie })).should.be.true();
    });

    it('should accept the connection of an API client', async function() {
      const res = await browser(server)(handshake, { headers: { Authorization: 'Bearer api-key' } });
      res.status.should.eql(200);
    });

  });

  describe('configuration', function() {

    const init = function(settings) {
      const app = express();
      const io = { engine: { use: function() {} } };
      googleAuth.initWebApp({ app: app, io: io, config: { url: 'http://localhost:8080', googleAuth: settings } });
    };

    it('should require an OAuth client', function() {
      (function() { init({ allowedDomains: ['example.com'] }); }).should.throw(/clientId/);
    });

    it('should require a domain or an email', function() {
      (function() { init({ clientId: 'id', clientSecret: 'secret', allowedDomains: [], allowedEmails: null }); }).should.throw(/allowedDomains or googleAuth.allowedEmails/);
      (function() { init({ clientId: 'id', clientSecret: 'secret', allowedEmails: 'jane.doe@gmail.com' }); }).should.not.throw();
    });

  });

  describe('monitor', function() {

    // the warnings of initMonitor()
    const warnings = function(monitorConfig) {
      const monitor = Monitor.createMonitor(Object.assign({ name: 'test', apiUrl: 'http://127.0.0.1/api' }, monitorConfig));
      const messages = [];
      const consoleError = console.error;
      console.error = function(message) { messages.push(message); };
      try {
        googleAuth.initMonitor({ monitor: monitor, config: {} });
      } finally {
        console.error = consoleError;
      }
      return messages;
    };

    it('should warn when the monitor has no API key', function() {
      warnings({}).should.match([/monitor\.apiKey is not set/]);
      warnings({ apiKey: 'api-key' }).should.eql([]);
    });

  });

});
