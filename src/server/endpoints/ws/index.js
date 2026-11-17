/**
 * WebSocket endpoints module index
 * Re-exports all WebSocket endpoint modules
 */

const { registerSSHHandlers, handleSSHDisconnect } = require('./ssh');
const { registerSFTPHandlers, handleSFTPDisconnect } = require('./sftp');
const { registerTabHandlers, handleTabDisconnect } = require('./tabs');
const { registerLayoutHandlers, getCurrentLayout, setCurrentLayout } = require('./layout');
const { registerBookmarkHandlers } = require('./bookmarks');

/**
 * Register all WebSocket handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function registerAllWSHandlers(socket, io) {
  registerSSHHandlers(socket, io);
  registerSFTPHandlers(socket, io);
  registerTabHandlers(socket, io);
  registerLayoutHandlers(socket, io);
  registerBookmarkHandlers(socket, io);
  // Liveness probe: after a laptop sleep or a network change the browser
  // can hold a dead socket that still reports "connected" for over a
  // minute. The client asks for an ack and reconnects when none arrives.
  socket.on('sshift-ping', (ack) => {
    if (typeof ack === 'function') ack({ t: Date.now() });
  });
}

/**
 * Handle socket disconnect for all handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function handleDisconnect(socket, io) {
  handleSSHDisconnect(socket, io);
  handleSFTPDisconnect(socket, io);
  handleTabDisconnect(socket, io);
}

module.exports = {
  registerSSHHandlers,
  handleSSHDisconnect,
  registerSFTPHandlers,
  handleSFTPDisconnect,
  registerTabHandlers,
  handleTabDisconnect,
  registerLayoutHandlers,
  getCurrentLayout,
  setCurrentLayout,
  registerAllWSHandlers,
  handleDisconnect
};
