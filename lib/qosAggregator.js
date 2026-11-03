const moment = require('moment');
const Ping   = require('../models/ping');
const IntervalBuilder = require('./intervalBuilder');

const QosAggregator = function() {
};

QosAggregator.prototype.updateHourlyQos = async function(now) {
  const start = moment(now).clone().startOf('hour').toDate();
  const end   = moment(now).clone().endOf('hour').toDate();
  await Promise.all([
    this.updateHourlyCheckQos(start, end),
    this.updateHourlyTagQos(start, end)
  ]);
};

/**
 * Aggregate Qos data of Pings from all checks around a timestamp into CheckHourlyStat documents
 *
 * The method finds the boundaries of the hour
 * by resetting/completing the hour of the timestamp.
 *
 * @param {Int|Date} timestamp or Date object of a moment inside the chosen hour
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateHourlyCheckQos = async function(start, end) {
  const CheckHourlyStat  = require('../models/checkHourlyStat');
  const stats = await this.aggregatePingsIntoStatsGroupedByCheck(start, end);
  await Promise.all(stats.map(function(stat) {
    return CheckHourlyStat.updateOne(
      { check: stat.check, timestamp: stat.timestamp },
      { $set: stat },
      { upsert: true }
    );
  }));
};

QosAggregator.prototype.updateHourlyTagQos = async function(start, end) {
  const TagHourlyStat   = require('../models/tagHourlyStat');
  const stats = await this.aggregatePingsIntoStatsGroupedByTag(start, end);
  await Promise.all(stats.map(function(stat) {
    return TagHourlyStat.updateOne(
      { name: stat.name, timestamp: start },
      { $set: stat },
      { upsert: true }
    );
  }));
};

/**
 * Aggregate Qos data of Pings from the last 24h into the qos property of checks and tags
 *
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateLast24HoursQos = async function() {
  const start = new Date(Date.now() - (24 * 60 * 60 * 1000));
  const end   = new Date();
  await Promise.all([
    this.updateLast24HoursCheckQos(start, end),
    this.updateLast24HoursTagQos(start, end)
  ]);
};

QosAggregator.prototype.updateLast24HoursCheckQos = async function(start, end) {
  const Check = require('../models/check');
  const stats = await this.aggregatePingsIntoStatsGroupedByCheck(start, end);
  await Promise.all(stats.map(async function(stat) {
    const check = await Check.findById(stat.check);
    if (!check) return;
    check.qos = stat;
    check.markModified('qos');
    await check.save();
  }));
};

QosAggregator.prototype.updateLast24HoursTagQos = async function(start, end) {
  const Tag   = require('../models/tag');
  const stats = await this.aggregatePingsIntoStatsGroupedByTag(start, end);
  await Promise.all(stats.map(function(stat) {
    return Tag.updateOne(
      { name: stat.name },
      { $set: { lastUpdated: end, count: stat.count, availability: stat.availability, responsiveness: stat.responsiveness, responseTime: stat.responseTime, downtime: stat.downtime, outages: stat.outages } },
      { upsert: true }
    );
  }));
};

/**
 * Aggregate Qos data of Pings from all checks between two boundaries
 *
 * @param {Date} Date object of a the beginning of the search period
 * @param {Date} Date object of a the end of the search period
 * @return {Promise} resolved with the list of stats
 *
 * @api   public
 */
QosAggregator.prototype.aggregatePingsIntoStatsGroupedByCheck = async function(start, end) {
  const documents = await this.aggregatePingsByCheck(start, end);
  return this.getCheckStats(documents);
};


QosAggregator.prototype.aggregatePingsByCheck = function(start, end) {
  return Ping.aggregate([
    { $match: {
      timestamp: { $gte: start, $lte: end }
    } },
    { $project: {
      check: 1,
      responsive: { $cond: [ { $and: ["$isResponsive"] }, 1, 0] },
      time: 1,
      tags: 1,
    } },
    { $group: {
      _id: "$check",
      count: { $sum: 1 },
      responsiveness: { $avg: "$responsive" },
      responseTime: { $avg: "$time" },
      start: { $first: start.valueOf() }, // dunno any other way to set a constant
      end: { $first: end.valueOf() }
    } }
  ]);
};

QosAggregator.prototype.getCheckStats = function(documents) {
  return Promise.all(documents.map(this.createCheckStatFromPingAggregationDocument.bind(this)));
};

