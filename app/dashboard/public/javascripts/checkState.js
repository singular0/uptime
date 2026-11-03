// HTML for the state of a check: a badge, then how long the check has been in that state
var checkStatusHtml = function(check) {
  var badge = function(color, text) {
    return '<span class="badge text-bg-' + color + '">' + text + '</span>';
  };
  var since = function(date) {
    return ' <span class="small text-body-secondary text-nowrap" data-bs-toggle="tooltip" title="' + moment(date).format('LLLL') + '">for ' + moment(date).fromNow(true) + '</span>';
  };
  if (!check.lastTested) {
    return badge('secondary', 'New') + ' <span class="small text-body-secondary text-nowrap">not tested yet</span>';
  }
  if (check.isPaused) {
    return badge('info', 'Paused') + since(check.lastTested);
  }
  if (typeof check.isUp == 'undefined') {
    return badge('secondary', 'Unknown'); // just restarted after a pause
  }
  if (check.isUp) {
    return badge('success', 'Up') + since(check.lastChanged);
  }
  return badge('danger', 'Down') + since(check.lastChanged);
};

// Shows the state of the check in the page header, and on the pause button
var updateCheckState = function(check) {
  $('#checkStatus').html(checkStatusHtml(check));
  $('#pauseButton')
    .find('i').attr('class', 'bi ' + (check.isPaused ? 'bi-play-fill' : 'bi-pause-fill')).end()
    .find('span').text(check.isPaused ? 'Resume' : 'Pause');
};

// Pauses or resumes polling when the pause button is clicked
var initPauseButton = function(checkId) {
  $('#pauseButton').on('click', function() {
    var button = $(this).prop('disabled', true);
    $.getJSON('/api/checks/' + checkId + '/pause', updateCheckState).always(function() {
      button.prop('disabled', false);
    });
  });
};
