/**
 * Flash messages stored in the session.
 *
 * Drop-in replacement for the unmaintained connect-flash package
 * (which relies on the deprecated util.isArray()).
 *
 *     app.use(flash());
 *     req.flash('info', 'Check saved'); // add a message (also accepts an array, or util.format() arguments)
 *     req.flash('info');                // get and clear the messages of a type
 *     req.flash();                      // get and clear all messages
 */
const util = require('util');

const flash = function(type, msg) {
  if (this.session === undefined) throw Error('req.flash() requires sessions');
  const msgs = this.session.flash = this.session.flash || {};
  if (type && msg) {
    if (arguments.length > 2) {
      msg = util.format.apply(undefined, Array.prototype.slice.call(arguments, 1));
    }
    const messages = msgs[type] = msgs[type] || [];
    return messages.push.apply(messages, Array.isArray(msg) ? msg : [msg]);
  }
  if (type) {
    const messages = msgs[type];
    delete msgs[type];
    return messages || [];
  }
  this.session.flash = {};
  return msgs;
};

module.exports = function() {
  return function(req, res, next) {
    if (!req.flash) req.flash = flash;
    next();
  };
};
