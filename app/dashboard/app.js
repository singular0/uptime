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
  res.locals.addedCss = [];
  res.locals.renderCssTags = function (all) {
    if (all != undefined) {
      return all.map(function(css) {
        return '<link rel="stylesheet" href="' + route + '/stylesheets/' + css + '">';
      }).join('\n ');
    } else {
      return '';
    }
  };
  res.locals.moment = moment;
  next();
});

app.locals.version = moduleInfo.version;

// Routes

app.get('/events', function(req, res) {
  res.render('events');
});

app.get('/checks', async function(req, res) {
  const checks = await Check.find().sort({ isUp: 1, lastChanged: -1 });
  res.render('checks', { info: req.flash('info'), checks: checks });
});

app.get('/checks/new', function(req, res) {
  res.render('check_new', { check: new Check(), pollerCollection: app.get('pollerCollection'), info: req.flash('info') });
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
  res.render('check', { check: check, info: req.flash('info'), req: req });
});

app.get('/checks/:id/edit', async function(req, res) {
  const check = await Check.findOne({ _id: req.params.id });
  if (!check) return res.status(404).send('failed to load check ' + req.params.id);
  const pollerDetails = [];
  app.emit('checkEdit', check.type, check, pollerDetails);
  res.render('check_edit', { check: check, pollerCollection: app.get('pollerCollection'), pollerDetails: pollerDetails.join(''), info: req.flash('info'), req: req });
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
  res.render('tags', { tags: tags });
});

app.get('/tags/:name', async function(req, res, next) {
  const tag = await Tag.findOne({ name: req.params.name });
  if (!tag) return next(new Error('failed to load tag ' + req.params.name));
  res.render('tag', { tag: tag, req: req });
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
