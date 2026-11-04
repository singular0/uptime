# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

Uptime is a remote monitoring app built with Node.js, MongoDB, Express and socket.io. It is no longer maintained upstream, but this fork runs on Node.js 26+ and MongoDB 4.4+ with current dependencies: Express 5, Mongoose 9, socket.io 4, EJS 7, node-config 5 and Mocha 12. The code is CommonJS.

- Mongoose 9 has no callbacks. Model methods, `lib/qosAggregator.js` and `lib/intervalBuilder.js` are async and return promises. Express 5 forwards rejections from async route handlers to the error handler.
- API routes let errors propagate instead of wrapping them. An error middleware in `app/api/app.js` turns Mongoose `ValidationError`/`CastError` and `SyntaxError` into 400s. For any other client error, set `err.status` before throwing.
- Fire-and-forget promises need a `.catch()`. An unhandled rejection crashes the process.
- Assign `doc._id`, not a document, to ObjectId ref paths (e.g. `ping.check = check._id`). Mongoose otherwise stores it as populated, which changes `toJSON()` and `String(ping.check)`.
- Mounted apps get their mount path from `req.baseUrl`. `app.route` is a method in Express 5.
- Use the WHATWG `URL` API, not `url.parse()`. Node 26 emits a runtime deprecation warning for `url.parse()`.

## Commands

```sh
npm install
node app                      # webapp + analyzer + monitor (if autoStartMonitor: true), default http://localhost:8080
NODE_ENV=production node app
node monitor                  # standalone poller process (set autoStartMonitor: false for the webapp)
node models/migrations/upgrade2to3   # one-time migration from 1.x/2.x data
```

Tests need a running MongoDB (v4.4 or later). `.mocharc.yml` requires `test/setup.js`, which forces `NODE_ENV=test`, so every mocha run uses the `uptime-test` database from `config/test.yaml`:

```sh
npm test                                            # all suites
npx mocha test/unit/check.js                        # single file
npx mocha test/unit/check.js -g "should update object"   # single test
```

Suites live in `test/functional/` (REST API and the monitor end to end, through the full app), `test/lib/` (models and libraries, against MongoDB), `test/plugins/` and `test/unit/` (no database). Shared helpers are in `test/helpers.js`: `listen(handler)` starts a server on a random port, `request()` sends JSON with `fetch`, `clear(...models)` empties collections, and `eventually()` retries assertions on side effects that the code doesn't await. Tests never use fixed ports and never reach the network. `config/test.yaml` disables the monitor and the console plugin, and `test/setup.js` unsets `http_proxy`/`https_proxy`.

