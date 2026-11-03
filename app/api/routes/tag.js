/**
 * Module dependencies.
 */

const Tag           = require('../../../models/tag');
const TagHourlyStat = require('../../../models/tagHourlyStat');
const CheckEvent    = require('../../../models/checkEvent');

/**
 * Check Routes
 */
module.exports = function(app) {

  app.get('/tags', async function(req, res) {
    const tags = await Tag
    .find()
    .sort({ name: 1 });
    res.json(tags);
  });

  // tag route middleware
  const loadTag = async function(req, res, next) {
    const tag = await Tag.findOne({ name: req.params.name });
    if (!tag) return res.status(404).json({ error: 'failed to load tag ' + req.params.name });
    req.tag = tag;
    next();
  };

  app.get('/tags/:name', loadTag, function(req, res, next) {
    res.json(req.tag);
  });

  app.get('/tags/:name/checks/:period/:timestamp', loadTag, async function(req, res) {
    const checks = await req.tag.getChecksForPeriod(req.params.period, new Date(parseInt(req.params.timestamp)));
    res.json(checks);
  });

  app.get('/tags/:name/stat/:period/:timestamp', loadTag, async function(req, res) {
    const stat = await req.tag.getSingleStatsForPeriod(req.params.period, new Date(parseInt(req.params.timestamp)));
    res.json(stat);
  });

  app.get('/tags/:name/stats/:type', loadTag, async function(req, res) {
    const stats = await req.tag.getStatsForPeriod(req.params.type, req.query.begin, req.query.end);
    res.json(stats);
  });

  app.get('/tags/:name/events', async function(req, res) {
    const query = {
      tags: req.params.name,
      timestamp: { $gte: req.query.begin || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
    };
    if (req.query.end) {
      query.timestamp.$lte = req.query.end;
    }
    const events = await CheckEvent
    .find(query)
    .sort({ timestamp: -1 })
    .select({ tags: 0 })
    .limit(100);
    res.json(await CheckEvent.aggregateEventsByDay(events));
  });

};
