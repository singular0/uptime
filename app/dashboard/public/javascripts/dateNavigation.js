// Date navigation of the check and tag pages: a breadcrumb to zoom out, period buttons to zoom
// in or move to the previous or next period, and the uptime bar of the period.
var DateNavigation = function(interval, type, check) {
  this.interval = interval;
  this.initialType = interval.type;
  this.initialDate = interval.date;
  this.init(type, check);
}
DateNavigation.prototype.init = function(type, check) {
  // redraw on date change
  this.redraw();
  var interval = this.interval;
  interval.on('change-date', this.redraw.bind(this));

  // change date on click. Breadcrumb items are links, which can still open in a new tab.
  $('#dateNavigation').on('click', '[data-type]', function(event) {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    var data = $(this).data();
    interval.update(data.type, parseInt(data.date));
  });

  // redraw date range when time passes to enable new interval buttons
  setInterval(this.redrawPeriods.bind(this), 5 * 60 * 1000);

  // tint the period buttons when the stats arrive
  interval.on('refresh-stats', this.tintPeriods.bind(this));

  // redraw uptime bar when the data arrives
  interval.on('refresh-stat', function() {
    var outages = this.stat ? this.stat.outages || [] : [];
    var args = {
      from: interval.begin.valueOf(),
      to: interval.end.valueOf(),
      periods: outages
    }

    if (type == 'check') {
      args.check = check;
    } else if (type == 'tag') {
      args.origin = this.origin.valueOf();
    }

    $('#dateNavigation .timeline').html(
      uptimeBar(type, args)
    );
  });

  // sections scrolled into view stop below the navigation, which sticks to the top of the page
  var navigation = document.getElementById('dateNavigation');
  new ResizeObserver(function() {
    document.documentElement.style.setProperty('--date-navigation-height', navigation.offsetHeight + 'px');
  }).observe(navigation);

  // manage back navigation: each date change gets a history entry whose URL holds the interval
  var self = this;
  this.pushStateEnabled = true;
  interval.on('change-date', function() {
    if (!self.pushStateEnabled) return;
    history.pushState(null, '', '?type=' + this.type + '&date=' + this.date + location.hash);
  });
  window.addEventListener('popstate', function() {
    // the URL can be edited by hand, and the type ends up in the navigation HTML
    var query = new URLSearchParams(location.search);
    var type = interval.isValidType(query.get('type')) ? query.get('type') : self.initialType;
    var date = parseInt(query.get('date')) || self.initialDate;
    if (type == interval.type && date == interval.date) return; // only the hash changed
    self.pushStateEnabled = false;
    interval.update(type, date);
    self.pushStateEnabled = true;
  });
}
DateNavigation.prototype.redraw = function() {
  this.redrawTitle()
  this.redrawPeriods();
}
DateNavigation.prototype.titleForPeriod = function(date, type) {
  switch (type) {
    case 'month': return date.format('MMMM');
    case 'day': return date.format('D');
    case 'hour': return date.format('ha');
    case 'tenminutes':
      return date.format('h:mma') + " to " + date.clone().add(10, 'minutes').subtract(1, 'seconds').format('h:mma');
  }
}
DateNavigation.prototype.tooltipForPeriod = function(date, type) {
  switch (type) {
    case 'month': return date.format('MMMM YYYY');
    case 'day': return date.format('dddd, LL');
    case 'hour':
      return "from " + date.format('h:mma') + " to " + date.clone().endOf('hour').format('h:mma');
    case 'tenminutes': return '';
  }
}
DateNavigation.prototype.redrawPeriods = function() {
  var interval = this.interval;
  var type = interval.type;
  var button = function(attributes, content) {
    return '<button type="button" class="btn btn-sm btn-outline-secondary"' + attributes + '>' + content + '</button>';
  };
  var tooltip = function(title) {
    return title ? ' data-bs-toggle="tooltip" title="' + title + '"' : '';
  };
  var periods = '<div class="btn-group" role="group" aria-label="Periods">';
  var previous = ' aria-label="Previous ' + type + '"';
  if (interval.beginsAfterOrigin()) {
    periods += button(previous + ' data-type="' + type + '" data-date="' + interval.getPreviousDate() + '"' + tooltip('Previous ' + type), '<i class="bi bi-chevron-left"></i>');
  } else {
    periods += button(previous + ' disabled', '<i class="bi bi-chevron-left"></i>');
  }
  var subtype = interval.subType(type);
  var d = interval.begin.clone();
  while (d.valueOf() < interval.end.valueOf()) {
    // data-begin lets tintPeriods() find the period of every button, even disabled ones
    var begin = ' data-begin="' + d.valueOf() + '"';
    if (d.valueOf() < Date.now() && d.clone().endOf(subtype).valueOf() > interval.origin && !interval.isMaxZoom()) {
      periods += button(begin + ' data-type="' + subtype + '" data-date="' + d.valueOf() + '"' + tooltip(this.tooltipForPeriod(d, subtype)), this.titleForPeriod(d, subtype));
    } else {
      periods += button(begin + ' disabled', this.titleForPeriod(d, subtype));
    }
    if (subtype == 'tenminutes') {
      d.add(10, 'minutes');
    } else {
      d.add(1, subtype);
    }
  }
  var next = ' aria-label="Next ' + type + '"';
  if (interval.endsBeforeNow()) {
    periods += button(next + ' data-type="' + type + '" data-date="' + interval.getNextDate() + '"' + tooltip('Next ' + type), '<i class="bi bi-chevron-right"></i>');
  } else {
    periods += button(next + ' disabled', '<i class="bi bi-chevron-right"></i>');
  }
  periods += '</div>';
  $('#dateNavigation .periods').html(periods);
  this.tintPeriods();
}
// Tints each period button by the availability during its period: fully up, mostly up
// (99% or more), or down. Periods without stats keep the default look.
DateNavigation.prototype.tintPeriods = function() {
  var interval = this.interval;
  var subtype = interval.subType(interval.type);
  var stats = interval.stats || [];
  var pings = interval.type == 'hour'; // the stats of an hour are its pings
  $('#dateNavigation .periods [data-begin]').each(function() {
    var begin = parseInt(this.getAttribute('data-begin'));
    var end = subtype == 'tenminutes' ? begin + 10 * 60 * 1000 : moment(begin).add(1, subtype).valueOf();
    var total = 0;
    var count = 0;
    stats.forEach(function(stat) {
      var timestamp = new Date(stat.timestamp).valueOf();
      if (timestamp < begin || timestamp >= end) return;
      total += pings ? (stat.isUp ? 100 : 0) : Number(stat.availability);
      count++;
    });
    var availability = count ? total / count : null;
    this.classList.toggle('period-up', availability === 100);
    this.classList.toggle('period-degraded', availability !== null && availability < 100 && availability >= 99);
    this.classList.toggle('period-down', availability !== null && availability < 99);
  });
}
// The breadcrumb shows the period from the year down, and each level above it zooms out
DateNavigation.prototype.redrawTitle = function() {
  var date = this.interval.momentForDate;
  var value = this.interval.date;
  var levels = [
    { type: 'year', label: date.format('YYYY') },
    { type: 'month', label: date.format('MMMM') },
    { type: 'day', label: date.format('dddd D') },
    { type: 'hour', label: date.clone().startOf('hour').format('ha') + ' – ' + date.clone().endOf('hour').format('h:mma') }
  ];
  var current = this.interval.types.indexOf(this.interval.type);
  var crumbs = levels.slice(0, current + 1).map(function(level, index) {
    if (index == current) {
      return '<li class="breadcrumb-item active" aria-current="page">' + level.label + '</li>';
    }
    return '<li class="breadcrumb-item"><a href="?type=' + level.type + '&date=' + value + '" data-type="' + level.type + '" data-date="' + value + '">' + level.label + '</a></li>';
  });
  $('#dateNavigation .breadcrumb').html(crumbs.join(''));
}
