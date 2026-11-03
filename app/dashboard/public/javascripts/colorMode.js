// Color mode of the dashboard: light, dark, or auto to follow the system setting.
// The choice is stored in the browser. This script is loaded in the <head>, so that the page
// renders in the right mode from the start. Pages are told about a change through a
// "themechange" event on the document.
(function() {
  var media = window.matchMedia('(prefers-color-scheme: dark)');

  var storedTheme = function() {
    try {
      return localStorage.getItem('theme');
    } catch (e) {
      return null; // storage disabled
    }
  };
  var storeTheme = function(theme) {
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      // storage disabled: the choice lasts until the page is left
    }
  };
  var preferredTheme = function() {
    var theme = storedTheme();
    return theme === 'light' || theme === 'dark' ? theme : 'auto';
  };
  var applyTheme = function(theme) {
    var mode = theme === 'auto' ? (media.matches ? 'dark' : 'light') : theme;
    document.documentElement.setAttribute('data-bs-theme', mode);
    document.dispatchEvent(new Event('themechange'));
  };
  // marks the chosen item of the theme menu, and shows its icon on the menu button
  var showTheme = function(theme) {
    document.querySelectorAll('[data-theme-value]').forEach(function(item) {
      var active = item.getAttribute('data-theme-value') === theme;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', active);
      if (active) {
        document.getElementById('themeIcon').className = 'bi ' + item.getAttribute('data-theme-icon');
      }
    });
  };

  applyTheme(preferredTheme());
  media.addEventListener('change', function() {
    if (preferredTheme() === 'auto') applyTheme('auto');
  });
  document.addEventListener('DOMContentLoaded', function() {
    showTheme(preferredTheme());
    document.querySelectorAll('[data-theme-value]').forEach(function(item) {
      item.addEventListener('click', function() {
        var theme = item.getAttribute('data-theme-value');
        storeTheme(theme);
        applyTheme(theme);
        showTheme(theme);
      });
    });
  });
})();
