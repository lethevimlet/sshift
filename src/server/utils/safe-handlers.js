/**
 * Crash guards for event and route handlers.
 *
 * socket.io 4.7 runs listeners from process.nextTick and Express 4 does not
 * catch rejected promises, so a single malformed payload (`ssh-join` with no
 * data, a numeric password) used to throw out of the event loop and take the
 * whole server, and every SSH session in it, down. These wrappers log the
 * error and keep the process alive.
 */

function logHandlerError(where, err) {
  console.error(`[SAFE] Handler error in ${where}:`, err && err.stack ? err.stack : err);
}

/**
 * Make every listener registered with socket.on() exception-safe, including
 * async listeners. Must run before any handler is registered on the socket.
 */
function guardSocket(socket) {
  if (!socket || socket.__sshiftGuarded) return socket;
  socket.__sshiftGuarded = true;
  const origOn = socket.on.bind(socket);
  socket.on = (event, listener) => {
    if (typeof listener !== 'function') return origOn(event, listener);
    const wrapped = function (...args) {
      try {
        const result = listener.apply(this, args);
        if (result && typeof result.catch === 'function') {
          return result.catch((err) => logHandlerError(`socket event "${event}"`, err));
        }
        return result;
      } catch (err) {
        logHandlerError(`socket event "${event}"`, err);
        return undefined;
      }
    };
    return origOn(event, wrapped);
  };
  return socket;
}

/**
 * Make app.get/post/put/patch/delete route handlers forward thrown errors
 * and rejected promises to Express' error handling instead of crashing.
 */
function guardExpressApp(app) {
  if (!app || app.__sshiftGuarded) return app;
  app.__sshiftGuarded = true;
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    if (typeof app[method] !== 'function') continue;
    const orig = app[method].bind(app);
    app[method] = (routePath, ...handlers) => {
      // app.get('setting') is the settings getter, not a route.
      if (handlers.length === 0) return orig(routePath);
      const wrapped = handlers.map((h) => {
        if (typeof h !== 'function' || h.length >= 4) return h;
        return (req, res, next) => {
          try {
            const result = h(req, res, next);
            if (result && typeof result.catch === 'function') return result.catch(next);
            return result;
          } catch (err) {
            return next(err);
          }
        };
      });
      return orig(routePath, ...wrapped);
    };
  }
  return app;
}

function expressErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  logHandlerError(`${req.method} ${req.path}`, err);
  if (res.headersSent) return;
  res.status(err && err.type === 'entity.parse.failed' ? 400 : 500)
    .json({ error: err && err.type === 'entity.parse.failed' ? 'Invalid JSON' : 'Internal server error' });
}

module.exports = { guardSocket, guardExpressApp, expressErrorHandler, logHandlerError };
