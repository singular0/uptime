const should = require('should');
const mongoose = require('../../bootstrap');
const Check = require('../../models/check');

describe('Check', function() {

  before(function() {
    return Check.collection.deleteMany({});
  });

  after(function() {
    return Check.collection.deleteMany({});
  });

  describe('.needingPoll()', function() {

    it('should return the same checks as #needsPoll()', async function() {
      const now = Date.now();
      const minute = 60 * 1000;
      const fixtures = {
        'never tested': {},
        'never tested, paused': { isPaused: true },
        'tested long ago': { firstTested: new Date(now - 60 * minute), lastTested: new Date(now - 10 * minute) },
        'tested long ago, paused': { isPaused: true, firstTested: new Date(now - 60 * minute), lastTested: new Date(now - 10 * minute) },
        // the delay ((lastTested - firstTested) % interval) aligns the polls on the first test
        'tested recently': { firstTested: new Date(now - 10 * 1000 - 59 * minute), lastTested: new Date(now - 10 * 1000) },
        'tested recently, with delay due': { interval: 5 * minute, firstTested: new Date(now - minute - 64.5 * minute), lastTested: new Date(now - minute) },
        'tested recently, with delay not due': { interval: 5 * minute, firstTested: new Date(now - minute - 61 * minute), lastTested: new Date(now - minute) },
        'zero interval': { interval: 0, firstTested: new Date(now - 60 * minute), lastTested: new Date(now - 10 * minute) },
        'tested but never polled': { firstTested: new Date(now - 60 * minute) }
      };
      const checks = await Promise.all(Object.keys(fixtures).map(function(name) {
        return new Check(Object.assign({ name: name }, fixtures[name])).save();
      }));
      const expected = checks.filter(function(check) {
        try {
          return check.needsPoll();
        } catch (err) {
          return false; // #needsPoll() fails on inconsistent data, the query ignores such checks
        }
      }).map(function(check) { return check.name; }).sort();
      const needingPoll = await Check.needingPoll();
      needingPoll.map(function(check) { return check.name; }).sort().should.eql(expected);
      expected.should.eql(['never tested', 'tested long ago', 'tested recently, with delay due']);
    });

  });

});
