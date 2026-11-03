/**
 * Module dependencies.
 */
const path = require('path');
const express = require('express');
const errorHandler = require('errorhandler');
const partials = require('express-partials');
const flash = require('../../lib/flash');
const moment = require('moment');

const Check = require('../../models/check');
const Tag = require('../../models/tag');
const TagDailyStat = require('../../models/tagDailyStat');
const TagMonthlyStat = require('../../models/tagMonthlyStat');
const CheckMonthlyStat = require('../../models/checkMonthlyStat');
const moduleInfo = require('../../package.json');

const app = module.exports = express();

// middleware

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(partials());
app.use(flash());
app.use(function locals(req, res, next) {
  const route = req.baseUrl; // mount path of the dashboard
  res.locals.route = route;
  res.locals.addedCss = []; // stylesheet paths relative to the dashboard root
  res.locals.renderCssTags = function (all) {
    if (all != undefined) {
      return all.map(function(css) {
        return '<link rel="stylesheet" href="' + route + '/' + css + '">';
      }).join('\n ');
    } else {
      return '';
    }
  };
  res.locals.moment = moment;
  res.locals.navSection = req.path.split('/')[1]; // 'events', 'checks' or 'tags', highlighted in the navbar
  res.locals.title = ''; // page title, before " · Uptime"
  next();
});

app.locals.version = moduleInfo.version;
app.locals.isSafeUrl = require('./public/javascripts/safeUrl');

// Serializes a value for an inline <script>. Escaping "<" keeps a string such as
// "</script>" in user data from closing the script element.
app.locals.jsonForScript = function(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
};

// The check and tag pages show the period given in the query string. Only let through a
// known period type and a number, since both are written into an inline script.
const intervalFromQuery = function(query, types) {
  const date = Number(query.date);
  return {
    type: types.includes(query.type) ? query.type : 'month',
    date: Number.isFinite(date) && date > 0 ? date : Date.now()
  };
};

// Routes

app.get('/events', function(req, res) {
  res.render('events', { title: 'Events' });
});

app.get('/checks', async function(req, res) {
  const checks = await Check.find().sort({ isUp: 1, lastChanged: -1 });
  res.render('checks', { title: 'Checks', info: req.flash('info'), checks: checks });
});

app.get('/checks/new', function(req, res) {
  res.render('check_new', { title: 'New check', check: new Check(), pollerCollection: app.get('pollerCollection'), info: req.flash('info') });
});

app.post('/checks', async function(req, res, next) {
  const check = new Check();
  try {
    const dirtyCheck = req.body.check;
    check.populateFromDirtyCheck(dirtyCheck, app.get('pollerCollection'))
    app.emit('populateFromDirtyCheck', check, dirtyCheck, check.type);
  } catch (err) {
    return next(err);
  }
  await check.save();
  req.flash('info', 'New check has been created');
  res.redirect(req.baseUrl + (req.body.saveandadd ? '/checks/new' : ('/checks/' + check._id + '?type=hour&date=' + Date.now())));
});

app.get('/checks/:id', async function(req, res) {
  const check = await Check.findOne({ _id: req.params.id });
  if (!check) return res.status(404).send('failed to load check ' + req.params.id);
  res.render('check', { title: check.name, check: check, info: req.flash('info'), interval: intervalFromQuery(req.query, ['year', 'month', 'day', 'hour']) });
});

app.get('/checks/:id/edit', async function(req, res) {
  const check = await Check.findOne({ _id: req.params.id });
  if (!check) return res.status(404).send('failed to load check ' + req.params.id);
  const pollerDetails = [];
  app.emit('checkEdit', check.type, check, pollerDetails);
  res.render('check_edit', { title: 'Edit ' + check.name, check: check, pollerCollection: app.get('pollerCollection'), pollerDetails: pollerDetails.join(''), info: req.flash('info'), req: req });
});

app.get('/pollerPartial/:type', function(req, res, next) {
  let poller;
  try {
    poller = app.get('pollerCollection').getForType(req.params.type);
  } catch (err) {
    return next(err);
  }
  const pollerDetails = [];
  app.emit('checkEdit', req.params.type, new Check(), pollerDetails);
  res.send(pollerDetails.join(''));
});

app.put('/checks/:id', async function(req, res, next) {
  const check = await Check.findById(req.params.id);
  try {
    const dirtyCheck = req.body.check;
    check.populateFromDirtyCheck(dirtyCheck, app.get('pollerCollection'))
    app.emit('populateFromDirtyCheck', check, dirtyCheck, check.type);
  } catch (populationError) {
    return next(populationError);
  }
  await check.save();
  req.flash('info', 'Changes have been saved');
  res.redirect(req.baseUrl + '/checks/' + req.params.id);
});

app.delete('/checks/:id', async function(req, res, next) {
  const check = await Check.findOne({ _id: req.params.id });
  if (!check) return next(new Error('failed to load check ' + req.params.id));
  await check.deleteOne();
  req.flash('info', 'Check has been deleted');
  res.redirect(req.baseUrl + '/checks');
});

app.get('/tags', async function(req, res) {
  const tags = await Tag.find().sort({ name: 1 });
  res.render('tags', { title: 'Tags', tags: tags });
});

app.get('/tags/:name', async function(req, res, next) {
  const tag = await Tag.findOne({ name: req.params.name });
  if (!tag) return next(new Error('failed to load tag ' + req.params.name));
  res.render('tag', { title: tag.name, tag: tag, interval: intervalFromQuery(req.query, ['year', 'month', 'day']) });
});

// static assets and error handling, after all routes

app.use(express.static(path.join(__dirname, 'public')));

if (app.get('env') === 'development' || app.get('env') === 'production') {
  app.use(errorHandler());
}

if (require.main === module) {
  app.listen(3000);
  console.log('Express started on port 3000');
}
