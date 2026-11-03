Uptime Changelog
================

2026-11-03, v4.0
----------------

* Node 26 support: require Node.js 26+ and MongoDB 4.4+, and upgrade all dependencies to their latest versions (Mongoose 9, Express 5, socket.io 4, EJS 7, node-config 5, nodemailer 10, js-yaml 5, Mocha 12)
* Model methods, the QoS aggregator and the interval builder now return promises instead of taking callbacks (warning: changes the signature of methods used by plugins, e.g. `checkEvent.findCheck()`)
* Replace the unmaintained mongoose-lifecycle and connect-flash packages with local equivalents (same events and API)
* Poll queries use `$expr` instead of server-side JavaScript (`$where` is deprecated since MongoDB 8)
* Remove the ICMP poller, which required running Uptime as root
* Enable plugins by listing them in the `plugins` setting, and let them extend both the webapp and the monitor through `initWebApp()` and `initMonitor()` (warning: changes the plugin signature)
* Add plugin extension points: plugins can register custom poller types in the poller collection, add per-check settings to the check form (`checkEdit`, `populateFromDirtyCheck`) stored in `check.pollerParams`, alter requests before polling (`pollerCreated`), inspect responses (`pollerPolled`), and store additional details in `ping.details`
* Add the `basicAuth` plugin, to restrict access to the dashboard and the API with HTTP Basic authentication
* Add the `httpOptions` plugin, to set custom headers and HTTP options on a check
* Add the `patternMatcher` plugin, to check the response body against a pattern
* Store sessions in a cookie instead of the in-memory store, which is not meant for production
* HTTP and HTTPS pollers follow all 3xx redirects, 303 included
* Fix proxy support (`http_proxy`/`https_proxy`), which modern Node.js versions silently bypassed
* Fix relative redirects in HTTP and HTTPS pollers (now resolved against the current URL, port and protocol included)
* Fix the monitor crashing on a check with an unknown poller type or an invalid URL
* Fix the creation of checks without a URL
* Fix plugins receiving an undefined socket.io instance in `initWebApp()`
* Fix hourly, daily, monthly and yearly stats ignoring an outage still in progress at the end of the period once the check is back up, and counting the up time between two outages as downtime
* Fix "up" events always having a zero downtime, so that notifications never said how long the check was down
* Restyle the dashboard with Bootstrap 5.3: a full-width navbar with up, paused and down counts, a light, dark or automatic color mode, a summary card for each stat, a breadcrumb and period buttons tinted by availability to navigate dates, cards for the graphs and lists, a grouped check form, toasts for messages and live events, and a confirmation dialog before deleting a check
* Fix the graphs and stats of the check and tag pages staying empty when the stats load before the page is ready
* `npm test` now runs all test suites against the `uptime-test` database, and covers the REST API, the monitor, the pollers and the bundled plugins

2013-04-22, v3.1
----------------

* Update README.md
* Use Url as Check name when left empty
* Stop the server if MongoDB is not started
* Support port overriding via process.env.PORT
* Fix bug with pause and email
* Fix bug where checks are pinged too often when they timeout
* Add link to uptime home page in the dashboard footer
* Mention the fact that the monitor URL must be accessible without proxy
* Add email plugin
* Added uptime version in the footer

2012-12-07, v3.0
----------------

* Uptime bars
* Exact availability calculation
* New stats page and date navigation
* Replaced Highcharts by Flotr2 for charts. No more licence problem!
* Upgraded to Twitter Bootstrap V2
* Many tweaks in the GUI
* Heavy refactoring

2012-12-07, v2.0
----------------

* Moved Mongo initialization to a dedicated bootstrap file
* Added support for setting the full MongoDB connection string in the config file
* Fixed engine requirement in package.json
* Updated Node poller user agent version
* Fixed console plugin
* Fixed fixtures to let them generate CheckEvents
* Fixed pings list not refreshing live in dashboard

2012-09-19, v2.0rc0
-------------------

* Upgraded Node.js to 0.8
* Bumped main dependencies (Express and Mongoose) to v3. This lead to some refactoring in the model classes.
* Switched to local jQuery to avoid networking issue

2012-09-19, v1.4
----------------

* This is the last release compatible with Node 0.6.
* New events appear as such when watching event list
* Added favicon. The favicon turns red when at least one check is down.

2012-08-05, v1.3
----------------

* Added a User-Agent header to both http and https pollers, to identify pings from the monitor in server logs; you can override the header via configuration
* Fixed "Save and add" redirection
* Made check title optional (falls back to the url)
* Fixed handling of relative Location headers
* Fixed chart timezone and vertical scale bugs
* Made new events more apparent in the navbar, and in the events page
* Removed custom date display logic and added [moment.js](http://momentjs.com/) as a dependency.
* Fixed check when http redirects to https
* Removed lifecycleEventsPlugin and added [mongoose-lifecycle](https://github.com/fzaninotto/mongoose-lifecycle) module as a dependency. This change renames events on Mongoose models from 'pre-' to 'before-' and from 'post-' to 'after-' (e.g. 'postRemove' becomes 'afterRemove').
* Modified API routes to be more RESTful
* Upgraded dependencies (mongoose, express, ejs, config, async, socket.io)
* Added a Reports tab for tags, offering easily accessible monthly reports
* Made tabs compatible with direct links and back button in tag and check view

2012-04-21, v1.2
----------------

* Ping list is now updated in real time
* Added 'Save and add' button in new check form to facilitate batch check creation
* Changed the CheckEvent format for better extensibility (use the fixtures/fixEvents.js fix to migrate existing events)
* Fix polling interval to mimic the behavior of a cron
* Add a way to pause checks in the dashboard GUI, in the API, and in the model
* Split Monitor class and configuration, to fix polling when `autoStartMonitor` is false
* Fixed failure to add check in the dashboard when the protocol wasn't set
* Added UDP poller (bolgovr)

2012-04-10, v1.1
----------------

* Add support for HTTPS checks
* Refactor poller class to allow adapter pattern. Opens the door for UDP, FTP, complete page... check types.
* Removed proxy configuration (now uses environment variables)

2012-03-28, v1.0
----------------

* Initial version