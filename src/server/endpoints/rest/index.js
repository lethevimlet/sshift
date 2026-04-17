/**
 * REST endpoints module index
 * Re-exports all REST endpoint modules
 */

const { registerBookmarkEndpoints } = require('./bookmarks');
const { registerConfigEndpoints } = require('./config');
const { registerFolderEndpoints } = require('./folders');
const { registerSessionsEndpoints } = require('./sessions');
const { registerSystemEndpoints } = require('./system');
const { registerUtilsEndpoints } = require('./utils');
const { registerAuthEndpoints, isValidAuthToken } = require('./auth');

function registerAllRestEndpoints(app, io) {
  registerAuthEndpoints(app, io);
  registerBookmarkEndpoints(app, io);
  registerConfigEndpoints(app, io);
  registerFolderEndpoints(app, io);
  registerSessionsEndpoints(app, io);
  registerSystemEndpoints(app, io);
  registerUtilsEndpoints(app, io);
}

module.exports = {
  registerBookmarkEndpoints,
  registerConfigEndpoints,
  registerFolderEndpoints,
  registerSessionsEndpoints,
  registerSystemEndpoints,
  registerUtilsEndpoints,
  registerAuthEndpoints,
  isValidAuthToken,
  registerAllRestEndpoints
};