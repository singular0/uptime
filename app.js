/*
 * Monitor remote server uptime.
 */

const http       = require('http');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const express    = require('express');
const config     = require('./lib/config');
const { Server } = require('socket.io');
const methodOverride = require('method-override');
const cookieParser   = require('cookie-parser');
const cookieSession  = require('cookie-session');
const errorHandler   = require('errorhandler');
const onlyForHandshake = require('./lib/onlyForHandshake');
const analyzer   = require('./lib/analyzer');
const CheckEvent = require('./models/checkEvent');
const Ping       = require('./models/ping');
const PollerCollection = require('./lib/pollers/pollerCollection');
const apiApp     = require('./app/api/app');
const dashboardApp = require('./app/dashboard/app');

// database

const mongoose   = require('./bootstrap');

const a = analyzer.createAnalyzer(config.analyzer);
a.start();

// web front

const app = module.exports = express();
const server = http.createServer(app);
const io = new Server(server);

// the following middlewares are only necessary for the mounted 'dashboard' app,
// but express needs it on the parent app (?) and it therefore pollutes the api
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// HTML forms send PUT and DELETE requests as POST with a _method field, which takes precedence over the header
app.use(methodOverride('X-HTTP-Method-Override'));
app.use(methodOverride(function(req) {
  if (req.body && typeof req.body === 'object' && '_method' in req.body) {
    const method = req.body._method;
    delete req.body._method;
    return method;
  }
}));
// signs the cookies. A generated secret changes on every start, which ends the sessions
let secret = config.session && config.session.secret;
if (!secret) {
  secret = crypto.randomBytes(32).toString('base64url');
  console.log('session.secret is not set: using a random secret, sessions end when Uptime restarts');
}
app.use(cookieParser(secret));
const session = cookieSession({
  name:     'uptime',
  secret:   secret,
  maxAge:   60 * 60 * 1000,
  sameSite: 'lax' // not sent with cross-site POST requests (CSRF)
});
app.use(session);
// socket.io answers its own requests: give its handshake the session too, for the authentication plugins
io.engine.use(onlyForHandshake(session));
app.set('pollerCollection', new PollerCollection());

// load plugins (may add their own routes and middlewares)
config.plugins.forEach(function(pluginName) {
  const plugin = require(pluginName);
  if (typeof plugin.initWebApp !== 'function') return;
  console.log('loading plugin %s on app', pluginName);
  plugin.initWebApp({
    app:       app,
    api:       apiApp,       // mounted into app, but required for events
    dashboard: dashboardApp, // mounted into app, but required for events
    io:        io,
    config:    config,
    mongoose:  mongoose
  });
});

app.emit('beforeFirstRoute', app, apiApp);

if (app.get('env') === 'development') {
  if (config.verbose) mongoose.set('debug', true);
  app.use(express.static(path.join(__dirname, 'public')));
  app.use(errorHandler());
}

if (app.get('env') === 'production') {
  const oneYear = 31557600000;
  app.use(express.static(path.join(__dirname, 'public'), { maxAge: oneYear }));
  app.use(errorHandler());
}

// Routes
app.emit('beforeApiRoutes', app, apiApp);
app.use('/api', apiApp);

app.emit('beforeDashboardRoutes', app, dashboardApp);
app.use('/dashboard', dashboardApp);
app.get('/', function(req, res) {
  res.redirect('/dashboard/events');
});

app.get('/favicon.ico', function(req, res) {
  res.redirect(301, '/dashboard/favicon.ico');
});

app.emit('afterLastRoute', app);

// Sockets
CheckEvent.on('afterInsert', function(event) {
  io.emit('CheckEvent', event.toJSON());
});

// pings are only sent to the sockets watching the related check (see 'set check')
Ping.on('afterInsert', function(ping) {
  io.to('check:' + ping.check).emit('ping', ping.toJSON());
});

io.on('connection', function(socket) {
  socket.on('set check', function(check) {
    if (socket.data.check) socket.leave('check:' + socket.data.check);
    socket.data.check = check;
    socket.join('check:' + check);
  });
});

// old way to load plugins, kept for BC
if (fs.existsSync(path.join(__dirname, 'plugins', 'index.js'))) {
  const pluginIndex = require('./plugins');
  const initFunction = pluginIndex.init || pluginIndex.initWebApp;
  if (typeof initFunction === 'function') {
    initFunction({
      app:       app,
      api:       apiApp,       // mounted into app, but required for events
      dashboard: dashboardApp, // mounted into app, but required for events
      io:        io,
      config:    config,
      mongoose:  mongoose
    });
  }
}

module.exports = app;

let monitorInstance;

if (require.main === module) {
  // the address to listen on, which isn't the url that users browse to behind a reverse proxy or a port mapping
  const listen = config.server || {};
  const port = process.env.PORT || listen.port || 8080;
  const host = process.env.HOST || listen.host || '0.0.0.0';
  server.listen(port, host, function(){
    console.log("Express server listening on host %s, port %d in %s mode", host, port, app.get('env'));
  });
  server.on('error', function(e) {
    if (monitorInstance) {
      monitorInstance.stop();
      process.exit(1);
    }
  });
}

// monitor
if (config.autoStartMonitor) {
  monitorInstance = require('./monitor');
}
