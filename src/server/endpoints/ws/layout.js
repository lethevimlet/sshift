/**
 * Layout management WebSocket handlers
 *
 * The layout-change broadcast handler was removed: the preferred layout
 * is a per-device preference stored in each browser's localStorage (it
 * survives server restarts and can differ between devices). Only the
 * per-tab panel ASSIGNMENTS are still synced (see tabs.js tabs-save).
 */
let currentLayout = 'default';

/**
 * Get current layout
 * @returns {string} Current layout ID
 */
function getCurrentLayout() {
  return currentLayout;
}

/**
 * Set current layout
 * @param {string} layoutId - Layout ID
 */
function setCurrentLayout(layoutId) {
  currentLayout = layoutId;
}

/**
 * Register layout WebSocket handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function registerLayoutHandlers(socket, io) {
  // No handlers: layout preference is per-device (client localStorage).
}

module.exports = { 
  registerLayoutHandlers, 
  getCurrentLayout, 
  setCurrentLayout 
};