/**
 * Basic Authentication plugin
 *
 * Add HTTP Basic Access Authentication to the dashboard and API applications
 *
 * Installation
 * ------------
 * This plugin is disabled by default. To enable it, add its entry 
 * to the `plugins` key of the configuration:
 *
 *   // in config/production.yaml
 *   plugins:
 *     - ./plugins/basicAuth
 *
 * Usage
 * -----
 * Restart the application, and both the API and the Dashboard applications 
 * become protected, as well as the socket.io connection that sends live updates
 * to the dashboard. The monitor correctly authenticates its own calls to the API.
 * 
 * Default credentials are admin:password.
 *
 * API clients may also send the API key of the `monitor.apiKey` setting instead
 * of the credentials, as "Authorization: Bearer <apiKey>". The monitor sends
 * the API key when it has one, and the credentials otherwise (see lib/apiKey.js).
 *
 * Configuration
 * -------------
 * Set the username and password in the configuration file, under the
 * basicAuth key:
 *
 *   // in config/production.yaml
 *   basicAuth:
 *     username: JohnDoe
 *     password: S3cR3t
 */
var crypto    = require('crypto');
var basicAuth = require('basic-auth');
var onlyForHandshake = require('../../lib/onlyForHandshake');
var apiKey    = require('../../lib/apiKey');

// constant-time string comparison
var safeEqual = function(a, b) {
  var bufferA = Buffer.from(String(a));
  var bufferB = Buffer.from(String(b));
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
};

exports.initWebApp = function(options) {
  var config = options.config.basicAuth;
  var hasApiKey = apiKey.verifier(options.config);
  // only uses the node.js request and response API, since socket.io requests don't go through express
  var basicAuthMiddleware = function(req, res, next) {
    if (hasApiKey(req)) return next();
    var credentials = basicAuth.parse(req.headers.authorization || '');
    if (credentials && safeEqual(credentials.name, config.username) && safeEqual(credentials.pass, config.password)) {
      req.user = req.remoteUser = credentials.name;
      return next();
    }
    res.statusCode = 401;
    res.setHeader('WWW-Authenticate', 'Basic realm="Authorization Required"');
    res.end('Unauthorized');
  };
  options.app.on('beforeFirstRoute', function(app, dashboardApp) {
    app.use(basicAuthMiddleware);
  });
  options.io.engine.use(onlyForHandshake(basicAuthMiddleware));
};

exports.initMonitor = function(options) {
  // a monitor with an API key sends it in the Authorization header, which takes precedence over `auth`
  if (options.monitor.config.apiKey) return;
  var config = options.config.basicAuth;
  options.monitor.addApiHttpOption('auth', config.username + ':' + config.password);
};