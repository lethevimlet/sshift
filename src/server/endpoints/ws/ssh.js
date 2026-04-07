/**
 * SSH WebSocket handlers
 */

const { loadConfig, getStickySetting } = require('../../utils/config');
const { addTab, getTab, addSocketToTab, removeSocketFromTab, removeTab, getTabOrder, setCloseTimer, clearCloseTimer, getCloseTimer } = require('../../utils/tab-manager');
const { sshManager } = require('../../services');

/**
 * Register SSH WebSocket handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function registerSSHHandlers(socket, io) {
  // SSH connection
  socket.on('ssh-connect', async (data) => {
    console.log('[SSH] ssh-connect event received:', JSON.stringify({
      sessionId: data.sessionId,
      host: data.host,
      port: data.port,
      username: data.username,
      hasPassword: !!data.password,
      hasPrivateKey: !!data.privateKey
    }));
    
    try {
      // Get SSH keepalive settings from config
      const config = loadConfig();
      const sshKeepaliveInterval = config.sshKeepaliveInterval || 10000;
      const sshKeepaliveCountMax = config.sshKeepaliveCountMax || 1000;
      
      // Pass keepalive settings to SSH manager
      const connectionData = {
        ...data,
        sshKeepaliveInterval,
        sshKeepaliveCountMax
      };
      
      const sessionId = await sshManager.connect(socket, connectionData);
      console.log('[SSH] Connection successful, emitting ssh-connected for:', sessionId);
      
      // Get sticky from config
      const sticky = getStickySetting();
      
      // Track this tab
      addTab(sessionId, {
        name: data.name || 'SSH',
        type: 'ssh',
        connectionData: data,
        activeSockets: new Set([socket.id]),
        sticky: sticky
      });
      
      // Broadcast to all clients that a new tab was opened
      io.emit('tab-opened', {
        sessionId,
        name: data.name || 'SSH',
        type: 'ssh',
        connectionData: data
      });
      
      socket.emit('ssh-connected', { sessionId });
    } catch (err) {
      console.error('[SSH] Connection failed:', err.message);
      socket.emit('ssh-error', { message: err.message, sessionId: data.sessionId });
    }
  });

  // SSH join existing session
  socket.on('ssh-join', (data) => {
    console.log('[SSH] ssh-join event received for session:', data.sessionId);
    const success = sshManager.joinSession(socket, data.sessionId);
    if (success) {
      // Add this socket to the tab's active sockets
      addSocketToTab(data.sessionId, socket.id);
      // Note: ssh-joined is emitted by joinSession() with noTerminalState flag
    } else {
      socket.emit('ssh-error', { message: 'Session not found', sessionId: data.sessionId });
    }
  });

  // SSH request screen sync (for manual refresh or reconnection)
  socket.on('ssh-request-sync', (data) => {
    console.log('[SSH] ssh-request-sync event received for session:', data.sessionId);
    const state = sshManager.getTerminalState(data.sessionId);
    if (state) {
      socket.emit('ssh-screen-sync', {
        sessionId: data.sessionId,
        state: state.state,
        cols: state.cols,
        rows: state.rows
      });
    } else {
      socket.emit('ssh-error', { message: 'Session not found', sessionId: data.sessionId });
    }
  });

  // SSH data (user input)
  socket.on('ssh-data', (data) => {
    // Only allow input from the controller
    if (!sshManager.isController(socket.id, data.sessionId)) {
      console.log(`[SSH] Ignoring input from non-controller socket ${socket.id}`);
      return;
    }
    sshManager.write(data.sessionId, data.data);
  });

  // SSH take control
  socket.on('ssh-take-control', (data) => {
    console.log(`[SSH] Socket ${socket.id} requesting control of session ${data.sessionId}`);
    const result = sshManager.takeControl(socket, data.sessionId);
    
    if (result.success) {
      // Send success response to the requesting client with terminal dimensions
      socket.emit('ssh-control-acquired', {
        sessionId: data.sessionId,
        cols: result.cols,
        rows: result.rows
      });
    } else {
      socket.emit('ssh-error', { 
        sessionId: data.sessionId, 
        message: result.error || 'Failed to take control' 
      });
    }
  });

  // SSH release control
  socket.on('ssh-release-control', (data) => {
    console.log(`[SSH] Socket ${socket.id} releasing control of session ${data.sessionId}`);
    sshManager.releaseControl(socket, data.sessionId);
  });

  // SSH resize
  socket.on('ssh-resize', (data) => {
    // Only allow resize from the controller
    if (!sshManager.isController(socket.id, data.sessionId)) {
      console.log(`[SSH] Ignoring resize from non-controller socket ${socket.id}`);
      return;
    }
    sshManager.resize(data.sessionId, data.cols, data.rows);
    
    // Broadcast resize to all other clients in the session
    // This ensures all clients stay in sync with the server terminal size
    socket.to(`session-${data.sessionId}`).emit('ssh-resize-sync', {
      sessionId: data.sessionId,
      cols: data.cols,
      rows: data.rows
    });
  });

  // SSH disconnect
  socket.on('ssh-disconnect', (data) => {
    sshManager.disconnect(data.sessionId);
    
    // Remove from open tabs and order
    removeTab(data.sessionId);
    
    // Broadcast to all clients that tab was closed
    io.emit('tab-closed', { sessionId: data.sessionId });
  });
}

/**
 * Handle SSH session cleanup on socket disconnect
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function handleSSHDisconnect(socket, io) {
  // Remove this socket from all SSH sessions
  const openTabs = require('../../utils/tab-manager').getOpenTabs();
  for (const [sessionId, tab] of openTabs) {
    if (tab.type === 'ssh') {
      removeSocketFromTab(sessionId, socket.id);
      sshManager.leaveSession(socket, sessionId);
    }
  };
}

module.exports = { registerSSHHandlers, handleSSHDisconnect };