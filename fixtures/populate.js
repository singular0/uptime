const mongoose   = require('../bootstrap');
const Check      = require('../models/check');
const CheckEvent = require('../models/checkEvent');
const Ping       = require('../models/ping');

const backInTime = 3 * 30 * 24 * 60 * 60 * 1000; // defaults to 3 months ago

const removeChecks = async function() {
  console.log('Removing Checks');
  await CheckEvent.collection.deleteMany({});
  await Check.collection.deleteMany({});
};

const createFixtureChecks = function() {
  return Promise.all([
    createDummyCheck(99.95, 'Top Quality', ['good', 'all']),
    createDummyCheck(99.85, 'Good Quality', ['good', 'all']),
    createDummyCheck(99, 'Neun und neunzig Luftballons', ['average', 'all']),
    createDummyCheck(80, 'My Unstable Site', ['average', 'all']),
    createDummyCheck(70, 'The lousy site I built for Al', ['low', 'all'])
  ]);
};

const createDummyCheck = function(quality, name, tags) {
  console.log('Creating check "' + name + '"');
  const check = new Check({
    url: 'http://localhost:8888/' + quality,
    name: name || ('dummy' + quality),
    interval: 300000,
    maxTime: 500,
    tags: tags || ['all']
  });
  return check.save();
};

const createFixturePings = async function() {
  const checks = await Check.find({});
  await Promise.all(checks.map(async function(check) {
    const now = Date.now();
    let date = now - backInTime;
    let nbPings = 0;
    const quality = parseFloat(check.url.substr(22));
    while ((date += check.interval) < now) {
      await Ping.createForCheck(
        Math.random() < (quality / 100),
        date,
        check.maxTime + (Math.random() - 0.9) * 200,
        check,
        'populator',
        'Dummy Error',
        null
      );
      nbPings++;
      if (nbPings % 288 === 0) {
        console.log(new Date(date) + ' Created pings for check "' + check.name + '"');
      }
    }
  }));
};

(async function() {
  await removeChecks();
  await createFixtureChecks();
  await createFixturePings();
  console.log('Computing complete');
})().catch(function(err) {
  console.dir(err);
}).finally(function() {
  setTimeout(function() { mongoose.connection.close(); }, 1000);
});
