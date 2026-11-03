uptime
======

A remote monitoring application using Node.js, MongoDB, and Bootstrap.

<img src="https://raw.github.com/fzaninotto/uptime/downloads/check_details.png" title="Visualizing the availability of an HTTP check in Uptime" width="50%" valign="top" />
<img src="https://raw.github.com/fzaninotto/uptime/downloads/check_form.png" title="Editing check attributes (polling interval, slow threshold, alert threshold, pattern to match, tags) in Uptime" width="50%" valign="top" />

You can watch a [demo screencast on Vimeo](https://vimeo.com/39302164).

**Warning**: This application isn't actively maintained anymore. You can find many alternatives, from completely free to very cheap, in [this list of website monitoring services](http://www.supermonitoring.com/blog/the-updated-list-of-website-monitoring-services/).

Features
--------

* Monitor thousands of websites and services over HTTP, HTTPS and UDP (powered by [Node.js](https://nodejs.org/))
* Set the polling interval of each check, down to the second
* Check the response body against a pattern, and send custom HTTP headers and options (e.g. to accept a self-signed certificate)
* Receive notifications when a check goes down or back up
  * On screen, in real time (powered by [socket.io](https://socket.io/))
  * By email
  * On the console
* Record availability statistics for reporting (powered by [MongoDB](https://www.mongodb.com/))
* Detailed uptime reports with charts (powered by [Chart.js](https://www.chartjs.org/))
* Monitor availability, responsiveness, average response time, and total uptime and downtime
* Get details about failed checks (HTTP error code, etc.)
* Group checks by tags and get reports by tag
* Web interface built with [Bootstrap 5](https://getbootstrap.com/)
* Complete REST API for integration with third-party monitoring services
* Monitor from several locations by running monitors in different datacenters
* Protect the dashboard and the API with HTTP Basic authentication
* Plugin system to extend and customize Uptime
* Docker image for linux/amd64 and linux/arm64

Running With Docker
-------------------

Uptime is published as a Docker image, `ghcr.io/singular0/uptime`. Each `vX.Y.Z` release is tagged `X.Y.Z`, `X.Y`, `X` and `latest`. The image runs the webapp and the monitor (`node app.js`) with `NODE_ENV=production` on port 8082.

Uptime stores its data in MongoDB 4.4 or later. This `compose.yaml` file runs Uptime with a MongoDB server:

```yaml
services:
  mongo:
    image: mongo:8
    restart: unless-stopped
    volumes:
      - mongo-data:/data/db
  uptime:
    image: ghcr.io/singular0/uptime:4
    restart: unless-stopped
    depends_on:
      - mongo
    ports:
      - '8082:8082'
    environment:
      NODE_CONFIG: '{"mongodb":{"server":"mongo"}}'
volumes:
  mongo-data:
```

Start it with:

```sh
$ docker compose up -d
```

To use an existing MongoDB server instead, run the image on its own:

```sh
$ docker run -d -p 8082:8082 \
    -e NODE_CONFIG='{"mongodb":{"connectionString":"mongodb://mongo.example.com/uptime"}}' \
    ghcr.io/singular0/uptime:4
```

To change the configuration (see [Configuring](#configuring)), pass the settings to override as JSON in the `NODE_CONFIG` environment variable, as above, or mount a configuration file as `/app/config/production.yaml`:

```yaml
  uptime:
    # ...
    volumes:
      - ./production.yaml:/app/config/production.yaml:ro
```

Mount the single file, not the whole directory, so that the image keeps `default.yaml`. Settings in `NODE_CONFIG` take precedence over the file.

Uptime listens on the port of the `url` setting, or on port 80 if that URL has none. If you set `url` to the address that users browse to (the email plugin uses it in links), also set the `PORT` environment variable to `8082`.

To add a plugin or an npm package to the image, build your own image from it. For instance, the `SES` method of the email plugin needs the AWS SDK:

```dockerfile
FROM ghcr.io/singular0/uptime:4
USER root
RUN npm install --omit=dev @aws-sdk/client-sesv2
USER node
```

A plugin without dependencies can instead be mounted as a directory under `/app/plugins/`, and listed in the `plugins` setting.

Upgrading From a 3.x Install
----------------------------

Uptime 4.0 stores data in the same format as 3.x, so there is no migration script to run, and the REST API is unchanged. However, Uptime now requires MongoDB 4.4 or later, and some configuration and plugins need changes. See the [changelog](CHANGELOG.md) for the full list of changes.

MongoDB only upgrades data files in place from the previous release series, so the simplest way to move to a new MongoDB server is to dump the data and restore it there. With the `compose.yaml` file from [Running With Docker](#running-with-docker):

1. Stop the webapp and every monitor process, and dump the database with the tools of the old MongoDB server:

   ```sh
   $ mongodump --db uptime --out dump
   ```

2. Start the MongoDB container, and restore the dump into it:

   ```sh
   $ docker compose up -d mongo
   $ docker compose cp dump mongo:/tmp/dump
   $ docker compose exec mongo mongorestore /tmp/dump
   ```

3. Copy your `config/production.yaml` next to `compose.yaml`, mount it into the `uptime` container, and update it as described below. Remove `mongodb.connectionString` from it, because it takes precedence over the `mongodb.server` setting that points Uptime to the `mongo` container.
4. Start Uptime:

   ```sh
   $ docker compose up -d
   ```

5. If you run monitors separately, replace them with containers too (see [Architecture](#architecture)).

### Configuration Changes

* `email` plugin: `transport` is passed as is to nodemailer 10, whose options changed since nodemailer 0.x (for instance, `secureConnection` is now `secure`). With the `Sendmail` method, `transport` holds the sendmail options, such as `path`. The `SES` method needs the AWS SDK in the image (see [Running With Docker](#running-with-docker)), and `transport` holds the `SESv2Client` options, such as `region` and `credentials`. See the comment at the top of [`plugins/email/index.js`](plugins/email/index.js).
* MongoDB credentials: Uptime sends `mongodb.user` and `mongodb.password` only when both are set, and URL-encodes them. If you escaped special characters in the password yourself, remove the escaping. `mongodb.connectionString` is used as is.
* `url`: if you set it, also set the `PORT` environment variable (see [Running With Docker](#running-with-docker)).

### Plugin Changes

Custom and third-party plugins written for 3.x will probably need updating:

* Model methods return promises and no longer accept callbacks (Mongoose 9). For instance, `checkEvent.findCheck(function(err, check) { ... })` becomes `checkEvent.findCheck().then(function(check) { ... })`. Always add a `.catch()`, because an unhandled rejection stops the process.
* Lifecycle events are unchanged. `beforeRemove` and `afterRemove` fire on `document.deleteOne()`, because Mongoose no longer has `document.remove()`.
* The `app`, `api` and `dashboard` apps run on Express 5. `app.configure()` and the middlewares that Express 3 bundled, such as `express.basicAuth()` and `express.bodyParser()`, no longer exist. See the [Express 5 migration guide](https://expressjs.com/en/guide/migrating-5.html).
* The `io` option passed to `initWebApp()` is a socket.io 4 server (plugins listed in `config.plugins` used to receive `undefined`). `socket.set()`, `socket.get()` and `io.set()` no longer exist; use `socket.data` and rooms instead.
* Templates are rendered with EJS 7. Replace `<% include file %>` with `<%- include('file') %>`, and call `ejs.render(template, data)` instead of `ejs.render(template, { locals: data })`. This also applies to customized email templates in `plugins/email/views/`.
* The dashboard uses Bootstrap 5 and jQuery 4. Form fields injected into the check edit page by a `checkEdit` listener need Bootstrap 5 markup (see the `httpOptions` and `patternMatcher` partials), and dashboard scripts can't use the jQuery functions removed in 4.0, such as `$.trim()` and `$.isArray()`.
* Plugins that load one of Uptime's dependencies get its new major version. For instance, js-yaml's `safeLoad()` and `safeDump()` are now `load()` and `dump()`.

Adding Checks
-------------

By default, the web UI runs on port 8082, so just browse to 

    http://localhost:8082/

And you're ready to begin. Create your first check by entering an URL, wait for the first ping, and you'll soon see data flowing through your charts!

Configuring
-----------

Uptime uses [node-config](https://github.com/lorenwest/node-config) to allow YAML configuration and environment support. Here is the default configuration, taken from `config/default.yaml`:

```yaml
url:        'http://localhost:8082'

mongodb:
  server:   localhost
  database: uptime
  user:     root 
  password:
  connectionString:       # alternative to setting server, database, user and password separately

monitor:
  name:                   origin
  apiUrl:                 'http://localhost:8082/api' # must be accessible without a proxy
  pollingInterval:        10000      # ten seconds
  timeout:                5000       # five seconds
  userAgent:              NodeUptime/2.0 (https://github.com/fzaninotto/uptime)

analyzer:
  updateInterval:         60000      # one minute
  qosAggregationInterval: 600000     # ten minutes
  pingHistory:            8035200000 # three months

autoStartMonitor: true

plugins:
  - ./plugins/console
  - ./plugins/patternMatcher
  - ./plugins/httpOptions
  # - ./plugins/email
```

To modify this configuration, override just the settings you need in a `production.yaml` file, or in the `NODE_CONFIG` environment variable (see [Running With Docker](#running-with-docker)). For instance, to set the address that users browse to:

```yaml
url: 'https://uptime.example.com'
```

Note that Uptime works great behind a proxy - it uses the `http_proxy` and `https_proxy` environment variables transparently.

Architecture
------------

Uptime is composed of two services: a webapp (in `app.js`), and a polling monitor (in `monitor.js`). For your convenience, the two services start together in the same container.

<img src="https://raw.github.com/fzaninotto/uptime/downloads/architecture.png" title="Uptime architecture" />

However, heavily browsing the webapp may slow down the whole server - including the polling monitor. In other terms, using the application can influence the uptime measurements. To avoid this effect, it is recommended to run the polling monitor in a separate process.

To that extent, set the `autoStartMonitor` setting to `false` for the webapp, and run the monitor in its own container from the same image, with `node monitor.js` as the command. In the `compose.yaml` file from [Running With Docker](#running-with-docker), change the `uptime` service and add a `monitor` service:

```yaml
  uptime:
    # ...
    environment:
      NODE_CONFIG: '{"mongodb":{"server":"mongo"},"autoStartMonitor":false}'
  monitor:
    image: ghcr.io/singular0/uptime:4
    restart: unless-stopped
    depends_on:
      - uptime
    command: node monitor.js
    environment:
      NODE_CONFIG: '{"monitor":{"apiUrl":"http://uptime:8082/api"}}'
```

You can also run the monitor on a different server. This second server must be able to reach the API of the webapp server: set the `monitor.apiUrl` setting accordingly.

```sh
$ docker run -d \
    -e NODE_CONFIG='{"monitor":{"apiUrl":"https://uptime.example.com/api"}}' \
    ghcr.io/singular0/uptime:4 node monitor.js
```

Monitoring From Various Locations
---------------------------------

You can even run several monitor servers in several datacenters to get average response time. In that case, make sure you set a different `monitor.name` setting for all monitor servers to be able to tell which server make a particular ping.

Using Plugins
-------------

Plugins can add more notification types, more poller types, new routes to the webapp, etc. Uptime currently bundles three plugins:

 * [`console`](https://github.com/fzaninotto/uptime/blob/master/plugins/console/index.js): log pings and events in the console in real time
 * [`email`](https://github.com/fzaninotto/uptime/blob/master/plugins/email/index.js): notify events (up, down pause) by email
 * [`patternMatcher`](https://github.com/fzaninotto/uptime/blob/master/plugins/patternMatcher/index.js): allow HTTP & HTTPS pollers to test the response body against a pattern
 * [`httpOptions`](https://github.com/fzaninotto/uptime/blob/master/plugins/httpOptions/index.js): add custom HTTP options and headers to HTTP and HTTPS checks (e.g. to allow self-signed certificate on HTTPS, custom headers, custom HTTP methods, ...)
 * [`basicAuth`](https://github.com/fzaninotto/uptime/blob/master/plugins/basicAuth/index.js): add HTTP Basic Access Authentication to the dashboard and API applications

To enable plugins, just add a line to the `plugins:` section of the configuration file.
Three of the bundled plugins are already enabled by default:

```yaml
# in config/default.yaml
plugins:
  - ./plugins/console
  - ./plugins/patternMatcher
  - ./plugins/httpOptions
  # - ./plugins/email
  # - ./plugins/basicAuth
```

You can override these settings in your environment configuration, for instance:

```yaml
# in config/production.yaml
# disable the console plugin and enable the email plugin
plugins:
  # - ./plugins/console
  - ./plugins/patternMatcher
  - ./plugins/httpOptions
  - ./plugins/email
  # - ./plugins/basicAuth
```

Third-party plugins:

 * [`webhooks`](https://github.com/mintbridge/uptime-webhooks): notify events to an URL by sending an HTTP POST request 
 * [`campfire`](https://gist.github.com/dmathieu/5592418): notify events to Campfire
 * [`pushover`](https://gist.github.com/xphyr/5994345): Notify events to mobile devices

Writing Plugins
---------------

A plugin is a simple Node.js module which hooks into predefined extension points. Uptime automatically requires plugin modules when starting the webapp and the monitor, and tries to call the two following functions:

* `initWebApp(options)` when starting the webapp
* `initMonitor(options)` when starting the monitor

Check the [app.js](https://github.com/fzaninotto/uptime/blob/master/app.js#L97) and [monitor.js](https://github.com/fzaninotto/uptime/blob/master/monitor.js#L8) to see a detail of the options passed to each hook. Also, check the code of existing plugins to understand how they can add new pollers, new notification types, etc.

For instance, if you had to recreate a simple version of the `console` plugin, you could write it as follows:

```js
// in plugins/console/index.js
var CheckEvent = require('../../models/checkEvent');
exports.initWebApp = function() {
  CheckEvent.on('afterInsert', function(checkEvent) {
    checkEvent.findCheck().then(function(check) {
      console.log(new Date() + ' ' + check.name + ' ' + checkEvent.message);
    }).catch(console.error);
  });
}
```
Uptime entities are [Mongoose](https://mongoosejs.com/) models, so their methods return promises (callbacks are not supported). All Uptime entities emit lifecycle events that you can listen to on the Model class. These events are `beforeInsert`, `afterInsert`, `beforeUpdate`, `afterUpdate`, `beforeSave` (called for both inserts and updates), `afterSave` (called for both inserts and updates), `beforeRemove`, and `afterRemove` (called on `document.deleteOne()`). For more information about these events, check the [lifecycle plugin](https://github.com/fzaninotto/uptime/blob/master/models/plugins/lifecycle.js).

API
---------------

All API requests should be prefixed with `api`.
The API response always uses the `application/json` mimetype.
API requests do not require authentication.

Example of a valid API request:

`GET http://example.com/api/checks`

Example for a valid API request using curl :

`curl -i -H "Accept: application/json" -X PUT -d "name=example" -d "url=http://mysite.com" -d "interval=120" http://example.com/api/checks`

### Status codes

The API is designed to return different status codes :

* `200 Ok` : The request was successful, the resource(s) itself is returned as JSON
* `400 Bad Request` : An attribute of the API request is invalid or missing (e.g. the url of a check is missing)
* `404 Not Found` : A resource could not be accessed (e.g. a check ID could not be found)
* `500 Server Error` : Something went wrong on the server side (e.g. a check could not be saved in database)

### CRUD routes

#### `GET /checks`

Return a list of all checks

#### `GET /checks/needingPoll`

Return a list of checks that need a poll (i.e. not paused, plus new or last tested > interval set between tests)

#### `GET /checks/:id`

Return a single check

Parameter :

* `id` : (required) Id of the check

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004`

#### `GET /checks/:id/pause`

Toggle the status (isPaused) of a check

Parameter :

* `id` : (required) Id of the check

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004/pause`

#### `PUT /check/:id/test`

Updates the last checked date for a check. Used to avoid double check when a target is slow.
Return the number of affected records in the database (1 or 0).

Parameter :

* `id` : (required) Id of the check

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004/test`

#### `GET /pings`

Return a list of all pings

Parameters :

* `?page=1` : (optional) Paginate results by 50
* `?check=:id` : (optional) Return only the pings for a given check

Ex: `http://localhost:8082/api/pings?check=527a25bdc9de6e0000000004`

#### `GET /pings/events`

Return a list of events (CheckEvent) aggregated by day, limited to the latest week, and to 100 results

#### `POST /pings`

Create a ping for a check, if the check exists and is not already polled

Parameters :

* `checkId` : (required) Id of the check
* `status` : (required)  Status
* `timestamp` : (optional) Date of polling
* `time` : (required) Response time
* `name` : (optional) Monitor name
* `error` : (optional)
* `details` : (optional)

#### `GET /tags`

Return list of all tags

#### `GET /tags/:name`

Return a single tag

Parameter :

* `name` : (required) name of the tag

Ex: `http://localhost:8082/tags/good`

#### `PUT /checks`

Create a new check and return it

Parameters :

* `url` : (required) Url of the check
* `name` : (optional) Name of the check - if empty, url will be set as check name
* `interval` : (optional) Interval of polling
* `maxTime` : (optional) Slow threshold
* `isPaused` : (optional) Status of polling
* `alertTreshold` : (optional) set the threshold of failed pings that will create an alert
* `tags` : (optional) list of tags (comma-separated values)
* `type` : (optional) type of check (auto|http|https|udp)

#### `POST /checks/:id`

Update a check and return it

Parameters :

* `id` : (required) Id of the check
* `url` : (optional) Url of the check
* `name` : (optional) Name of the check - if empty, url will be set as check name
* `interval` : (optional) Interval of polling
* `maxTime` : (optional) Slow threshold
* `isPaused` : (optional) Status of polling
* `alertTreshold` : (optional) set the threshold of failed pings that will create an alert
* `tags` : (optional) list of tags (comma-separated values)
* `type` : (optional) type of check - values : `auto`|`http`|`https`|`udp`

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004`

#### `DELETE /checks/:id`

Delete a check

Parameters :

* `id` : (required) Id of the check

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004`

### Statistics routes

#### `GET /checks/:id/stat/:period/:timestamp`

Return check stats for a period

Parameters :

   * `id` : (required) Id of the check
   * `period` : (required) Period - values :  `hour`|`day`|`month`|`year`
   * `timestamp` : (required) Start date (timestamp)

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004/stat/day/1383260400000`

#### `GET /checks/:id/stats/:type`

Return check stats for a period

Parameters :

* `id` : (required) Id of the check
* `type` : (required) Period - values :  `hour`|`day`|`month`|`year`
* `?begin=` : (required) Start date (timestamp)
* `?end=` : (required) End date (timestamp)

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004/stats/month?begin=1383260400000&end=1385852399999`

#### `GET /tags/:name/checks/:period/:timestamp`

Return tag stats for a period, joined by checks

Parameters :

* `name` : (required) Name of the tag
* `period` : (required) Period - values :  `hour`|`day`|`month`|`year`
* `timestamp` : (required) Start date (timestamp)

Ex: `http://localhost:8082/api/tags/good/checks/month/1384816432099`

#### `GET /tags/:name/stat/:period/:timestamp`

Return tag stats for a period

Parameters :

* `name` : (required) Name of the tag
* `period` : (required) Period - values :  `hour`|`day`|`month`|`year`
* `timestamp` : (required) Start date (timestamp)

Ex: `http://localhost:8082/api/tags/good/stat/month/1383260400000`

#### `GET /tags/:name/stats/:type`

Return tag stats for a period

Parameters :

* `name` : (required) Name of the tag
* `type` : (required) Period - values :  `day`|`month`|`year`
* `?begin=` : (required) Start date (timestamp)
* `?end=` : (required) End date (timestamp)

Ex: `http://localhost:8082/api/tags/good/stats/month?begin=1383260400000&end=1385852399999`

### Event routes

#### `GET /checks/:id/events`

Return the list of all events for the check

Parameter :

* `id` : (required) Id of the check

Ex: `http://localhost:8082/api/checks/527a25bdc9de6e0000000004/events`

#### `GET /tags/:name/events`

Return the list of all events associated to the tag

Parameter :

* `name` : (required) Name of the tag
* `?begin=` : (optional) Start date (timestamp)
* `?end=` : (optional) End date (timestamp)

Ex: `http://localhost:8082/api/tags/good/events?begin=1383260400000&end=1385852399999`

Support and Discussion
----------------------

Join the [node-uptime](https://groups.google.com/d/forum/node-uptime) Google Group to discuss features, bugs and use cases related to Uptime.

License
-------

The Uptime code is free to use and distribute, under the [MIT license](https://raw.github.com/fzaninotto/uptime/master/LICENSE).

Uptime uses third-party libraries:

* [NodeJS](http://nodejs.org/), licensed under the [MIT License](https://github.com/joyent/node/blob/master/LICENSE#L5-22),
* [Socket.io](http://socket.io/), licensed under the [MIT License](https://github.com/LearnBoost/socket.io/blob/master/Readme.md),
* [MongooseJS](http://mongoosejs.com/), licensed under the [MIT License](https://github.com/LearnBoost/mongoose/blob/master/README.md),
* [jQuery](http://jquery.com/), licensed under the [MIT License](http://jquery.org/license),
* [TwitterBootstrap](http://twitter.github.com/bootstrap/), licensed under the [Apache License v2.0](http://www.apache.org/licenses/LICENSE-2.0),
* [Flotr2](http://www.humblesoftware.com/flotr2/), licensed under the [MIT License](https://github.com/HumbleSoftware/Flotr2/blob/master/LICENSE).
* [Favicon](http://www.alexpeattie.com/projects/justvector_icons/), distributed under the [Free Art License](http://artlibre.org/licence/lal/en).

If you like the software, please help improving it by contributing PRs on the [GitHub project](https://github.com/fzaninotto/uptime)!

TODO
----

* Account for scheduled maintenance (and provide two QoS calculations: with and without scheduled maintenance)
* Allow for JavaScript execution in the monitored resources by using a headless browser (probably zombie.js)
* Unit tests