CI: `.github/workflows/test.yml` runs `npm test` against a `mongo:7` service on every branch push and pull request (MongoDB 8.0+ refuses to start on the runners' Linux 6.19+ kernel, see SERVER-121912). `.github/workflows/docker.yml` builds and pushes the image on `v*.*.*` tags, and calls `test.yml` first so the image is only published when the tests pass. Once the image is pushed, its `release` job creates the GitHub release for the tag. The notes come from the matching `CHANGELOG.md` section (`vX.Y.Z`, or `vX.Y` for a `.0` patch), and GitHub-generated notes are used when no section matches. A tag with a prerelease suffix such as `-beta.1` makes a prerelease.

To get sample data for the dashboard, see `fixtures/README.md`: run `node fixtures/populate.js`, then `node fixtures/computeStats.js`, then `node fixtures/dummyTarget.js`.

## Configuration

The app uses [node-config](https://github.com/lorenwest/node-config) with YAML. `config/default.yaml` is the base, and `config/<NODE_ENV>.yaml` overrides it. `config/development.yaml`, `config/runtime.json` and `plugins/index.js` are gitignored local files. Values in the YAML files can use `${VAR}`, `${VAR:-default}` and `$${VAR}` (a literal). `lib/yamlEnv.js` expands them after parsing with the `yaml` package, so that it knows which values were quoted: an unquoted value is retyped as YAML (number, boolean, null), and a quoted one stays a string. `lib/config.js` registers that parser with node-config and exports the config. Require `./lib/config` instead of `config`, because the parser must be registered before node-config first loads the files. The webapp listens on `server.host` and `server.port` (default `0.0.0.0:8080`), which the `HOST` and `PORT` env vars override. `url` is only the public address that users browse to: the email plugin uses it in links and `googleAuth` in its redirect URI. `session.secret` signs the session cookie (`SameSite=Lax`); when it's empty, `app.js` generates a random one on start.

## Architecture

The system runs as three cooperating pieces. They can share one process (`node app`) or run separately.

1. **Webapp** (`app.js`): the parent Express app. It mounts `app/api` at `/api` (JSON REST) and `app/dashboard` at `/dashboard` (EJS views via `express-partials`, plus static assets). It also wires socket.io: `CheckEvent` inserts are broadcast to all browsers. `Ping` inserts go only to the `check:<id>` room, which a page joins with the `set check` message. socket.io answers its own requests before Express, so Express middlewares don't apply to them: `app.js` runs the cookie session on the socket.io handshake with `io.engine.use(onlyForHandshake(session))` (`lib/onlyForHandshake.js`), and the authentication plugins add their check the same way.
2. **Monitor** (`monitor.js` → `lib/monitor.js`): never touches MongoDB or the models. It talks to the webapp only over HTTP at `config.monitor.apiUrl`:
   - `GET /checks/needingPoll` to find work
   - `PUT /check/:id/test` to claim a check
   - `POST /pings` to report results

   This split lets it run in another process, or in several datacenters with distinct `monitor.name` values.
3. **Analyzer** (`lib/analyzer.js`, started inside `app.js`): runs on timers. It calls `lib/qosAggregator.js` to roll pings up into `Check{Hourly,Daily,Monthly,Yearly}Stat` and `Tag*Stat` collections, and it prunes old pings and events (`pingHistory`).

**Data flow:** `POST /pings` → `Ping.createForCheck()` (`models/ping.js`) → `check.setLastTest()` (`models/check.js`). That method decides via `mustNotifyEvent()`/`alertTreshold` (sic) whether to create a `CheckEvent` (up/down). `createForCheck()` awaits that event save through `check.$locals.lastEventSave`. Notifications such as email, console and sockets all hang off `CheckEvent.on('afterInsert')`. `lib/intervalBuilder.js` rebuilds up/down/paused intervals from `CheckEvent`s for uptime reporting. It closes the interval still open at the end of the period, and clips the intervals, the downtime and the tested time to the time the targets were tested (from the earliest `firstTested` to the latest `lastTested`). A tag (several targets) is down while any of its checks is down, and paused only while all of them are. Daily and monthly stats store their `testedTime`, which the monthly and yearly availability is computed over (instead of the whole calendar period).

**Pollers** (`lib/pollers/`): each poller type is a class with a static `type` that extends `basePoller.js`. They are registered in `pollerCollection.js` (http, https, udp, webpagetest), and `check.type` selects one. A poller is constructed with `(target, timeout, callback)` and calls back `(err, time, res, details)`.

**Models** use the local `models/plugins/lifecycle.js` plugin, which replaces the unmaintained mongoose-lifecycle package. Every model emits `before/after` + `Insert/Update/Save/Remove` events on the Model class, and plugins and the webapp rely on these. Remove events fire on `doc.deleteOne()`.

`Check.needingPoll()` uses an `$expr` query that mirrors `Check.methods.needsPoll()`, because `$where` is deprecated since MongoDB 8. `test/lib/test_check.js` checks that both agree.

**Dashboard UI** uses Bootstrap 5.3 (CSS and the JS bundle) and Bootstrap Icons, vendored in `app/dashboard/public/vendor/`. Colors come from Bootstrap's theme variables (`var(--bs-...)`, `text-*-emphasis`, `*-bg-subtle`), never hard-coded values, so that the light and dark color modes (`javascripts/colorMode.js`) both work. `javascripts/ui.js` gives a Bootstrap tooltip to any element with `data-bs-toggle="tooltip"` (also when it's added later) and provides `showToast()`; the layout shows the `info` flash messages as toasts. The layout highlights the navbar item from `navSection`, and routes pass a `title`. The check and tag pages are built from the `_dateNavigation`, `_statCards` and section partials, and `DateInterval` calls a `refresh-stats` or `refresh-stat` listener added after the stats arrived right away.

`lib/flash.js` replaces connect-flash with the same `req.flash()` API. `lib/proxy.js` monkey-patches `http.request`/`get` and `https.request`/`get` when `http_proxy`/`https_proxy` is set.

## Plugins

Plugins are listed by path in `config.plugins` and loaded by `require()`. `app.js` calls `initWebApp({app, api, dashboard, io, config, mongoose})` and `monitor.js` calls `initMonitor({monitor, config})`. The extension points are emitter events:

- Parent `app`: `beforeFirstRoute`, `beforeApiRoutes`, `beforeDashboardRoutes`, `afterLastRoute`. The authentication plugins (`basicAuth`, `googleAuth`) add their middleware on `beforeFirstRoute`, and on the socket.io handshake through `io.engine.use()`. A plugin that sets `res.locals.user = { name, email, logoutUrl }` gets an account menu in the dashboard navbar.
- `dashboard` app: `populateFromDirtyCheck(checkDoc, dirtyCheck, type)` to validate and store per-check settings via `check.setPollerParam()`, and `checkEdit(type, check, partialsArray)` to inject form fields into the check edit view.
- `monitor`: `pollerCreated(poller, check, details)` to mutate the request before polling (`httpOptions`), and `pollerPolled(check, res, details)`, where throwing marks the ping as failed (`patternMatcher`). Plugins add options to the monitor's API calls with `monitor.addApiHttpOption()`, which merges `headers` instead of replacing them.

**API key** (`lib/apiKey.js`): the monitor sends `monitor.apiKey` as `Authorization: Bearer <apiKey>`, and the authentication plugins let in the requests that carry it with `apiKey.verifier(config)`. When the setting is empty, the first verifier generates a random key, which `monitor.js` passes to a monitor in the same process (`apiKey.forMonitor()`). A separate monitor then has no key: `basicAuth` sends its credentials instead, and `googleAuth` warns. Plugins read the key of the monitor they get from `monitor.config.apiKey`. Node.js ignores the `auth` http option when the `Authorization` header is set.

`googleAuth` talks to Google's OAuth endpoints with `fetch` and no extra dependency. Its `authorizationUrl` and `tokenUrl` settings exist so that `test/plugins/googleAuth.js` can use a local fake Google. The monitor can't log in with Google, so it relies on the API key.

Gotcha: the API routes (`app/api/routes/check.js`) emit `populateFromDirtyCheck` on the **api** app, but the bundled plugins only listen on `dashboard`. Plugin-specific poller params are therefore not processed for checks created or updated through the REST API.
