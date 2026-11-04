const should = require('should');
const mongoose = require('../../bootstrap');
const QosAggregator = require('../../lib/qosAggregator');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const CheckHourlyStat = require('../../models/checkHourlyStat');
const CheckDailyStat = require('../../models/checkDailyStat');
const CheckMonthlyStat = require('../../models/checkMonthlyStat');
const CheckYearlyStat = require('../../models/checkYearlyStat');
const Ping = require('../../models/ping');
const Tag = require('../../models/tag');
const TagHourlyStat = require('../../models/tagHourlyStat');
const TagDailyStat = require('../../models/tagDailyStat');
const TagMonthlyStat = require('../../models/tagMonthlyStat');
const TagYearlyStat = require('../../models/tagYearlyStat');
const { clear } = require('../helpers');

const minute = 60 * 1000;
const hour = 60 * minute;
const models = [
  Check, CheckEvent, Ping, Tag,
  CheckHourlyStat, CheckDailyStat, CheckMonthlyStat, CheckYearlyStat,
  TagHourlyStat, TagDailyStat, TagMonthlyStat, TagYearlyStat
];

describe('QosAggregator', function() {

  // a fixed hour in local time, as the aggregator uses local hours and days
  const begin = new Date(2026, 0, 15, 10).getTime();
  const endOfHour = begin + hour - 1;
  const dayBegin = new Date(2026, 0, 15).getTime();
  const monthBegin = new Date(2026, 0, 1).getTime();
  const monthEnd = new Date(2026, 1, 1).getTime() - 1;
  let check;

  before(async function() {
    await clear(...models);
    check = await new Check({ name: 'check', tags: ['foo'], maxTime: 1500 }).save();
    // up from 10:00, down from 10:30, back up at 11:03
    for (const [minutes, isUp] of [[0, true], [10, true], [20, true], [30, false], [40, false], [50, false], [63, true]]) {
      await Ping.createForCheck(isUp, begin + minutes * minute, 100, check, 'monitor1', isUp ? undefined : 'error');
    }
    await QosAggregator.updateHourlyQos(new Date(begin + 30 * minute));
  });

  after(function() {
    return clear(...models);
  });

  describe('#updateHourlyQos()', function() {

    it('should aggregate the pings of the hour into a check stat', async function() {
      const stats = await CheckHourlyStat.find({ check: check._id });
      stats.length.should.eql(1);
      const stat = stats[0];
      stat.timestamp.getTime().should.eql(begin);
      stat.count.should.eql(6);
      stat.responsiveness.should.eql(0.5);
      stat.responseTime.should.eql(100);
    });

    it('should count the outage still in progress at the end of the hour', async function() {
      const stat = await CheckHourlyStat.findOne({ check: check._id });
      stat.outages.should.eql([[begin + 30 * minute, endOfHour, 0]]);
      stat.downtime.should.eql(endOfHour - (begin + 30 * minute));
      stat.availability.should.be.approximately(0.5, 0.001);
    });

    it('should aggregate the pings of the hour into tag stats', async function() {
      const stat = await TagHourlyStat.findOne({ name: 'foo' });
      stat.count.should.eql(6);
      stat.outages.should.eql([[begin + 30 * minute, endOfHour, 0]]);
      stat.availability.should.be.approximately(0.5, 0.001);
    });

  });

  describe('#updateDailyQos()', function() {

    it('should aggregate the hourly stats into a daily stat, with the tested time only', async function() {
      await QosAggregator.updateDailyQos(new Date(begin));
      const stat = await CheckDailyStat.findOne({ check: check._id });
      stat.timestamp.getTime().should.eql(dayBegin);
      stat.outages.should.eql([[begin + 30 * minute, begin + 63 * minute, 0]]);
      stat.downtime.should.eql(33 * minute);
      // tested from 10:00 to 11:03
      stat.testedTime.should.eql(63 * minute);
      stat.availability.should.be.approximately(30 / 63, 0.0001);
    });

  });

  describe('#updateMonthlyQos()', function() {

    before(async function() {
      await QosAggregator.updateDailyQos(new Date(begin));
      await QosAggregator.updateMonthlyQos(new Date(begin));
    });

    it('should compute the availability over the tested time of the month, not the whole month', async function() {
      const stat = await CheckMonthlyStat.findOne({ check: check._id });
      stat.timestamp.getTime().should.eql(monthBegin);
      stat.downtime.should.eql(33 * minute);
      stat.testedTime.should.eql(63 * minute);
      stat.availability.should.be.approximately(30 / 63, 0.0001);
    });

    it('should compute the availability of a tag over its tested time too', async function() {
      const stat = await TagMonthlyStat.findOne({ name: 'foo' });
      stat.testedTime.should.eql(63 * minute);
      stat.availability.should.be.approximately(30 / 63, 0.0001);
    });

    it('should count a daily stat without tested time as tested all day', async function() {
      const legacyCheck = new mongoose.Types.ObjectId();
      await CheckDailyStat.create({ check: legacyCheck, timestamp: new Date(dayBegin), count: 1, availability: 23 / 24, downtime: hour });
      await QosAggregator.updateMonthlyQos(new Date(begin));
      const stat = await CheckMonthlyStat.findOne({ check: legacyCheck });
      stat.testedTime.should.eql(24 * hour);
      stat.availability.should.be.approximately(23 / 24, 0.0001);
    });

  });

  describe('#updateYearlyQos()', function() {

    before(async function() {
      await QosAggregator.updateDailyQos(new Date(begin));
      await QosAggregator.updateMonthlyQos(new Date(begin));
      await QosAggregator.updateYearlyQos(new Date(begin));
    });

    it('should compute the availability over the tested time of the year, not the whole year', async function() {
      const stat = await CheckYearlyStat.findOne({ check: check._id });
      stat.downtime.should.eql(33 * minute);
      stat.availability.should.be.approximately(30 / 63, 0.0001);
      const tagStat = await TagYearlyStat.findOne({ name: 'foo' });
      tagStat.availability.should.be.approximately(30 / 63, 0.0001);
    });

    it('should count a monthly stat without tested time as tested all month', async function() {
      const legacyCheck = new mongoose.Types.ObjectId();
      await CheckMonthlyStat.create({ check: legacyCheck, timestamp: new Date(monthBegin), end: new Date(monthEnd), count: 1, availability: 0.99, downtime: hour });
      await QosAggregator.updateYearlyQos(new Date(begin));
      const stat = await CheckYearlyStat.findOne({ check: legacyCheck });
      const month = monthEnd - monthBegin;
      stat.availability.should.be.approximately((month - hour) / month, 0.000001);
    });

  });

  describe('Tag', function() {

    let tag;

    before(async function() {
      await QosAggregator.updateDailyQos(new Date(begin));
      await QosAggregator.updateMonthlyQos(new Date(begin));
      await QosAggregator.updateYearlyQos(new Date(begin));
      tag = await new Tag({ name: 'foo' }).save();
    });

    it('#getSingleStatsForPeriod() should return the beginning and the end of the period', async function() {
      const stat = await tag.getSingleStatsForPeriod('day', new Date(begin));
      stat.timestamp.should.eql(dayBegin);
      stat.begin.should.eql(dayBegin);
      stat.end.should.eql(dayBegin + 24 * hour - 1);
    });

    it('#deleteOne() should remove all the stats of the tag, yearly stats included', async function() {
      (await TagYearlyStat.countDocuments({ name: 'foo' })).should.eql(1);
      await tag.deleteOne();
      for (const model of [TagHourlyStat, TagDailyStat, TagMonthlyStat, TagYearlyStat]) {
        (await model.countDocuments({ name: 'foo' })).should.eql(0);
      }
    });

  });

});
