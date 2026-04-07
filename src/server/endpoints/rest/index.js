/**
 * REST endpoints module index
 * Re-exports all REST endpoint modules
 */

const { registerBookmarkEndpoints } = require('./bookmarks');
const { registerConfigEndpoints } = require('./config');
const { registerFolderEndpoints } = require('./folders');
const { registerSessionsEndpoints } = require('./sessions');
const { registerSystemEndpoints } = require('./system');

/**
 * Register all REST endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerAllRestEndpoints(app, io) {
  registerBookmarkEndpoints(app, io);
  registerConfigEndpoints(app, io);
  registerFolderEndpoints(app, io);
  registerSessionsEndpoints(app, io);
  registerSystemEndpoints(app, io);
}

module.exports = {
  registerBookmarkEndpoints,
  registerConfigEndpoints,
  registerFolderEndpoints,
  registerSessionsEndpoints,
  registerSystemEndpoints,
  registerAllRestEndpoints
};