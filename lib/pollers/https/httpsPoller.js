/**
 * Module dependencies.
 */

var util  = require('util');
var https = require('https');
var http  = require('http');
var fs    = require('fs');
var ejs   = require('ejs');
var BaseHttpPoller = require('../http/baseHttpPoller');

// The http module lacks proxy support. Let's monkey-patch it.
require('../../proxy');

/**
 * HTTPS Poller, to check web pages served via SSL
 *
 * @param {Mixed} Poller Target (e.g. URL)
 * @param {Number} Poller timeout in milliseconds. Without response before this duration, the poller stops and executes the error callback.
 * @param {Function} Error/success callback
 * @api   public
 */
function HttpsPoller(target, timeout, callback) {
  HttpsPoller.super_.call(this, target, timeout, callback);
}

util.inherits(HttpsPoller, BaseHttpPoller);

HttpsPoller.type = 'https';

HttpsPoller.validateTarget = function(target) {
  return URL.canParse(target) && new URL(target).protocol == 'https:';
};

/**
 * Launch the actual polling
 *
 * @api   public
 */
HttpsPoller.prototype.poll = function(secure) {
  HttpsPoller.super_.prototype.poll.call(this);
  secure = typeof secure !== 'undefined' ? secure : true;
  try {
    if (secure) {
      this.request = https.get(this.target, this.onResponseCallback.bind(this));
    } else {
      this.request = http.get(this.target, this.onResponseCallback.bind(this));
    }
  } catch(err) {
    return this.onErrorCallback(err);
  }
  this.request.on('error', this.onErrorCallback.bind(this));
};

// see inherited function BaseHttpPoller.prototype.onResponseCallback
// see inherited function BaseHttpPoller.prototype.onErrorCallback

HttpsPoller.prototype.handleRedirectResponse = function(res) {
  this.debug(this.getTime() + "ms - Got redirect response to " + res.headers.location);
  // relative location headers are resolved against the current target
  var target = this.getRedirectTarget(res);
  if (!target) {
    this.request.abort();
    return this.onErrorCallback({ name: "WrongRedirectUrl", message: "Received redirection to invalid location " + res.headers.location});
  }
  switch (target.protocol) {
    case 'https:':
      this.target = target;
      this.poll(true);
      break;
    case 'http:':
      this.target = target;
      this.poll(false);
      break;
    default:
      this.request.abort();
      this.onErrorCallback({ name: "WrongRedirectUrl", message: "Received redirection from https: to unsupported protocol " + target.protocol});
  }
  return;
};

module.exports = HttpsPoller;