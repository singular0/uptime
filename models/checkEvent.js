const mongoose = require('mongoose');
const Schema   = mongoose.Schema;

const CheckEvent = new Schema({
  timestamp   : { type: Date, default: Date.now },
  check       : { type: Schema.ObjectId, ref: 'Check' },
  tags        : [String],
  message     : String, // possible values are 'down', 'up', 'paused', 'restarted'
  details     : String,
  // for error events, more details need to be persisted
  downtime    : Number
});
CheckEvent.index({ check: 1, timestamp: -1 });
CheckEvent.plugin(require('./plugins/lifecycle'));

CheckEvent.methods.findCheck = function() {
  return this.db.model('Check').findById(this.check);
};

CheckEvent.statics.aggregateEventsByDay = async function(events) {
  // list checks concerned by all events
  const checkIds = [];
  events.forEach(function(event) {
    const check = event.check.toString();
    if (checkIds.indexOf(check) == -1) checkIds.push(check);
  });
  const checks = await this.db.model('Check').find({ _id: { $in: checkIds } }).select({ _id: 1, name: 1, url: 1 });
  // populate related check for each event
  const indexedChecks = {};
  checks.forEach(function(check) {
    indexedChecks[check._id] = check;
  });
  events = events.map(function(event) {
    event = event.toJSON(); // bypass mongoose's magic setters
    event.check = indexedChecks[event.check];
    delete event.__v;
    delete event._id;
    if (event.message == 'up') {
      delete event.details;
    }
    return event;
  });

  // aggregate events by day
  let currentDay;
  const aggregatedEvents = {};
  let currentAggregate = [];
  events.forEach(function(event) {
    const date = new Date(event.timestamp).toLocaleDateString();
    if (date != currentDay) {
      currentDay = date;
      currentAggregate = aggregatedEvents[date] = [];
    }
    currentAggregate.push(event);
  });
  return aggregatedEvents;
};

CheckEvent.statics.cleanup = function(maxAge) {
  const oldestDateToKeep = new Date(Date.now() - (maxAge ||  3 * 31 * 24 * 60 * 60 * 1000));
  return this.deleteMany({ timestamp: { $lt: oldestDateToKeep } });
};

module.exports = mongoose.model('CheckEvent', CheckEvent);
