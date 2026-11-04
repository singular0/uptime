var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// main model
var TagDailyStat = new Schema({
  name           : String,
  timestamp      : Date,
  count          : Number,
  availability   : Number,
  responsiveness : Number,
  responseTime   : Number,
  downtime       : Number,
  testedTime     : Number, // time tested and not paused, in milliseconds
  outages        : Array,
});
TagDailyStat.index({ name: 1, timestamp: -1 }, { unique: true });
TagDailyStat.plugin(require('./plugins/lifecycle'));

module.exports = mongoose.model('TagDailyStat', TagDailyStat);