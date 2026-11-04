/**
 * Google Login plugin
 *
 * Restrict access to the dashboard and the API to Google accounts, from a list
 * of Google Workspace domains or a list of email addresses.
 *
 * Installation
 * ------------
 * This plugin is disabled by default. To enable it, add its entry
 * to the `plugins` key of the configuration (instead of the basicAuth plugin):
 *
 *   // in config/production.yaml
 *   plugins:
 *     - ./plugins/googleAuth
 *
 * In the Google Cloud console, create an OAuth client ID of type "Web application"
 * (APIs & Services > Credentials), and add the `url` setting followed by /auth/google/callback
 * to its authorized redirect URIs. For instance, with `url: 'https://uptime.example.com'`,
 * the redirect URI is https://uptime.example.com/auth/google/callback.
 *
 * Configuration
 * -------------
 *   // in config/production.yaml
 *   url: 'https://uptime.example.com' # the address that users browse to
 *   session:
 *     secret: <long random string>    # otherwise, users log in again after each restart
 *   googleAuth:
 *     clientId:     <client ID>.apps.googleusercontent.com
 *     clientSecret: <client secret>
 *     allowedDomains: [example.com]          # Google Workspace domains
 *     allowedEmails:  [jane.doe@gmail.com]   # Google accounts
 *     apiKey: <long random string>
 *     sessionMaxAge: 86400000                # in milliseconds after the last request (default: one day)
 *
 * A user may log in when their account matches either list:
 *
 * - `allowedDomains` matches the Google Workspace (or Cloud Identity) organization of the account,
 *   not the domain of its email address: a personal Google account created with an address
 *   of the domain doesn't match. List gmail.com addresses in `allowedEmails`.
 * - `allowedEmails` matches the email address of the account, if Google verified it.
 *
 * Usage
 * -----
 * Restart the application. Browsers are sent to Google to log in, then back to the page
 * they asked for. The navbar shows the user and lets them log out. A session lasts
 * `sessionMaxAge` after the last request. The socket.io connection that sends live
 * updates to the dashboard is protected too.
 *
 * The monitor and other API clients authenticate with the API key instead:
 *
 *   curl -H 'Authorization: Bearer <apiKey>' https://uptime.example.com/api/checks
 *
 * When `apiKey` is empty, a random key is generated on each start. Only a monitor that runs
 * in the webapp process (`autoStartMonitor: true`) knows it. A monitor started with
 * `node monitor` needs the `apiKey` of the webapp.
 *
 * Requests to Google don't use the `https_proxy` environment variable, unless
 * Node.js runs with NODE_USE_ENV_PROXY=1.
 */
const crypto = require('crypto');
const path   = require('path');
const ejs    = require('ejs');
const onlyForHandshake = require('../../lib/onlyForHandshake');

const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_MINUTE = 60 * 1000;
// dashboard files used by the login pages, served without login
const PUBLIC_PATH = /^\/dashboard\/(vendor|javascripts|stylesheets)\/|^\/(dashboard\/)?favicon(_red)?\.ico$/;
const PAGE_TEMPLATE = path.join(__dirname, 'views', 'page.ejs');

// shared by the webapp and a monitor started in the same process
const generatedApiKey = crypto.randomBytes(32).toString('base64url');
let webAppStarted = false;

const randomString = function() {
  return crypto.randomBytes(32).toString('base64url');
};

// constant-time string comparison
const safeEqual = function(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  return bufferA.length === bufferB.length && crypto.timingSafeEqual(bufferA, bufferB);
};

const lowerCase = function(list) {
  return [].concat(list || []).map(function(item) { return String(item).toLowerCase(); });
};

// The path and query of a URL on this site. A crafted returnTo such as //evil.example
// or /\evil.example would otherwise send the user to another site after the login.
const localPath = function(value) {
  const base = new URL('http://localhost');
  const target = typeof value === 'string' && URL.parse(value, base);
  return target && target.origin === base.origin ? target.pathname + target.search : '/';
};

