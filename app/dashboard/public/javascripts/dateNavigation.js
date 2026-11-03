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

  // change date on click
  $('#dateNavigation').on('click', 'button', function(event) {
    var data = $(this).data();
    interval.update(data.type, parseInt(data.date));
  });

  // redraw date range when time passes to enable new interval buttons
  setInterval(this.redrawPeriods.bind(this), 5 * 60 * 1000);

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
  this.redrawZoom();
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
  var type  = this.interval.type;
  var button = '<button type="button" class="btn btn-sm btn-outline-secondary"';
  var periods = '<div class="btn-group">';
  if (this.interval.beginsAfterOrigin()) {
    periods += button + ' data-type="' + type + '" data-date="' + this.interval.getPreviousDate() + '" title="Previous ' + type + '">&lt;</button>';
  } else {
    periods += button + ' disabled>&lt;</button>';
  }
  var begin = this.interval.begin;
  var end   = this.interval.end;
  var subtype = this.interval.subType(type);
  var d = begin.clone();
  while (d.valueOf() < end.valueOf()) {
    if (d.valueOf() < Date.now() && d.clone().endOf(subtype).valueOf() > this.interval.origin && !this.interval.isMaxZoom()) {
      periods += button + ' data-type="' + subtype + '" data-date="' + d.valueOf() + '" title="' + this.tooltipForPeriod(d, subtype) + '">' + this.titleForPeriod(d, subtype) + '</button>';
    } else {
      periods += button + ' disabled>' + this.titleForPeriod(d, subtype) + '</button>';
    }
    if (subtype == 'tenminutes') {
      d.add(10, 'minutes');
    } else {
      d.add(1, subtype);
    }
  }
  if (this.interval.endsBeforeNow()) {
    periods += button + ' data-type="' + type + '" data-date="' + this.interval.getNextDate() + '" title="Next ' + type + '">&gt;</button>';
  } else {
    periods += button + ' disabled>&gt;</button>';
  }
  periods += '</div>';
  $('#dateNavigation .periods').html(periods);
}
DateNavigation.prototype.redrawTitle = function() {
  var title = '';
  var momentForDate = this.interval.momentForDate;
  var link = '<button type="button" class="btn btn-link"';
  switch (this.interval.type) {
    case 'year':
      title += momentForDate.year();
      break;
    case 'month':
      title += momentForDate.format('MMMM') + ' ';
      title += link + ' data-type="year" data-date="' + this.interval.date + '">';
      title += momentForDate.year();
      title += '</button>';
      break;
    case 'day':
      title += momentForDate.format('dddd ');
      title += link + ' data-type="month" data-date="' + this.interval.date + '">';
      title += momentForDate.format('MMMM');
      title += '</button> ';
      title += momentForDate.format('Do, YYYY');
      break;
    case 'hour':
      title += link + ' data-type="day" data-date="' + this.interval.date + '">';
      title += momentForDate.format('dddd MMMM Do');
      title += '</button>, ';
      title += momentForDate.clone().startOf('hour').format('ha') + ' to ' + momentForDate.clone().endOf('hour').format('h:mma');
  }
  $('#dateNavigation .title').html(title);
}
DateNavigation.prototype.redrawZoom = function() {
  var zoom = '';
  var button = '<button type="button" class="btn btn-sm btn-outline-secondary"';
  var subType = this.interval.subType(this.interval.type);
  if (subType !== false && !this.interval.isMaxZoom()) {
    zoom += button + ' data-type="' + subType + '" data-date="' + this.interval.date + '" title="Zoom in"><i class="bi bi-zoom-in"></i></button>';
  } else {
    zoom += button + ' disabled><i class="bi bi-zoom-in"></i></button>';
  }
  var superType = this.interval.superType(this.interval.type);
  if (superType !== false) {
    zoom += button + ' data-type="' + superType + '" data-date="' + this.interval.date + '" title="Zoom out"><i class="bi bi-zoom-out"></i></button>';
  } else {
    zoom += button + ' disabled><i class="bi bi-zoom-out"></i></button>';
  }
  $('#dateNavigation .zoom').html(zoom);
}
