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
      
      io.emit('tab-opened', {
        sessionId,
        name: data.name || 'SFTP',
        type: 'sftp',
        connectionData: data
      });
      
      io.emit('sessions-updated');
      
      socket.emit('sftp-connected', { sessionId });
    } catch (err) {
      console.error('[SFTP] Error in sftp-connect:', err.message);
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP join existing session
  socket.on('sftp-join', (data) => {
    console.log('[SFTP] sftp-join event received for session:', data.sessionId);
    const success = sftpManager.joinSession(socket, data.sessionId);
    if (success) {
      // Add this socket to the tab's active sockets
      addSocketToTab(data.sessionId, socket.id);
      socket.emit('sftp-joined', { sessionId: data.sessionId });
    } else {
      socket.emit('sftp-error', { message: 'Session not found', sessionId: data.sessionId });
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
      console.error('[SFTP] Error in sftp-list:', err.message, 'code:', err.code);

      const homeDir = sftpManager.home(data.sessionId);
      const isPermissionDenied = err.code === 3
        || (err.message && (
          err.message.includes('Permission denied')
          || err.message.includes('permission denied')
          || err.message.includes('EACCES')
        ));

      // If listing "/" fails with permission denied and we know the home
      // directory, try falling back to it automatically.  This handles the
      // common case of chrooted SFTP servers that restrict root access.
      if (isPermissionDenied && homeDir && data.path === '/') {
        console.log('[SFTP] Permission denied on /, falling back to home directory:', homeDir);
        try {
          const homeFiles = await sftpManager.list(data.sessionId, homeDir);
          socket.emit('sftp-list-result', {
            path: homeDir,
            files: homeFiles,
            sessionId: data.sessionId,
            redirectedFrom: '/',
            homeDir
          });
          return;
        } catch (homeErr) {
          console.error('[SFTP] Home directory also failed:', homeErr.message);
          socket.emit('sftp-error', {
            message: homeErr.message,
            sessionId: data.sessionId,
            homeDir
          });
          return;
        }
      }

      socket.emit('sftp-error', {
        message: err.message,
        sessionId: data.sessionId,
        homeDir,
        isPermissionDenied
      });
    }
  });

  // SFTP get home directory
  socket.on('sftp-home', (data) => {
    const homeDir = sftpManager.home(data.sessionId);
    socket.emit('sftp-home-result', {
      sessionId: data.sessionId,
      homeDir
    });
  });

  // SFTP download (streamed)
  socket.on('sftp-download', async (data) => {
    try {
      const { sessionId, path } = data;
      const stats = await sftpManager.stat(sessionId, path);

      if (stats.isDirectory()) {
        socket.emit('sftp-error', { message: 'Cannot download a directory' });
        return;
      }

      const fileName = path.split('/').pop();

      socket.emit('sftp-download-start', {
        sessionId,
        path,
        fileName,
        size: stats.size
      });

      const stream = sftpManager.getReadStream(sessionId, path);
      const FLUSH_SIZE = 1024 * 1024;
      let buffer = Buffer.alloc(0);
      let bytesDownloaded = 0;

      stream.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        bytesDownloaded += chunk.length;

        if (buffer.length >= FLUSH_SIZE) {
          socket.emit('sftp-download-chunk', {
            sessionId,
            path,
            data: buffer.toString('base64'),
            bytesDownloaded,
            totalBytes: stats.size
          });
          buffer = Buffer.alloc(0);
        }
      });

      stream.on('end', () => {
        if (buffer.length > 0) {
          socket.emit('sftp-download-chunk', {
            sessionId,
            path,
            data: buffer.toString('base64'),
            bytesDownloaded,
            totalBytes: stats.size
          });
        }
        socket.emit('sftp-download-end', {
          sessionId,
          path,
          fileName,
          success: true
        });
      });

      stream.on('error', (err) => {
        socket.emit('sftp-error', { message: `Download failed: ${err.message}` });
      });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP upload (chunked)
  socket.on('sftp-upload-start', async (data, callback) => {
    try {
      const uploadId = sftpManager.uploadStart(
        data.sessionId,
        data.path,
        data.fileName,
        data.fileSize
      );
      callback({ uploadId });
    } catch (err) {
      callback({ error: err.message });
    }
  });

  socket.on('sftp-upload-chunk', async (data, callback) => {
    try {
      const result = await sftpManager.uploadChunk(data.uploadId, data.data);
      callback(result);
    } catch (err) {
      callback({ error: err.message });
    }
  });

  socket.on('sftp-upload-end', async (data, callback) => {
    try {
      const result = await sftpManager.uploadEnd(data.uploadId);
      callback(result);
    } catch (err) {
      callback({ error: err.message });
    }
  });

  // SFTP upload cancel
  socket.on('sftp-upload-cancel', (data) => {
    sftpManager.uploadCancel(data.uploadId);
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
    io.emit('sessions-updated');
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