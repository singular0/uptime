// Whether a URL from monitored data (a check URL, a ping report URL) may be used as a link.
// Only the schemes of the pollers are allowed, so that a URL such as "javascript:..." cannot
// run script when clicked. The URL parser reads the scheme the same way the browser does
// (ignoring case, leading spaces and tabs), which a pattern match on the string would not.
// Loaded by the dashboard pages, and required by the dashboard app for its server-side views.
function isSafeUrl(url) {
  try {
    return ['http:', 'https:', 'udp:'].includes(new URL(url).protocol);
  } catch (e) {
    return false; // not an absolute URL
  }
}

if (typeof module !== 'undefined') module.exports = isSafeUrl;
