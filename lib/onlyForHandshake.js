/**
 * Run an express-style middleware on the socket.io handshake only.
 *
 * socket.io answers its own HTTP requests before express sees them, so the express
 * middlewares (session, authentication) don't apply to them. Give them to socket.io with:
 *
 *     io.engine.use(onlyForHandshake(middleware));
 *
 * The handshake is the first request of a connection. The later requests carry the
 * session id (sid) that the server returned for an accepted handshake, so they skip the middleware.
 * On a WebSocket handshake, `res` only implements `setHeader()` and `end()`, which closes the socket.
 */
module.exports = function onlyForHandshake(middleware) {
  return function(req, res, next) {
    if (req._query.sid !== undefined) return next();
    middleware(req, res, next);
  };
};
