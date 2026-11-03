// uptimeBar.js is a browser script, so it runs here in a context with the globals it uses.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const context = { moment: require('moment') };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../app/dashboard/public/javascripts/uptimeBar.js'), 'utf8'), context);
const uptimeBar = context.uptimeBar;

const hour = 60 * 60 * 1000;

// the class, left and width of each segment of the bar, in %
const segments = function(html) {
  return Array.from(html.matchAll(/<div class="(\w+)"[^>]*?style="([^"]*)"/g), function(match) {
    const style = match[2];
    return {
      type: match[1],
      left: parseFloat(/left:([^;%]+)%/.exec(style)?.[1]),
      width: parseFloat(/width:([^;%]+)%/.exec(style)?.[1]),
      style: style
    };
  });
};

describe('uptimeBar', function() {

  describe('for a check', function() {

    let now, from;

    beforeEach(function() {
      now = Date.now();
      from = now - 24 * hour;
    });

    it('should show the outages of the period', function() {
      const bar = segments(uptimeBar('check', {
        from: from,
        to: now,
        periods: [[now - 6 * hour, now - 5 * hour, 0]],
        check: { firstTested: now - 48 * hour, lastChanged: now - 5 * hour, isUp: true }
      }));
      assert.strictEqual(bar.length, 1);
      assert.strictEqual(bar[0].type, 'down');
      assert.strictEqual(Math.round(bar[0].left), 75);
      assert.strictEqual(Math.round(bar[0].width), 4);
    });

    it('should show the current outage from the last change, and nothing for the up time before it', function() {
      const bar = segments(uptimeBar('check', {
        from: from,
        to: now,
        periods: [[now - 6 * hour, now - 5 * hour, 0]],
        check: { firstTested: now - 48 * hour, lastChanged: now - hour, isUp: false }
      }));
      assert.deepStrictEqual(bar.map(function(segment) { return segment.type; }), ['down', 'down']);
      bar.forEach(function(segment) {
        assert.ok(!/NaN|Infinity|e[+-]/.test(segment.style), 'invalid style: ' + segment.style);
      });
      assert.strictEqual(Math.round(bar[1].left), 96);
      assert.ok(bar[1].width > 4 && bar[1].width < 4.2);
    });

    it('should show the current pause from the last change', function() {
      const bar = segments(uptimeBar('check', {
        from: from,
        to: now,
        periods: [],
        check: { firstTested: now - 48 * hour, lastChanged: now - 2 * hour, isUp: true, isPaused: true }
      }));
      assert.deepStrictEqual(bar.map(function(segment) { return segment.type; }), ['pause']);
      assert.strictEqual(Math.round(bar[0].left), 92);
    });

  });

});
