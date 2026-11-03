/**
 * Module dependencies.
 */

const Check      = require('../../../models/check');
const CheckEvent = require('../../../models/checkEvent');
const Ping       = require('../../../models/ping');

/**
 * Check Routes
 */
module.exports = function(app) {

  // support 'check' and 'page' arguments in query string
  app.get('/pings', async function(req, res) {
    const query = {};
    if (req.query.check) {
      query.check = req.query.check;
    }
    const pings = await Ping
    .find(query)
    .sort({ timestamp: -1 })
    .limit(50)
    .skip(((req.query.page || 1) - 1) * 50);
    res.json(pings);
  });

  app.get('/pings/events', async function(req, res) {
    const events = await CheckEvent
    .find({ timestamp: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } })
    .sort({ timestamp: -1 })
    .select({ tags: 0 })
    .limit(100);
    res.json(await CheckEvent.aggregateEventsByDay(events));
  });

  app.post('/pings', async function(req, res) {
    let check;
    try {
      check = await Check.findById(req.body.checkId);
    } catch (err1) {
      return res.status(500).send(err1.message);
    }
    if (!check) {
      return res.status(403).send('Error: No existing check with id ' + req.body.checkId);
    }
    if (!check.needsPoll) {
      return res.status(403).send('Error: This check was already polled. No ping was created');
    }
    const status = req.body.status === 'true';
    let ping;
    try {
      ping = await Ping.createForCheck(status, req.body.timestamp, req.body.time, check, req.body.name, req.body.error, req.body.details);
    } catch (err2) {
      return res.status(500).send(err2.message);
    }
    res.json(ping);
  });

};