QosAggregator.prototype.createCheckStatFromPingAggregationDocument = async function(document) {
  const stat = {
    check: document._id,
    timestamp: document.start,
    count: document.count,
    responsiveness: document.responsiveness,
    responseTime: document.responseTime
  };
  const intervalBuilder = new IntervalBuilder();
  intervalBuilder.addTarget(document._id);
  const { intervals: outages, downtime, duration: testedTime } = await intervalBuilder.build(document.start, document.end);
  if (outages.length) {
    stat.outages = outages;
  }
  stat.downtime = downtime;
  stat.availability = testedTime != 0 ? (testedTime - downtime) / testedTime : 0;
  return stat;
};

/**
 * Aggregate Qos data of Pings from all tags between two boundaries
 *
 * @param {Date} Date object of a the beginning of the search period
 * @param {Date} Date object of a the end of the search period
 * @return {Promise} resolved with the list of stats
 *
 * @api   public
 */
QosAggregator.prototype.aggregatePingsIntoStatsGroupedByTag = async function(start, end) {
  const documents = await this.aggregatePingsByTag(start, end);
  return this.getTagStats(documents);
};

QosAggregator.prototype.aggregatePingsByTag = function(start, end) {
  return Ping.aggregate([
    { $match: {
      timestamp: { $gte: start, $lte: end }
    } },
    { $project: {
      check: 1,
      responsive: { $cond: [ { $and: ["$isResponsive"] }, 1, 0] },
      time: 1,
      tags: 1,
    } },
    { $unwind: "$tags" },
    { $group: {
      _id: "$tags",
      count: { $sum: 1 },
      responsiveness: { $avg: "$responsive" },
      responseTime: { $avg: "$time" },
      start: { $first: start.valueOf() }, // dunno any other way to set a constant
      end: { $first: end.valueOf() }
    } }
  ]);
};

QosAggregator.prototype.getTagStats = function(documents) {
  return Promise.all(documents.map(this.createTagStatFromPingAggregationDocument.bind(this)));
};

QosAggregator.prototype.createTagStatFromPingAggregationDocument = async function(document) {
  const Check = require('../models/check');
  const stat = {
    name: document._id,
    timestamp: document.start,
    count: document.count,
    responsiveness: document.responsiveness,
    responseTime: document.responseTime
  };
  const intervalBuilder = new IntervalBuilder();
  const checks = await Check.findForTag(document._id);
  checks.forEach(function(check) {
    intervalBuilder.addTarget(check);
  });
  const { intervals: outages, downtime, duration: testedTime } = await intervalBuilder.build(document.start, document.end);
  stat.outages = outages;
  stat.downtime = downtime;
  stat.availability = testedTime != 0 ? (testedTime - downtime) / testedTime : 0;
  return stat;
};

