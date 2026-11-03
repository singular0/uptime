/**
 * Shared test helpers. Not a test file: mocha only loads the files in the subdirectories of test/.
 */
const http = require('http');

/**
 * Remove all the documents of the given models.
 */
exports.clear = function(...models) {
  return Promise.all(models.map(function(model) { return model.collection.deleteMany({}); }));
};

/**
 * Start an HTTP server on a random local port.
 *
 * @param {Function} handler an express app or a request listener
 * @return {Promise<http.Server>} the server, with a `url` property (e.g. 'http://127.0.0.1:12345')
 */
exports.listen = function(handler) {
  const server = http.createServer(handler);
  return new Promise(function(resolve, reject) {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', function() {
      server.url = 'http://127.0.0.1:' + server.address().port;
      resolve(server);
    });
  });
};

/**
 * Stop a server started by listen(), including its keep-alive connections.
 */
exports.close = function(server) {
  return new Promise(function(resolve) {
    server.close(resolve);
    server.closeAllConnections();
  });
};

/**
 * Send a JSON request.
 *
 * @return {Promise<Object>} { status, headers, body }, the body being parsed when it is JSON
 */
exports.request = async function(url, method, body) {
  const options = { method: method || 'GET', headers: { Accept: 'application/json' }, redirect: 'manual' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const text = await res.text();
  let parsed = text;
  if ((res.headers.get('content-type') || '').includes('json')) {
    parsed = JSON.parse(text);
  }
  return { status: res.status, headers: res.headers, body: parsed };
};

/**
 * Retry an assertion until it passes, for side effects that the code doesn't await
 * (e.g. the CheckEvent saved by GET /checks/:id/pause).
 */
exports.eventually = async function(assertion, timeout) {
  const deadline = Date.now() + (timeout || 1000);
  for (;;) {
    try {
      return await assertion();
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise(function(resolve) { setTimeout(resolve, 10); });
    }
  }
};
