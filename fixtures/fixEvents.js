var mongoose = require('../bootstrap');
var Schema   = mongoose.Schema;

var CheckEvent = new Schema({
  timestamp   : { type: Date, default: Date.now },
  check       : { type: Schema.ObjectId, ref: 'Check' },
  tags        : [String],
  message     : String,
  isGoDown    : Boolean,
  details     : String,
  // for error events, more details need to be persisted
  downtime    : Number
});

mongoose.model('CheckEvent', CheckEvent);

var Event = mongoose.model('CheckEvent');
(async function() {
  for await (var event of Event.find({ message: { $exists: false }}).cursor()) {
    event.message = event.isGoDown ? 'down' : 'up';
    await event.save();
  }
})().catch(function(err) {
  console.log(err.message);
}).finally(function() {
  process.exit();
});