// Fills the stat cards of the check and tag pages with the stat of the period
var StatNavigation = function(interval) {
  this.interval = interval;
  this.init();
}
StatNavigation.prototype.init = function() {
  this.interval.on('refresh-stat', function() {
    var cards = $('#statCards');
    var stat = this.stat;
    if (stat && stat.availability) {
      cards.find('.availability').text(stat.availability.replace('.000', ''));
      cards.find('.responsiveness').text(stat.responsiveness.replace('.000', ''));
      cards.find('.avgRespTime').text(stat.responseTime);
      cards.find('.downtime').text(stat.downtime ? formatDowntime(stat.downtime) : 'None');
    } else {
      // no data for this period
      cards.find('.availability, .responsiveness, .avgRespTime, .downtime').text('–');
    }
  });
}
