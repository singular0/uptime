const mongoose        = require('../bootstrap');
const Ping            = require('../models/ping');
const Check           = require('../models/check');
const Tag             = require('../models/tag');
const QosAggregator   = require('../lib/qosAggregator');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const emptyStats = async function() {
  console.log('Emptying stat collections');
  const checks = await Check.find({});
  if (!checks.length) throw new Error('No check in database, please use the populate script first');
  await Promise.all(checks.map(function(check) { return check.removeStats(); }));
};

const updateUptime = async function() {
  console.log('Updating uptime');
  const checks = await Check.find({});
  await Promise.all(checks.map(function(check) { return check.updateUptime(); }));
};

const getOldestPingDate = async function() {
  const ping = await Ping.findOne().sort({ 'timestamp': 1 });
  return ping.timestamp.valueOf();
};

const updateHourlyQosSinceTheFirstPing = async function() {
  const oldestDate = await getOldestPingDate();
  let date = Date.now() + HOUR;
  let nbDates = 0;
  while ((date -= HOUR) > oldestDate) {
    const dateObject = new Date(date);
    if (nbDates % 24 == 0) {
      console.log('Computing hourly stats for ' + dateObject.toUTCString());
    }
    nbDates++;
    await QosAggregator.updateHourlyQos(dateObject);
  }
};

const updateDailyQosSinceTheFirstPing = async function() {
  const oldestDate = await getOldestPingDate();
  let date = Date.now() + DAY;
  while ((date -= DAY) > oldestDate) {
    const dateObject = new Date(date);
    console.log('Computing daily stats for ' + dateObject.toUTCString());
    await QosAggregator.updateDailyQos(dateObject);
  }
};

const updateMonthlyQosSinceTheFirstPing = async function() {
  const oldestDate = await getOldestPingDate();
  let date = Date.now() + 28 * DAY;
  while ((date -= 28 * DAY) > oldestDate) {
    const dateObject = new Date(date);
    console.log('Computing monthly stats for ' + dateObject.toUTCString());
    await QosAggregator.updateMonthlyQos(dateObject);
  }
};

const updateYearlyQosSinceTheFirstPing = async function() {
  const oldestDate = await getOldestPingDate();
  let date = Date.now() + 365 * DAY;
  while ((date -= 365 * DAY) > oldestDate) {
    const dateObject = new Date(date);
    console.log('Computing yearly stats for ' + dateObject.getFullYear());
    await QosAggregator.updateYearlyQos(dateObject);
  }
};

const updateLastDayQos = function() {
  console.log('Updating last day Qos for all checks');
  return QosAggregator.updateLast24HoursQos();
};

const ensureTagsHaveFirstTestedDate = function() {
  console.log('Updating tags for firstTested date');
  return Tag.ensureTagsHaveFirstTestedDate();
};

(async function() {
  const steps = [emptyStats, updateUptime, updateHourlyQosSinceTheFirstPing, updateDailyQosSinceTheFirstPing, updateMonthlyQosSinceTheFirstPing, updateYearlyQosSinceTheFirstPing, updateLastDayQos, ensureTagsHaveFirstTestedDate];
  for (const step of steps) {
    await step();
  }
  console.log('Computing complete');
})().catch(function(err) {
  console.error(err);
  process.exitCode = 1;
}).finally(function() {
  setTimeout(function() { mongoose.connection.close(); }, 1000);
});
