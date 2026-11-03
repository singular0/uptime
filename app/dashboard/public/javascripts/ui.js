/* global bootstrap, moment */

// Shared dashboard helpers: Bootstrap tooltips and toasts, and how check events look.

// Any element with data-bs-toggle="tooltip" and a title gets a Bootstrap tooltip, including
// elements added later. Lists are redrawn by replacing their HTML, and a tooltip open on a
// removed element would stay on screen, so tooltips are disposed of with their element.
document.addEventListener('DOMContentLoaded', function() {
  var selector = '[data-bs-toggle="tooltip"]';
  new bootstrap.Tooltip(document.body, { selector: selector });
  new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      mutation.removedNodes.forEach(function(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        [node].concat(Array.from(node.querySelectorAll(selector))).forEach(function(element) {
          var tooltip = bootstrap.Tooltip.getInstance(element);
          if (tooltip) tooltip.dispose();
        });
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
});

// Shows a toast in the corner of the page.
// options:
//   text:  the message, as text
//   href:  optional link for the message
//   icon:  Bootstrap Icons class, e.g. 'bi-check-circle-fill'
//   color: theme color of the icon, e.g. 'success'
//   delay: time before the toast hides, in ms
function showToast(options) {
  var toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');

  var body = document.createElement('div');
  body.className = 'toast-body d-flex align-items-center gap-2';
  var icon = document.createElement('i');
  icon.className = 'bi fs-5 ' + options.icon + ' text-' + options.color;
  icon.setAttribute('aria-hidden', 'true');
  var message = document.createElement(options.href ? 'a' : 'span');
  message.className = 'me-auto';
  message.textContent = options.text;
  if (options.href) message.href = options.href;
  var close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-close flex-shrink-0';
  close.setAttribute('data-bs-dismiss', 'toast');
  close.setAttribute('aria-label', 'Close');
  body.append(icon, message, close);
  toast.append(body);

  document.getElementById('toasts').append(toast);
  toast.addEventListener('hidden.bs.toast', function() {
    toast.remove();
  });
  bootstrap.Toast.getOrCreateInstance(toast, { delay: options.delay || 5000 }).show();
}

// A downtime given in seconds, exact when short, in words otherwise
function formatDowntime(seconds) {
  return seconds < 300 ? seconds + ' s' : moment.duration(seconds, 'seconds').humanize();
}

// Icon and theme color of each kind of check event
var checkEventStyles = {
  up: { icon: 'bi-arrow-up-circle-fill', color: 'success', label: 'Up' },
  down: { icon: 'bi-arrow-down-circle-fill', color: 'danger', label: 'Down' },
  paused: { icon: 'bi-pause-circle-fill', color: 'info', label: 'Paused' },
  restarted: { icon: 'bi-play-circle-fill', color: 'info', label: 'Restarted' }
};
function checkEventStyle(event) {
  return checkEventStyles[event.message] || { icon: 'bi-question-circle-fill', color: 'secondary', label: 'Unknown' };
}

// What happened to the check, as text following the check name
function describeCheckEvent(event) {
  switch (event.message) {
    case 'paused':
    case 'restarted':
      return 'was ' + event.message;
    case 'down':
      return 'went down' + (event.details ? ' (' + event.details + ')' : '');
    case 'up':
      return event.downtime ? 'went back up after ' + moment.duration(event.downtime).humanize() + ' of downtime' : 'is now up';
    default:
      return 'had an unknown event';
  }
}