/**
 * Aggregate hourly Qos data from all checks and tags around a timestamp
 * into daily stat documents.
 *
 * The method finds the boundaries of the day
 * by resetting/completing the day of the timestamp.
 *
 * @param {Int|Date} timestamp or Date object of a moment inside the chosen day
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateDailyQos = async function(now) {
  const start = moment(now).clone().startOf('day').toDate();
  const end   = moment(now).clone().endOf('day').toDate();
  await Promise.all([
    this.updateDailyCheckQos(start, end),
    this.updateDailyTagQos(start, end)
  ]);
};

QosAggregator.prototype.updateDailyCheckQos = async function(start, end) {
  const documents = await this.aggregateCheckHourlyStatsByCheck(start, end);
  return this.createCheckDailyStats(documents);
};

QosAggregator.prototype.aggregateCheckHourlyStatsByCheck = function(start, end) {
  const CheckHourlyStat = require('../models/checkHourlyStat');
  return CheckHourlyStat.aggregate([
    { $match: {
      timestamp: { $gte: start, $lte: end }
    } },
    { $sort: {
      timestamp: 1
    } },
    { $group: {
      _id: "$check",
      count: { $sum: "$count" },
      responsiveness: { $avg: "$responsiveness" },
      responseTime: { $avg: "$responseTime" },
      start: { $first: start.valueOf() },
      end: { $first: end.valueOf() }
    } }
  ]);
};

QosAggregator.prototype.createCheckDailyStats = async function(documents) {
  const CheckDailyStat  = require('../models/checkDailyStat');
  await Promise.all(documents.map(async function(document) {
    const stat = {
      count: document.count,
      responsiveness: document.responsiveness,
      responseTime: document.responseTime
    };
    const intervalBuilder = new IntervalBuilder();
    intervalBuilder.addTarget(document._id);
    const { intervals: outages, downtime, duration: testedTime } = await intervalBuilder.build(document.start, document.end);
    stat.outages = outages;
    stat.downtime = downtime;
    stat.availability = testedTime != 0 ? (testedTime - downtime) / testedTime : 0;
    await CheckDailyStat.updateOne(
      { check: document._id, timestamp: document.start },
      { $set: stat },
      { upsert: true }
    );
  }));
};

QosAggregator.prototype.updateDailyTagQos = async function(start, end) {
  const documents = await this.aggregateTagHourlyStatsByTag(start, end);
  return this.createTagDailyStats(documents);
};

QosAggregator.prototype.aggregateTagHourlyStatsByTag = function(start, end) {
  const TagHourlyStat = require('../models/tagHourlyStat');
  return TagHourlyStat.aggregate([
    { $match: {
      timestamp: { $gte: start, $lte: end }
    } },
    { $sort: {
      timestamp: 1
    } },
    { $group: {
      _id: "$name",
      count: { $sum: "$count" },
      responsiveness: { $avg: "$responsiveness" },
      responseTime: { $avg: "$responseTime" },
      start: { $first: start.valueOf() },
      end: { $first: end.valueOf() }
    } }
  ]);
};

QosAggregator.prototype.createTagDailyStats = async function(documents) {
  const Check = require('../models/check');
  const TagDailyStat = require('../models/tagDailyStat');
  await Promise.all(documents.map(async function(document) {
    const stat = {
      count: document.count,
      responsiveness: document.responsiveness,
      responseTime: document.responseTime,
    };
    const intervalBuilder = new IntervalBuilder();
    const checks = await Check.findForTag(document._id);
    checks.forEach(function(check) {
      intervalBuilder.addTarget(check);
    });
    const { intervals: outages, downtime, duration: testedTime } = await intervalBuilder.build(document.start, document.end);
    stat.outages = outages;
    stat.downtime = downtime;
    stat.availability = testedTime != 0 ? (testedTime - downtime) / testedTime : 0;
    await TagDailyStat.updateOne(
      { name: document._id, timestamp: document.start },
      { $set: stat },
      { upsert: true }
    );
  }));
};

/**
 * Aggregate daily Qos data from all checks and tags around a timestamp
 * into monthly stat documents.
 *
 * The method finds the boundaries of the month
 * by resetting/completing the month of the timestamp.
 *
 * @param {Int|Date} timestamp or Date object of a moment inside the chosen month
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateMonthlyQos = async function(now) {
  const start = moment(now).clone().startOf('month').toDate();
  const end   = moment(now).clone().endOf('month').toDate();
  const CheckDailyStat   = require('../models/checkDailyStat');
  const CheckMonthlyStat = require('../models/checkMonthlyStat');
  const TagDailyStat   = require('../models/tagDailyStat');
  const TagMonthlyStat = require('../models/tagMonthlyStat');
  await this.updateMonthlyQosStats(start, end, CheckDailyStat, CheckMonthlyStat, "$check");
  await this.updateMonthlyQosStats(start, end, TagDailyStat, TagMonthlyStat, "$name");
};

QosAggregator.prototype.updateMonthlyQosStats = async function(start, end, dailyStatModel, monthlyStatModel, groupIdentifier) {
  const key = groupIdentifier.substr(1);
  const month = end - start;
  const pipeline = [
    { $match: {
      timestamp: { $gte: start, $lte: end }
    } },
    { $sort: {
      timestamp: 1
    } },
    { $group: {
      _id: groupIdentifier,
      count: { $sum: "$count" },
      responsiveness: { $avg: "$responsiveness" },
      responseTime: { $avg: "$responseTime" },
      downtime: { $sum: "$downtime" },
      availabilities: { $push: "$availability" },
      timestamps: { $push: "$timestamp" }
    } }
  ];
  const stats = await dailyStatModel.aggregate(pipeline);
  const day = 24 * 60 * 60 * 1000;
  await Promise.all(stats.map(function(stat) {
    const outages = [];
    stat.availabilities.forEach(function(availability, index) {
      const date = new Date(stat.timestamps[index]).valueOf();
      outages.push([date, date + day, availability]);
    });
    const toStatDocument = {
      end: end,
      count: stat.count,
      availability: (month - stat.downtime) / month,
      responsiveness: stat.responsiveness,
      responseTime: stat.responseTime,
      downtime: stat.downtime,
      outages: outages
    };
    const query = { timestamp: start };
    query[key] = stat._id;
    return monthlyStatModel.updateOne(
      query,
      { $set: toStatDocument },
      { upsert: true }
    );
  }));
};

/**
 * Aggregate daily Qos data from all checks and tags around a timestamp
 * into yearly stat documents.
 *
 * The method finds the boundaries of the month
 * by resetting/completing the month of the timestamp.
 *
 * @param {Int|Date} timestamp or Date object of a moment inside the chosen month
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateYearlyQos = async function(now) {
  const start = moment(now).clone().startOf('year').toDate();
  const end   = moment(now).clone().endOf('year').toDate();
  const CheckMonthlyStat = require('../models/checkMonthlyStat');
  const CheckYearlyStat  = require('../models/checkYearlyStat');
  const TagMonthlyStat = require('../models/tagMonthlyStat');
  const TagYearlyStat  = require('../models/tagYearlyStat');
  await this.updateYearlyQosStats(start, end, CheckMonthlyStat, CheckYearlyStat, "$check");
  await this.updateYearlyQosStats(start, end, TagMonthlyStat, TagYearlyStat, "$name");
};

QosAggregator.prototype.updateYearlyQosStats = async function(start, end, monthlyStatModel, yearlyStatModel, groupIdentifier) {
  const key = groupIdentifier.substr(1);
  const month = end - start;
  const pipeline = [
    { $match: {
      timestamp: { $gte: start, $lte: end }
    } },
    { $sort: {
      timestamp: 1
    } },
    { $group: {
      _id: groupIdentifier,
      count: { $sum: "$count" },
      responsiveness: { $avg: "$responsiveness" },
      responseTime: { $avg: "$responseTime" },
      downtime: { $sum: "$downtime" },
      availabilities: { $push: "$availability" },
      timestamps: { $push: "$timestamp" },
      ends: { $push: "$end" }
    } }
  ];
  const stats = await monthlyStatModel.aggregate(pipeline);
  await Promise.all(stats.map(function(stat) {
    const outages = [];
    stat.availabilities.forEach(function(availability, index) {
      const outageStart = new Date(stat.timestamps[index]).valueOf();
      const outageEnd = new Date(stat.ends[index]).valueOf();
      outages.push([outageStart, outageEnd, availability]);
    });
    const toStatDocument = {
      end: end,
      count: stat.count,
      availability: (month - stat.downtime) / month,
      responsiveness: stat.responsiveness,
      responseTime: stat.responseTime,
      downtime: stat.downtime,
      outages: outages
    };
    const query = { timestamp: start };
    query[key] = stat._id;
    return yearlyStatModel.updateOne(
      query,
      { $set: toStatDocument },
      { upsert: true }
    );
  }));
};

/**
 * Aggregate Qos data of Pings from all checks from the last hour
 * into CheckHourlyStat and TagHourlyStat documents.
 *
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateLastHourQos = function() {
  const now = new Date(Date.now() - 1000 * 60 * 6); // 6 minutes in the past, to accommodate script running every 5 minutes
  return this.updateHourlyQos(now);
};

/**
 * Aggregate Qos data of CheckHourlyStat from all checks from the last day
 * into CheckDailyStat documents.
 *
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateLastDayQos = function() {
  const now = new Date(Date.now() - 1000 * 60 * 66); // 1 hour and 6 minutes in the past, to accommodate script running every hour
  return this.updateDailyQos(now);
};

/**
 * Aggregate Qos data of CheckDailyStat from all checks from the last month
 * into CheckMonthlyStat documents.
 *
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateLastMonthQos = function() {
  const now = new Date(Date.now() - 1000 * 60 * 66); // 1 hour and 6 minutes in the past, to accommodate script running every hour
  return this.updateMonthlyQos(now);
};

/**
 * Aggregate Qos data of CheckMonthlyStat from all checks from the last month
 * into CheckYearlyStat documents.
 *
 * @return {Promise} resolved upon completion
 *
 * @api   public
 */
QosAggregator.prototype.updateLastYearQos = function() {
  const now = new Date(Date.now() - 1000 * 60 * 66); // 1 hour and 6 minutes in the past, to accommodate script running every hour
  return this.updateYearlyQos(now);
};

module.exports = new QosAggregator();
