/**
 * Module dependencies.
 */
const express      = require('express');
const errorHandler = require('errorhandler');
const Check      = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');

const app = module.exports = express();

// up count
let upCount;
const refreshUpCount = async function() {
  const count = { up: 0, down: 0, paused: 0, total: 0 };
  const checks = await Check
  .find()
  .select({ isUp: 1, isPaused: 1 });
  checks.forEach(function(check) {
    count.total++;
    if (check.isPaused) {
      count.paused++;
    } else if (check.isUp) {
      count.up++;
    } else {
      count.down++;
    }
  });
  upCount = count;
};

Check.on('afterInsert', function() { upCount = undefined; });
Check.on('afterRemove', function() { upCount = undefined; });
CheckEvent.on('afterInsert', function() { upCount = undefined; });

app.get('/checks/count', async function(req, res) {
  if (!upCount) {
    await refreshUpCount();
  }
  res.json(upCount);
});

// Routes

require('./routes/check')(app);
require('./routes/tag')(app);
require('./routes/ping')(app);

// route list
app.get('/', function(req, res) {
  // routes grouped by method, in the order of declaration
  const routesByMethod = {};
  app.router.stack.forEach(function(layer) {
    if (!layer.route) return;
    Object.keys(layer.route.methods).forEach(function(method) {
      (routesByMethod[method] = routesByMethod[method] || []).push(layer.route.path);
    });
  });
  const routes = [];
  for (const method in routesByMethod) {
    routesByMethod[method].forEach(function(path) {
      routes.push({ method: method.toUpperCase(), path: req.baseUrl + path });
    });
  }
  res.json(routes);
});

// error handling, after all routes
if (['development', 'test', 'production'].indexOf(app.get('env')) !== -1) {
  app.use(errorHandler());
}

if (require.main === module) {
  app.listen(3000);
  console.log('Express started on port 3000');
}
