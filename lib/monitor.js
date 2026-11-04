/**
 * Module dependencies.
 */
var EventEmitter = require('events').EventEmitter;
var PollerCollection = require('./pollers/pollerCollection');

/**
 * Monitor constructor
 *
 * The monitor pings the checks regularly and saves the response status and time.
 * The monitor doesn't interact with the model classes directly, but instead uses
 * the REST HTTP API. This way, the monitor can run on a separate process, so that the
 * ping measurements don't get distorted by a heavy usage of the GUI.
 *
 * The constructor expects a configuration object as parameter, with these properties:
 *   apiUrl: URL of the API, over http or https
 *   pollingInterval: Interval between each poll in milliseconds, defaults to 10 seconds
 *   timeout: Timeout of the polls and of the API calls in milliseconds, defaults to 5 seconds
 *   apiKey: Key sent with the API calls, as "Authorization: Bearer <apiKey>" (see lib/apiKey.js)
 *
 * @param {Object} Monitor configuration
 * @api   public
 */
function Monitor(config) {
  config.pollingInterval = config.pollingInterval || 10 * 1000;
  config.timeout = config.timeout || 5 * 1000;
  this.config = config;
  this.pollerCollection = new PollerCollection();
  this.apiHttpOptions = {};
  if (config.apiKey) {
    this.addApiHttpOption('headers', { Authorization: 'Bearer ' + config.apiKey });
  }
}

/**
 * Inherit from EventEmitter.
 */
Monitor.prototype.__proto__ = EventEmitter.prototype;

/**
 * Start the monitoring of all checks.
 *
 * The polling actually starts after the pollingInterval set to the constructor.
 *
 * @api   public
 */
Monitor.prototype.start = function() {
  // start polling right away
  this.pollChecksNeedingPoll();
  // schedule future polls
  this.intervalForPoll   = setInterval(this.pollChecksNeedingPoll.bind(this), this.config.pollingInterval);
  console.log('Monitor ' + this.config.name + ' started');
};

/**
 * Stop the monitoring of all checks
 *
 * @api   public
 */
Monitor.prototype.stop = function() {
  clearInterval(this.intervalForPoll);
  console.log('Monitor ' + this.config.name + ' stopped');
};

/**
 * Poll the checks that need to be polled.
 *
 * A check needs to be polled if it was last polled sine a longer time than its own interval.
 * The errors are logged: the returned promise is never rejected, so that an unavailable API
 * can't crash the process.
 *
 * @return {Promise} resolved once all the checks are polled
 * @api   private
 */
Monitor.prototype.pollChecksNeedingPoll = async function() {
  var self = this;
  try {
    var checks = await this.findChecksNeedingPoll();
    await Promise.all(checks.map(function(check) {
      return self.pollCheck(check).catch(function(err) {
        console.error(err);
      });
    }));
  } catch (err) {
    console.error(err);
  }
};

/**
 * @return {Promise<Array>} the checks that need to be polled, as simple JSON objects
 * @api   private
 */
Monitor.prototype.findChecksNeedingPoll = function() {
  return this.callApi('GET', '/checks/needingPoll');
};

/**
 * Poll a given check, and create a ping according to the result.
 *
 * The check is first claimed, so that it isn't polled twice if the target doesn't answer in timely fashion.
 * When the claim fails, the check isn't polled. Rejects when an API call fails.
 *
 * @param {Object} check is a simple JSON object returned by the API, NOT a Check object
 * @return {Promise<Object>} the ping returned by the API
 * @api   private
 */
Monitor.prototype.pollCheck = async function(check) {
  if (!check) return;
  await this.declarePoll(check);
  var now = Date.now();
  var result = await this.pollTarget(check);
  return this.createPing(result.error, check, now, result.time, result.details);
};

/**
 * Poll the target of a check.
 *
 * @param {Object} check is a simple JSON object returned by the API
 * @return {Promise<Object>} { error, time, details }, never rejected: a failed poll resolves with an error
 * @api   private
 */
Monitor.prototype.pollTarget = function(check) {
  var self = this;
  var details = {};
  return new Promise(function(resolve) {
    var Poller;
    try {
      Poller = self.pollerCollection.getForType(check.type || 'http');
    } catch (unknownPollerError) {
      return resolve({ error: unknownPollerError, time: 0, details: details });
    }
    // a poller may call back twice (e.g. an error after a timeout): only the first call resolves the promise
    var pollerCallback = function(err, time, res, pollerDetails) {
      if (!err) {
        try {
          self.emit('pollerPolled', check, res, pollerDetails || details);
        } catch (error) {
          err = error;
        }
      }
      resolve({ error: err, time: time, details: pollerDetails || details });
    };
    try {
      var p = new Poller(check.url, self.config.timeout, pollerCallback);
      if ('setUserAgent' in p) {
        p.setUserAgent(self.config.userAgent);
      }
      self.emit('pollerCreated', p, check, details);
      //p.setDebug(true);
      p.poll();
    } catch (incorrectPollerUrl) {
      resolve({ error: incorrectPollerUrl, time: 0, details: details });
    }
  });
};

