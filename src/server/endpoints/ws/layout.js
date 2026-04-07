/**
 * Layout management WebSocket handlers
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
  // Layout change - sync across all sessions
  socket.on('layout-change', (data) => {
    console.log('[LAYOUT] Layout change:', data.layoutId);
    currentLayout = data.layoutId;
    
    // Broadcast to all other clients
    socket.broadcast.emit('layout-changed', { layoutId: data.layoutId });
  });
}

module.exports = { 
  registerLayoutHandlers, 
  getCurrentLayout, 
  setCurrentLayout 
};