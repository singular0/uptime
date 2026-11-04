var mongoose = require('mongoose');
var Schema = mongoose.Schema;

// main model
var TagMonthlyStat = new Schema({
  name           : String,
  timestamp      : Date,
  end            : Date, // end is stored because months have an uneven duration
  count          : Number,
  availability   : Number,
  responsiveness : Number,
  responseTime   : Number,
  downtime       : Number,
  testedTime     : Number, // time tested and not paused, in milliseconds
  outages        : Array,
});
TagMonthlyStat.index({ name: 1, timestamp: -1 }, { unique: true });
TagMonthlyStat.plugin(require('./plugins/lifecycle'));

module.exports = mongoose.model('TagMonthlyStat', TagMonthlyStat);