// The claims of an ID token returned by the token endpoint. It comes straight from Google over HTTPS,
// so its signature needs no check (OpenID Connect Core 1.0, section 3.1.3.7), but its claims do.
const readIdToken = function(idToken, clientId, nonce) {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString());
  } catch (err) {
    return null;
  }
  if (!claims || !GOOGLE_ISSUERS.includes(claims.iss)) return null;
  if (claims.aud !== clientId) return null;
  if (!(claims.exp * 1000 > Date.now())) return null;
  if (typeof claims.nonce !== 'string' || !safeEqual(claims.nonce, nonce)) return null;
  if (typeof claims.email !== 'string') return null;
  return claims;
};

const renderPage = async function(res, status, message, link) {
  const html = await ejs.renderFile(PAGE_TEMPLATE, { message: message, link: link });
  res.status(status).send(html);
};

exports.initWebApp = function(options) {
  const config = options.config;
  const settings = config.googleAuth || {};
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('googleAuth plugin: set googleAuth.clientId and googleAuth.clientSecret');
  }
  const allowedDomains = lowerCase(settings.allowedDomains);
  const allowedEmails = lowerCase(settings.allowedEmails);
  if (!allowedDomains.length && !allowedEmails.length) {
    throw new Error('googleAuth plugin: set googleAuth.allowedDomains or googleAuth.allowedEmails, otherwise nobody can log in');
  }
  const apiKey = settings.apiKey || generatedApiKey;
  const sessionMaxAge = Number(settings.sessionMaxAge) || ONE_DAY;
  const authorizationUrl = settings.authorizationUrl || 'https://accounts.google.com/o/oauth2/v2/auth'; // overridden by the tests
  const tokenUrl = settings.tokenUrl || 'https://oauth2.googleapis.com/token';
  const redirectUri = new URL('/auth/google/callback', config.url).href;
  webAppStarted = true;

  const isAllowed = function(account) {
    return (typeof account.domain === 'string' && allowedDomains.includes(account.domain.toLowerCase())) ||
      (account.emailVerified === true && allowedEmails.includes(account.email.toLowerCase()));
  };

  const hasApiKey = function(req) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    return match !== null && safeEqual(match[1], apiKey);
  };

  // The logged in user, if the session hasn't expired. The cookie expiry is only a hint
  // for the browser, so the session also records when it was last used.
  const sessionUser = function(req) {
    const user = req.session.user;
    if (!user) return null;
    const now = Date.now();
    // the lists are checked again, in case they changed since the login
    if (!(now - user.seen < sessionMaxAge) || !isAllowed(user)) {
      delete req.session.user;
      return null;
    }
    req.sessionOptions.maxAge = sessionMaxAge;
    if (now - user.seen > ONE_MINUTE) user.seen = now; // extends the session, but saves the cookie at most once a minute
    return user;
  };

  const tryAgain = { text: 'Log in with Google', href: '/auth/google' };
  const otherAccount = { text: 'Use another account', href: '/auth/google?prompt=select_account' };
  const loginAgain = { text: 'Log in again', href: '/auth/google?prompt=select_account' };

  // sends the browser to Google, which sends it back to the callback
  const login = function(req, res) {
    const flow = req.session.googleAuth = {
      state:    randomString(),
      nonce:    randomString(),
      verifier: randomString(),
      returnTo: localPath(req.query.returnTo)
    };
    const url = new URL(authorizationUrl);
    url.search = new URLSearchParams({
      client_id:             settings.clientId,
      redirect_uri:          redirectUri,
      response_type:         'code',
      scope:                 'openid email profile',
      state:                 flow.state,
      nonce:                 flow.nonce,
      code_challenge:        crypto.createHash('sha256').update(flow.verifier).digest('base64url'),
      code_challenge_method: 'S256'
    });
    if (req.query.prompt === 'select_account') url.searchParams.set('prompt', 'select_account');
    res.redirect(url.href);
  };

  const callback = async function(req, res) {
    const flow = req.session.googleAuth;
    delete req.session.googleAuth;
    if (req.query.error) {
      return renderPage(res, 401, 'The Google login failed (' + req.query.error + ').', tryAgain);
    }
    if (!flow || typeof req.query.state !== 'string' || !safeEqual(req.query.state, flow.state) || typeof req.query.code !== 'string') {
      return renderPage(res, 400, 'The Google login expired, or was started in another tab.', tryAgain);
    }
    let response;
    try {
      response = await fetch(tokenUrl, {
        method:  'POST',
        headers: { Accept: 'application/json' },
        body:    new URLSearchParams({
          code:          req.query.code,
          client_id:     settings.clientId,
          client_secret: settings.clientSecret,
          redirect_uri:  redirectUri,
          grant_type:    'authorization_code',
          code_verifier: flow.verifier
        }),
        signal: AbortSignal.timeout(10000)
      });
    } catch (err) {
      return renderPage(res, 502, 'Google can\'t be reached (' + err.message + ').', tryAgain);
    }
    const body = await response.json().catch(function() { return {}; });
    if (!response.ok || typeof body.id_token !== 'string') {
      return renderPage(res, 502, 'Google refused the login (' + (body.error || response.status) + ').', tryAgain);
    }
    const claims = readIdToken(body.id_token, settings.clientId, flow.nonce);
    if (!claims) {
      return renderPage(res, 502, 'Google returned an invalid ID token.', tryAgain);
    }
    const user = {
      email:         claims.email,
      name:          typeof claims.name === 'string' ? claims.name : claims.email,
      domain:        claims.hd,
      emailVerified: claims.email_verified === true,
      seen:          Date.now()
    };
    if (!isAllowed(user)) {
      return renderPage(res, 403, user.email + ' is not allowed to use this Uptime.', otherAccount);
    }
    req.session.user = user;
    req.sessionOptions.maxAge = sessionMaxAge;
    res.redirect(flow.returnTo);
  };

  const logout = function(req, res) {
    req.session = null;
    return renderPage(res, 200, 'You are logged out.', loginAgain);
  };

  const guard = function(req, res, next) {
    if (PUBLIC_PATH.test(req.path) || hasApiKey(req)) return next();
    const user = sessionUser(req);
    if (user) {
      req.user = user.email;
      res.locals.user = { name: user.name, email: user.email, logoutUrl: '/auth/logout' };
      return next();
    }
    // a browser visiting a page logs in, an API client or a script gets an error
    if (req.method === 'GET' && !/^\/api(\/|$)/.test(req.path) && req.accepts(['json', 'html']) === 'html') {
      return res.redirect('/auth/google?returnTo=' + encodeURIComponent(req.originalUrl));
    }
    res.status(401).set('WWW-Authenticate', 'Bearer').send('Unauthorized');
  };

  // only uses the node.js request and response API, since socket.io requests don't go through express
  const socketGuard = function(req, res, next) {
    if (hasApiKey(req) || sessionUser(req)) return next();
    res.statusCode = 401;
    res.end('Unauthorized');
  };

  options.app.on('beforeFirstRoute', function(app) {
    app.get('/auth/google', login);
    app.get('/auth/google/callback', callback);
    app.post('/auth/logout', logout);
    app.use(guard);
  });
  options.io.engine.use(onlyForHandshake(socketGuard));
};

exports.initMonitor = function(options) {
  const settings = options.config.googleAuth || {};
  if (!settings.apiKey && !webAppStarted) {
    console.error('Warning: googleAuth.apiKey is not set, so the monitor can only call the API of a webapp running in the same process');
  }
  options.monitor.addApiHttpOption('headers', { Authorization: 'Bearer ' + (settings.apiKey || generatedApiKey) });
};
