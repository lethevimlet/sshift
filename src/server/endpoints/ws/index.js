/**
 * WebSocket endpoints module index
 * Re-exports all WebSocket endpoint modules
 */

const { registerSSHHandlers, handleSSHDisconnect } = require('./ssh');
const { registerSFTPHandlers, handleSFTPDisconnect } = require('./sftp');
const { registerTabHandlers, handleTabDisconnect } = require('./tabs');
const { registerLayoutHandlers, getCurrentLayout, setCurrentLayout } = require('./layout');

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