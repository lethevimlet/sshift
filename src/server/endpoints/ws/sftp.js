/**
 * SFTP WebSocket handlers
 */

const { loadConfig, getStickySetting } = require('../../utils/config');
const { wasRecentlyClosed, addTab, getTab, removeTab, addSocketToTab, removeSocketFromTab, clearCloseTimer, setCloseTimer } = require('../../utils/tab-manager');
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
        // The socket may have gone away during the (up to 30 s) connect.
        activeSockets: new Set(socket.connected ? [socket.id] : []),
        sticky: sticky
      });
      
      socket.broadcast.emit('tab-opened', {
        sessionId,
        name: data.name || 'SFTP',
        type: 'sftp',
        // Never broadcast secrets (password, key, passphrase) to other
        // browsers; they join the running session by id.
        connectionData: {
          host: data.host,
          port: data.port,
          username: data.username,
          name: data.name
        }
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
      socket.emit('sftp-error', { message: 'Session not found', sessionId: data.sessionId, closed: wasRecentlyClosed(data.sessionId) });
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
  const activeDownloads = new Map(); // `${sessionId}\0${path}` -> read stream
  socket.on('disconnect', () => {
    for (const stream of activeDownloads.values()) {
      try { stream.destroy(); } catch (_) {}
    }
    activeDownloads.clear();
  });
  socket.on('sftp-download-cancel', (data) => {
    if (!data) return;
    const key = `${data.sessionId}\0${data.path}`;
    const stream = activeDownloads.get(key);
    if (stream) {
      activeDownloads.delete(key);
      try { stream.destroy(); } catch (_) {}
    }
  });
  socket.on('sftp-download', async (data) => {
    try {
      const { sessionId, path } = data;
      const stats = await sftpManager.stat(sessionId, path);

      if (stats.isDirectory()) {
        socket.emit('sftp-error', { message: 'Cannot download a directory', sessionId, path, download: true });
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
      // Backpressure: at most this many chunks queued for the browser.
      // Without it a multi-GB file was read as fast as SSH delivers and
      // piled up base64 chunks in memory for a slow (mobile) client.
      const MAX_QUEUED_PACKETS = 4;
      let buffer = Buffer.alloc(0);
      let bytesDownloaded = 0;

      // One download per (session, path) per socket; cancel and
      // disconnect stop reading from the remote server.
      const key = `${sessionId}\0${path}`;
      const previous = activeDownloads.get(key);
      if (previous) previous.destroy();
      activeDownloads.set(key, stream);
      const finish = () => {
        if (activeDownloads.get(key) === stream) activeDownloads.delete(key);
        if (socket.conn) socket.conn.off('drain', onDrain);
      };
      const onDrain = () => {
        if (stream.isPaused && stream.isPaused()) stream.resume();
      };
      if (socket.conn) socket.conn.on('drain', onDrain);

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
          const queued = socket.conn && socket.conn.writeBuffer ? socket.conn.writeBuffer.length : 0;
          if (queued >= MAX_QUEUED_PACKETS) stream.pause();
        }
      });
      stream.on('close', finish);

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
        finish();
        socket.emit('sftp-error', { message: `Download failed: ${err.message}`, sessionId, path, download: true });
      });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP upload (chunked)
  socket.on('sftp-upload-start', async (data, callback) => {
    if (typeof callback !== 'function') callback = () => {};
    data = data || {};
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
    if (typeof callback !== 'function') callback = () => {};
    data = data || {};
    try {
      const result = await sftpManager.uploadChunk(data.uploadId, data.data);
      callback(result);
    } catch (err) {
      callback({ error: err.message });
    }
  });

  socket.on('sftp-upload-end', async (data, callback) => {
    if (typeof callback !== 'function') callback = () => {};
    data = data || {};
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
  // With an ack callback the result (or error) goes only to the ack, so
  // the requester can match it; without one (older pages) the broadcast
  // result/error events are used as before.
  socket.on('sftp-delete', async (data, ack) => {
    try {
      await sftpManager.delete(data.sessionId, data.path);
      if (typeof ack === 'function') return ack({ success: true, path: data.path });
      socket.emit('sftp-delete-result', { path: data.path, success: true });
    } catch (err) {
      if (typeof ack === 'function') return ack({ success: false, error: err.message });
      socket.emit('sftp-error', { message: err.message, sessionId: data.sessionId });
    }
  });

  // SFTP rename
  socket.on('sftp-rename', async (data, ack) => {
    try {
      await sftpManager.rename(data.sessionId, data.oldPath, data.newPath);
      if (typeof ack === 'function') return ack({ success: true, oldPath: data.oldPath, newPath: data.newPath });
      socket.emit('sftp-rename-result', { 
        oldPath: data.oldPath, 
        newPath: data.newPath, 
        success: true 
      });
    } catch (err) {
      if (typeof ack === 'function') return ack({ success: false, error: err.message });
      socket.emit('sftp-error', { message: err.message, sessionId: data.sessionId });
    }
  });

  // SFTP disconnect — mirror the ssh-disconnect viewer/sticky-aware teardown
  // so the closing client's view is removed without tearing down the
  // underlying SFTP stream for other viewers or non-sticky-none-viewers.
  socket.on('sftp-disconnect', (data) => {
    console.log('[SFTP] sftp-disconnect event received for', data.sessionId, 'from socket', socket.id);

    const tab = getTab(data.sessionId);
    if (tab) {
      removeSocketFromTab(data.sessionId, socket.id);

      if (tab.activeSockets.size > 0) {
        console.log('[SFTP] sftp-disconnect from', socket.id, 'but', tab.activeSockets.size, 'viewer(s) remain; keeping:', data.sessionId);
        io.emit('sessions-updated');
        return;
      }

      // No remaining viewers. Honor sticky flag (same semantics as ssh).
      clearCloseTimer(data.sessionId);
      if (tab.sticky) {
        console.log('[SFTP] Sticky session remains open on server (no viewers):', data.sessionId);
        io.emit('sessions-updated');
        return;
      }

      console.log('[SFTP] Non-sticky session, scheduling close after grace:', data.sessionId);
      const gracePeriod = 5000;
      setCloseTimer(data.sessionId, setTimeout(() => {
        const currentTab = getTab(data.sessionId);
        if (currentTab && currentTab.activeSockets.size === 0) {
          console.log('[SFTP] Grace expired, closing session:', data.sessionId);
          sftpManager.disconnect(data.sessionId);
          removeTab(data.sessionId);
          io.emit('tab-closed', { sessionId: data.sessionId });
          io.emit('sessions-updated');
        } else {
          console.log('[SFTP] Session has new sockets, canceling close:', data.sessionId);
        }
      }, gracePeriod));
      return;
    }

    // No tab record — broadcast close so stale client UIs clear it.
    sftpManager.disconnect(data.sessionId);
    removeTab(data.sessionId);
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