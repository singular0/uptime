const moment   = require('moment');
const mongoose = require('../../bootstrap');
const CheckHourlyStat = require('../../models/checkHourlyStat');
const Tag      = require('../../models/tag');
const QosAggregator = require('../../lib/qosAggregator');

const migrateCheckStats = async function(db, name) {
  let nbMigratedDocuments = 0;
  const collection = db.collection(name);
  const unset = {
    ups: 1,
    responsives: 1,
    time: 1
  };
  for await (const stat of collection.find()) {
    if (stat.availability) {
      // already merged
      continue;
    }
    const newStat = {
      availability: stat.ups / stat.count,
      responsiveness: stat.responsives / stat.count,
      responseTime: stat.time / stat.count,
      outages: [] // no way to get that back since CheckEvents are purged
    };
    await collection.updateOne({ _id: stat._id }, { $set: newStat, $unset: unset });
    nbMigratedDocuments++;
    if (nbMigratedDocuments % 100 == 0) {
      console.log('  Migrating ' + name + ' #' + nbMigratedDocuments);
    }
  }
  if (nbMigratedDocuments > 0) {
    console.log('  Finished: ' + nbMigratedDocuments + ' ' + name + ' migrated');
  } else {
    console.log('  No ' + name + ' to migrate');
  }
};

const addEndToMonthlyStat = async function(db, name) {
  let nbMigratedDocuments = 0;
  const collection = db.collection(name);
  for await (const stat of collection.find()) {
    if (stat.end) {
      // already merged
      continue;
    }
    const end = moment(stat.timestamp).endOf('month').toDate();
    await collection.updateOne({ _id: stat._id }, { $set: { end: end } });
    nbMigratedDocuments++;
    if (nbMigratedDocuments % 100 == 0) {
      console.log('  Adding end date to ' + name + ' #' + nbMigratedDocuments);
    }
  }
  if (nbMigratedDocuments > 0) {
    console.log('  Finished: Added end date to' + nbMigratedDocuments + ' ' + name + ' stats');
  } else {
    console.log('  No ' + name + ' missing end date');
  }
};

const getOldestDate = async function() {
  const stat = await CheckHourlyStat.findOne().sort({ 'timestamp': 1 });
  return stat ? stat.timestamp.valueOf() : null;
};

const updateMonthlyQos = async function(start) {
  let date = Date.now() + 28 * 24 * 60 * 60 * 1000;
  while ((date -= 28 * 24 * 60 * 60 * 1000) > start) {
    const dateObject = new Date(date);
    console.log('Computing monthly stats for ' + dateObject.toUTCString());
    await QosAggregator.updateMonthlyQos(dateObject);
  }
};

const updateYearlyQos = async function(start) {
  let date = Date.now() + 365 * 24 * 60 * 60 * 1000;
  while ((date -= 365 * 24 * 60 * 60 * 1000) > start) {
    const dateObject = new Date(date);
    console.log('Computing yearly stats for ' + dateObject.getFullYear());
    await QosAggregator.updateYearlyQos(dateObject);
  }
};

const ensureTagsHaveFirstTestedDate = function() {
  console.log('Updating tags for firstTested date');
  return Tag.ensureTagsHaveFirstTestedDate();
};

mongoose.connection.once('open', async function() {
  const db = mongoose.connection.db;
  try {
    const oldestDate = await getOldestDate();
    await Promise.all(['checkhourlystats', 'checkdailystats', 'taghourlystats', 'tagdailystats'].map(function(name) {
      return migrateCheckStats(db, name);
    }));
    await Promise.all(['checkmonthlystats', 'tagmonthlystats'].map(function(name) {
      return addEndToMonthlyStat(db, name);
    }));
    await updateMonthlyQos(oldestDate);
    await updateYearlyQos(oldestDate);
    await ensureTagsHaveFirstTestedDate();
    await QosAggregator.updateLast24HoursQos();
    console.log('Successfully migrated ' + db.databaseName + ' database');
  } catch (err) {
    console.error(err);
  }
  setTimeout(function() { mongoose.connection.close(); }, 1000);
});
