const mongoose = require('mongoose');
const config   = require('./lib/config');
const semver   = require('semver');

const MIN_MONGODB_VERSION = '4.4.0'; // oldest server supported by the MongoDB Node.js driver

const buildConnectionString = function(options) {
  if (options.connectionString) return options.connectionString;
  // credentials are only sent when both user and password are set (an empty password means no authentication)
  const credentials = options.user && options.password
    ? encodeURIComponent(options.user) + ':' + encodeURIComponent(options.password) + '@'
    : '';
  return 'mongodb://' + credentials + options.server + '/' + options.database;
};

const exitOnError = function(err) {
  console.error('MongoDB error: ' + err.message);
  console.error('Make sure a mongoDB server is running and accessible by this application');
  process.exit(1);
};

// configure mongodb
mongoose.connection.on('error', exitOnError);
mongoose.connection.on('open', async function() {
  try {
    const info = await mongoose.connection.db.admin().buildInfo();
    if (!semver.satisfies(semver.coerce(info.version), '>=' + MIN_MONGODB_VERSION)) {
      console.error('Error: Uptime requires MongoDB v' + MIN_MONGODB_VERSION + ' minimum. The current MongoDB server uses only ' + info.version);
      process.exit(1);
    }
  } catch (err) {
    exitOnError(err);
  }
});
mongoose.connect(buildConnectionString(config.mongodb)).catch(exitOnError);

module.exports = mongoose;