/**
 * Claim a check, by changing its lastTested date.
 *
 * @api   private
 */
Monitor.prototype.declarePoll = function(check) {
  return this.callApi('PUT', '/check/' + encodeURIComponent(check._id) + '/test');
};

/**
 * Report the result of a poll.
 *
 * @return {Promise<Object>} the ping returned by the API
 * @api   private
 */
Monitor.prototype.createPing = function(error, check, timestamp, time, details) {
  var params = new URLSearchParams({
    checkId: check._id,
    status: error ? 'false' : 'true',
    timestamp: timestamp,
    time: time,
    name: this.config.name
  });
  if (error) {
    params.append('error', error.message);
  }
  if (details) {
    params.append('details', JSON.stringify(details));
  }
  return this.callApi('POST', '/pings', params.toString(), { 'Content-Type': 'application/x-www-form-urlencoded' });
};

/**
 * Call the API, over http or https.
 *
 * Rejects when the API isn't reachable, doesn't answer within the timeout,
 * responds with a status other than 200 (redirects included), or with something else than JSON.
 *
 * @param {String} method
 * @param {String} path the path of the resource, relative to the API URL
 * @param {String} body
 * @param {Object} headers
 * @return {Promise<Object>} the parsed response
 * @api   private
 */
Monitor.prototype.callApi = async function(method, path, body, headers) {
  var url = new URL(this.config.apiUrl + path);
  var options = {
    method: method,
    headers: headers,
    body: body,
    redirect: 'manual',
    signal: AbortSignal.timeout(this.config.timeout)
  };
  // fetch() refuses credentials in the URL: send them like the http module did, as the `auth` option
  if (url.username || url.password) {
    options.auth = decodeURIComponent(url.username) + ':' + decodeURIComponent(url.password);
    url.username = '';
    url.password = '';
  }
  var fail = function(reason) {
    return new Error('API call ' + method + ' ' + url.href + ' failed: ' + reason);
  };
  var res, text;
  try {
    res = await fetch(url, this.apiFetchOptions(options));
    // read the body even on errors, to release the connection
    text = await res.text();
  } catch (err) {
    if (err.name === 'TimeoutError') throw fail('no response within ' + this.config.timeout + 'ms');
    // fetch() rejects with "fetch failed", and its cause tells why (an AggregateError only has a code)
    throw fail((err.cause && (err.cause.message || err.cause.code)) || err.message);
  }
  if (res.status !== 200) {
    var location = res.headers.get('location');
    throw fail('HTTP status ' + res.status + (location ? ', redirect to ' + location : ''));
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw fail('the response is not JSON (' + err.message + ')');
  }
};

/**
 * Add custom HTTP options to all the API calls
 * Useful to add proxy headers, Basic HTTP auth, etc.
 * The options are fetch() options, apart from `auth` ('user:password'), which is sent
 * as a Basic Authorization header, like the http module does.
 * The `headers` option is merged with the headers added before.
 */
Monitor.prototype.addApiHttpOption = function(key, value) {
  if (key === 'headers') {
    value = Object.assign({}, this.apiHttpOptions.headers, value);
  }
  this.apiHttpOptions[key] = value;
};

/**
 * The fetch() options of an API call, with the custom HTTP options.
 * The custom headers are merged with the headers of the call (e.g. Content-Type).
 * Like the http module, `auth` is ignored when there is an Authorization header (e.g. the API key).
 *
 * @api   private
 */
Monitor.prototype.apiFetchOptions = function(options) {
  var result = Object.assign({}, options, this.apiHttpOptions);
  result.headers = Object.assign({}, options.headers, this.apiHttpOptions.headers);
  var auth = result.auth;
  delete result.auth;
  if (auth && !new Headers(result.headers).has('Authorization')) {
    result.headers.Authorization = 'Basic ' + Buffer.from(auth).toString('base64');
  }
  return result;
};

/**
 * Create a monitor to poll all checks at a given interval.
 *
 * Example:
 *
 *    m = monitor.createMonitor({ pollingInterval: 60000});
 *    m.start();
 *    // the polling starts, every 60 seconds
 *    m.stop();
 *
 * @param {Object} Configuration object
 * @api   public
 */
exports.createMonitor = function(config) {
  return new Monitor(config);
};
