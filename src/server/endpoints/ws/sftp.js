/**
 * SFTP WebSocket handlers
 */

const { loadConfig, getStickySetting } = require('../../utils/config');
const { addTab, removeTab, addSocketToTab, removeSocketFromTab } = require('../../utils/tab-manager');
const { sftpManager } = require('../../services');

/**
 * Register SFTP WebSocket handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function registerSFTPHandlers(socket, io) {
  // SFTP connection
  socket.on('sftp-connect', async (data) => {
    try {
      console.log('[SFTP] Received sftp-connect with sessionId:', data.sessionId);
      
      // Get SSH keepalive settings from config
      const config = loadConfig();
      const sshKeepaliveInterval = config.sshKeepaliveInterval || 10000;
      const sshKeepaliveCountMax = config.sshKeepaliveCountMax || 1000;
      
      // Pass keepalive settings to SFTP manager
      const connectionData = {
        ...data,
        sshKeepaliveInterval,
        sshKeepaliveCountMax
      };
      
      const sessionId = await sftpManager.connect(socket, connectionData);
      console.log('[SFTP] Emitting sftp-connected with sessionId:', sessionId);
      
      // Get sticky from config
      const sticky = getStickySetting();
      
      // Track this tab
      addTab(sessionId, {
        name: data.name || 'SFTP',
        type: 'sftp',
        connectionData: data,
        activeSockets: new Set([socket.id]),
        sticky: sticky
      });
      
      // Broadcast to all clients that a new tab was opened
      io.emit('tab-opened', {
        sessionId,
        name: data.name || 'SFTP',
        type: 'sftp',
        connectionData: data
      });
      
      socket.emit('sftp-connected', { sessionId });
    } catch (err) {
      console.error('[SFTP] Error in sftp-connect:', err.message);
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP list directory
  socket.on('sftp-list', async (data) => {
    try {
      console.log('[SFTP] Received sftp-list for sessionId:', data.sessionId, 'path:', data.path);
      const files = await sftpManager.list(data.sessionId, data.path);
      console.log('[SFTP] Emitting sftp-list-result for sessionId:', data.sessionId, 'files:', files.length);
      socket.emit('sftp-list-result', { path: data.path, files, sessionId: data.sessionId });
    } catch (err) {
      console.error('[SFTP] Error in sftp-list:', err.message);
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP download
  socket.on('sftp-download', async (data) => {
    try {
      const fileData = await sftpManager.download(data.sessionId, data.path);
      socket.emit('sftp-download-result', { path: data.path, data: fileData.toString('base64') });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP upload
  socket.on('sftp-upload', async (data) => {
    try {
      await sftpManager.upload(data.sessionId, data.path, Buffer.from(data.data, 'base64'));
      socket.emit('sftp-upload-result', { path: data.path, success: true });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP mkdir
  socket.on('sftp-mkdir', async (data) => {
    try {
      await sftpManager.mkdir(data.sessionId, data.path);
      socket.emit('sftp-mkdir-result', { path: data.path, success: true });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP delete
  socket.on('sftp-delete', async (data) => {
    try {
      await sftpManager.delete(data.sessionId, data.path);
      socket.emit('sftp-delete-result', { path: data.path, success: true });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP rename
  socket.on('sftp-rename', async (data) => {
    try {
      await sftpManager.rename(data.sessionId, data.oldPath, data.newPath);
      socket.emit('sftp-rename-result', { 
        oldPath: data.oldPath, 
        newPath: data.newPath, 
        success: true 
      });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP disconnect
  socket.on('sftp-disconnect', (data) => {
    sftpManager.disconnect(data.sessionId);
    
    // Remove from open tabs
    removeTab(data.sessionId);
    
    // Broadcast to all clients that tab was closed
    io.emit('tab-closed', { sessionId: data.sessionId });
  });
}

/**
 * Handle SFTP session cleanup on socket disconnect
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function handleSFTPDisconnect(socket, io) {
  // Remove this socket from all SFTP sessions
  const openTabs = require('../../utils/tab-manager').getOpenTabs();
  for (const [sessionId, tab] of openTabs) {
    if (tab.type === 'sftp') {
      removeSocketFromTab(sessionId, socket.id);
    }
  };
}

module.exports = { registerSFTPHandlers, handleSFTPDisconnect };