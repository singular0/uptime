const mongoose = require('mongoose');
const Schema   = mongoose.Schema;

const Ping = new Schema({
  timestamp    : { type: Date, default: Date.now },
  isUp         : Boolean,  // false if ping returned a non-OK status code or timed out
  isResponsive : Boolean,  // true if the ping time is less than the check max time
  time         : Number,
  check        : { type: Schema.ObjectId, ref: 'Check' },
  tags         : [String],
  monitorName  : String,
  // for pings in error, more details need to be persisted
  downtime     : Number,   // time since last ping if the ping is down
  error        : String,
  details      : Schema.Types.Mixed
});
Ping.index({ timestamp: -1 });
Ping.index({ check: 1 });
Ping.plugin(require('./plugins/lifecycle'));

Ping.methods.findCheck = function() {
  return this.db.model('Check').findById(this.check);
};

Ping.methods.setDetails = function(details) {
  this.details = details;
  this.markModified('details');
};

Ping.statics.createForCheck = async function(status, timestamp, time, check, monitorName, error, details) {
  timestamp = timestamp || new Date();
  timestamp = timestamp instanceof Date ? timestamp : new Date(parseInt(timestamp, 10));

  const ping = new this();
  ping.timestamp = timestamp;
  ping.isUp = status;
  if (status && check.maxTime) {
    ping.isResponsive = time < check.maxTime;
  } else {
    ping.isResponsive = false;
  }
  ping.time = time;
  ping.check = check._id;
  ping.tags = check.tags;
  ping.monitorName = monitorName;
  if (!status) {
    ping.downtime = check.interval || 60000;
    ping.error = error;
  }
  if (details) {
    ping.setDetails(JSON.parse(details));
  }
  await ping.save();
  check.setLastTest(status, timestamp, error);
  await check.save();
  // wait for the CheckEvent (up/down) possibly created by setLastTest()
  await check.$locals.lastEventSave;
  delete check.$locals.lastEventSave;
  return ping;
};

Ping.statics.cleanup = function(maxAge) {
  const oldestDateToKeep = new Date(Date.now() - (maxAge ||  3 * 31 * 24 * 60 * 60 * 1000));
  return this.deleteMany({ timestamp: { $lt: oldestDateToKeep } });
};

module.exports = mongoose.model('Ping', Ping);
