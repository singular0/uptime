/**
 * Module dependencies.
 */

const Check            = require('../../../models/check');
const CheckEvent       = require('../../../models/checkEvent');
const CheckHourlyStat  = require('../../../models/checkHourlyStat');
const CheckDailyStat   = require('../../../models/checkDailyStat');
const CheckMonthlyStat = require('../../../models/checkMonthlyStat');

/**
 * Check Routes
 */
module.exports = function(app) {

  app.get('/checks', async function(req, res) {
    const query = {};
    if (req.query.tag) {
      query.tags = req.query.tag;
    }
    const checks = await Check
    .find(query)
    .sort({ isUp: 1, lastChanged: -1 });
    res.json(checks);
  });

  app.get('/checks/needingPoll', async function(req, res) {
    const checks = await Check
    .needingPoll()
    .select({qos: 0});
    res.json(checks);
  });

  // check route middleware
  const loadCheck = async function(req, res, next) {
    const check = await Check
    .findOne({ _id: req.params.id })
    .select({qos: 0});
    if (!check) return res.status(404).json({ error: 'failed to load check ' + req.params.id });
    req.check = check;
    next();
  };

  app.get('/checks/:id', loadCheck, function(req, res, next) {
    res.json(req.check);
  });

  app.get('/checks/:id/pause', loadCheck, async function(req, res, next) {
    req.check.togglePause();
    try {
      await req.check.save();
    } catch (err) {
      return next(new Error('failed to toggle pause on check' + req.params.id));
    }
    new CheckEvent({
      timestamp: new Date(),
      check: req.check._id,
      tags: req.check.tags,
      message: req.check.isPaused ? 'paused' : 'restarted'
    }).save().catch(function(err) { console.error(err); });
    res.redirect(req.baseUrl + '/checks/' + req.params.id);
  });

  app.put('/check/:id/test', async function (req, res) {
    const result = await Check.updateOne({ _id: req.params.id }, { lastTested: new Date() });
    res.json({ numberAffected: result.matchedCount });
  });

  app.get('/checks/:id/stat/:period/:timestamp', loadCheck, async function(req, res) {
    const stat = await req.check.getSingleStatForPeriod(req.params.period, new Date(parseInt(req.params.timestamp)));
    res.json(stat);
  });

  app.get('/checks/:id/stats/:type', loadCheck, async function(req, res) {
    const stats = await req.check.getStatsForPeriod(req.params.type, req.query.begin, req.query.end);
    res.json(stats);
  });

  app.get('/checks/:id/events', async function(req, res) {
    const query = {
      check: req.params.id,
      timestamp: { $gte: req.query.begin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    };
    if (req.query.end) {
      query.timestamp.$lte = req.query.end;
    }
    const events = await CheckEvent
    .find(query)
    .sort({ timestamp: -1 })
    .select({tags: 0})
    .limit(100);
    res.json(await CheckEvent.aggregateEventsByDay(events));
  });

 // a body that can't populate the check, including one that a plugin rejects, is a bad request
 const populateCheck = function(check, dirtyCheck) {
   try {
     check.populateFromDirtyCheck(dirtyCheck, app.get('pollerCollection'));
     app.emit('populateFromDirtyCheck', check, dirtyCheck, check.type);
   } catch (err) {
     err.status = 400;
     throw err;
   }
 };

 app.put('/checks', async function(req, res) {
   const check = new Check();
   populateCheck(check, req.body);
   await check.save();
   res.json(check);
 });

 app.delete('/checks/:id', loadCheck, async function (req, res) {
  await req.check.deleteOne();
  res.end();
 });

 app.post('/checks/:id', async function(req, res, next) {
   const check = await Check.findOne({ _id: req.params.id });
   if (!check) return next({status:404, error: 'failed to load check ' + req.params.id})
   populateCheck(check, req.body);
   await check.save();
   res.json(check);
 });
};
