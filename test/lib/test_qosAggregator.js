const should = require('should');
const mongoose = require('../../bootstrap');
const QosAggregator = require('../../lib/qosAggregator');
const Check = require('../../models/check');
const CheckEvent = require('../../models/checkEvent');
const CheckHourlyStat = require('../../models/checkHourlyStat');
const CheckDailyStat = require('../../models/checkDailyStat');
const Ping = require('../../models/ping');
const Tag = require('../../models/tag');
const TagHourlyStat = require('../../models/tagHourlyStat');
const { clear } = require('../helpers');

const minute = 60 * 1000;
const hour = 60 * minute;
const models = [Check, CheckEvent, CheckHourlyStat, CheckDailyStat, Ping, Tag, TagHourlyStat];

describe('QosAggregator', function() {

  // a fixed hour in local time, as the aggregator uses local hours and days
  const begin = new Date(2026, 0, 15, 10).getTime();
  const endOfHour = begin + hour - 1;
  const dayBegin = new Date(2026, 0, 15).getTime();
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
      stat.availability.should.be.approximately(30 / 63, 0.0001);
    });

  });

});
