/**
 * SSH WebSocket handlers
 */

const { loadConfig, getStickySetting, getScrollback } = require('../../utils/config');
const { addTab, getTab, addSocketToTab, removeSocketFromTab, removeTab, getTabOrder, setCloseTimer, clearCloseTimer, getCloseTimer } = require('../../utils/tab-manager');
const { sshManager } = require('../../services');

// Per-session rate limiting for ssh-request-sync. A non-controller could
// otherwise trigger a 1MB serialization + base64 + emit on every
// keystroke, easily saturating the server's main thread and bandwidth.
// Allow at most one request per session every 2 seconds.
const _syncLastSent = new Map(); // sessionId -> last sync emit timestamp (ms)
const SYNC_RATE_LIMIT_MS = 2000;

// Acceptable client-supplied terminal dimensions. Guards against
// malformed clients passing 0 or huge values that would crash the
// headless xterm.js terminal.resize() or the remote PTY.
const MIN_DIM = 1;
const MAX_COLS = 400;
const MAX_ROWS = 200;

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
      const scrollback = getScrollback();
      
      // Pass keepalive and scrollback settings to SSH manager
      const connectionData = {
        ...data,
        sshKeepaliveInterval,
        sshKeepaliveCountMax,
        scrollback
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
      
      // Use socket.broadcast.emit so the originator doesn't receive its own
      // tab-opened echo. The originator already created the tab locally via
      // createSSHTab, so relying on a client-side guard was fragile.
      socket.broadcast.emit('tab-opened', {
        sessionId,
        name: data.name || 'SSH',
        type: 'ssh',
        connectionData: data
      });

      io.emit('sessions-updated');
      
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

    // Rate-limit per session to prevent abuse / accidental DoS.
    // NOTE: this emits an `ssh-error` with `advisory: true` so the
    // client's ssh-error handler can distinguish a soft advisory from
    // a hard connection failure (which would warrant closing the tab).
    // Without the `advisory: true` flag, the client would
    // `closeTab()` on every rate-limited sync — killing the very tab
    // the user was trying to refresh.
    const now = Date.now();
    const last = _syncLastSent.get(data.sessionId) || 0;
    if ((now - last) < SYNC_RATE_LIMIT_MS) {
      socket.emit('ssh-error', {
        sessionId: data.sessionId,
        message: 'Sync rate limit reached, please wait',
        advisory: true
      });
      return;
    }
    _syncLastSent.set(data.sessionId, now);

    const state = sshManager.getTerminalState(data.sessionId);
    if (state) {
      // Base64 encode to avoid Socket.IO binary detection issues
      const base64State = Buffer.from(state.state, 'utf-8').toString('base64');
      socket.emit('ssh-screen-sync', {
        sessionId: data.sessionId,
        state: base64State,
        cols: state.cols,
        rows: state.rows,
        encoded: true,
        partial: false
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
    // Validate payload type — a non-string `data.data` would throw deep
    // inside the ssh2 stream.write and crash the socket handler.
    if (typeof data.data !== 'string') {
      console.warn(`[SSH] ssh-data: invalid payload type from socket ${socket.id}`);
      socket.emit('ssh-error', {
        sessionId: data.sessionId,
        message: 'Invalid input payload',
        advisory: true
      });
      return;
    }
    try {
      sshManager.write(data.sessionId, data.data);
    } catch (err) {
      console.error(`[SSH] ssh-data: write failed for ${data.sessionId}:`, err.message);
      socket.emit('ssh-error', {
        sessionId: data.sessionId,
        message: 'Failed to write input: ' + err.message,
        advisory: true
      });
    }
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
    // Validate dimensions. cols=0/rows=0 (or NaN, negative, huge) would
    // crash headless terminal.resize() inside the SSH manager.
    const cols = Number(data.cols);
    const rows = Number(data.rows);
    if (!Number.isFinite(cols) || !Number.isFinite(rows) ||
        cols < MIN_DIM || rows < MIN_DIM ||
        cols > MAX_COLS || rows > MAX_ROWS) {
      console.warn(`[SSH] ssh-resize: invalid dimensions (${data.cols}x${data.rows}) from socket ${socket.id}`);
      socket.emit('ssh-error', {
        sessionId: data.sessionId,
        message: `Invalid terminal dimensions: ${data.cols}x${data.rows}`,
        advisory: true
      });
      return;
    }
    try {
      sshManager.resize(data.sessionId, cols, rows);
    } catch (err) {
      console.error(`[SSH] ssh-resize: resize failed for ${data.sessionId}:`, err.message);
      socket.emit('ssh-error', {
        sessionId: data.sessionId,
        message: 'Failed to resize: ' + err.message,
        advisory: true
      });
      return;
    }

    // Broadcast resize to all other clients in the session
    // This ensures all clients stay in sync with the server terminal size
    socket.to(`session-${data.sessionId}`).emit('ssh-resize-sync', {
      sessionId: data.sessionId,
      cols,
      rows
    });
  });

  // SSH disconnect — historically meant "I'm done with this session locally".
  // Treat it identically to tab-close: viewer-aware + sticky-aware teardown.
  // Only destroy the underlying SSH stream when no other clients remain AND
  // the session is non-sticky. This lets the orchestrator close their view
  // without yanking the session out from under sticky observers (or shedding
  // a session the user wants to rejoin from the Sessions modal).
  socket.on('ssh-disconnect', (data) => {
    console.log('[SSH] ssh-disconnect event received for', data.sessionId, 'from socket', socket.id);

    // Remove this socket from the SSH session room and reassign control if needed.
    sshManager.leaveSession(socket, data.sessionId);

    // Also remove from the tab's active-socket set so viewer counting
    // reflects reality.
    const tab = getTab(data.sessionId);
    if (tab) {
      removeSocketFromTab(data.sessionId, socket.id);

      if (tab.activeSockets.size > 0) {
        // Other viewers still active — keep the session alive for them.
        console.log('[SSH] ssh-disconnect from', socket.id, 'but', tab.activeSockets.size, 'viewer(s) remain; keeping:', data.sessionId);
        io.emit('sessions-updated');
        return;
      }

      // No remaining viewers. Honor sticky flag.
      clearCloseTimer(data.sessionId);
      if (tab.sticky) {
        console.log('[SSH] Sticky session remains open on server (no viewers):', data.sessionId);
        io.emit('sessions-updated');
        return;
      }

      console.log('[SSH] Non-sticky session, scheduling close after grace:', data.sessionId);
      const gracePeriod = 5000;
      setCloseTimer(data.sessionId, setTimeout(() => {
        const currentTab = getTab(data.sessionId);
        if (currentTab && currentTab.activeSockets.size === 0) {
          console.log('[SSH] Grace expired, closing session:', data.sessionId);
          sshManager.disconnect(data.sessionId);
          removeTab(data.sessionId);
          io.emit('tab-closed', { sessionId: data.sessionId });
          io.emit('sessions-updated');
        } else {
          console.log('[SSH] Session has new sockets, canceling close:', data.sessionId);
        }
      }, gracePeriod));
      return;
    }

    // No tab record — broadcast close so stale client UIs clear it.
    sshManager.disconnect(data.sessionId);
    removeTab(data.sessionId);
    io.emit('tab-closed', { sessionId: data.sessionId });
    io.emit('sessions-updated');
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