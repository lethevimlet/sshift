const { Client } = require('ssh2');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');
const { Unicode11Addon } = require('@xterm/addon-unicode11');
const pluginManager = require('../plugins/plugin-manager');
const { convertKeyIfNeeded } = require('../utils/key-converter');
const { removeTab } = require('../utils/tab-manager');

class SSHManager {
  constructor() {
    this.sessions = new Map();
    // Data batching configuration
    this.batchInterval = 4; // ~240fps - low latency for responsive rendering
    this.batchMaxSize = 128 * 1024; // 128KB max batch size - send immediately if exceeded
    // Socket.io instance (set via setIO method)
    this.io = null;
  }

  // Set the socket.io instance (called from server initialization)
  setIO(io) {
    this.io = io;
  }

  async connect(socket, options) {
    // Pre-process private key (auto-convert PPK to OpenSSH format)
    if (options.privateKey && options.privateKey.length > 0) {
      try {
        let keyContent = options.privateKey;
        if (!keyContent.includes('BEGIN')) {
          keyContent = Buffer.from(keyContent, 'base64').toString('utf8');
        }
        options = {
          ...options,
          privateKey: await convertKeyIfNeeded(keyContent, options.passphrase)
        };
      } catch (e) {
        console.error('[SSH] Key conversion failed:', e.message);
        return Promise.reject(new Error(e.message));
      }
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const sessionId = options.sessionId || require('uuid').v4();

      console.log(`[SSH] Attempting connection to ${options.username}@${options.host}:${options.port || 22}`);

      const cols = options.cols || 80;
      const rows = options.rows || 24;
      
      // Create a headless terminal to maintain state
      const scrollback = options.scrollback || 10000;
      const terminal = new Terminal({
        cols: cols,
        rows: rows,
        scrollback: scrollback,
        allowProposedApi: true,
        logLevel: 'off'
      });
      
      // Use Unicode 11 width rules so the headless terminal's character-width
      // calculations match the remote PTY. Without this, wide/ambiguous-width
      // characters (CJK, emojis, box-drawing) would be sized differently,
      // causing the serialized screen state to be misaligned when sent to
      // clients that also use Unicode 11.
      const unicode11Addon = new Unicode11Addon();
      terminal.loadAddon(unicode11Addon);
      terminal.unicode.activeVersion = '11';
      
      // Create serialize addon for terminal state
      const serializeAddon = new SerializeAddon();
      terminal.loadAddon(serializeAddon);

      const session = {
        id: sessionId,
        conn: conn,
        stream: null,
        socket: socket,
        sockets: new Set([socket.id]), // Track all connected sockets for this session
        controllerSocket: socket.id, // The socket that has control (first client gets control)
        cols: cols,
        rows: rows,
        terminal: terminal, // Headless terminal for state management
        serializeAddon: serializeAddon, // Serialize addon for syncing state
        // Connection info for sessions API
        host: options.host,
        port: options.port || 22,
        username: options.username,
        connectedAt: Date.now(),
        // Data batching state
        dataChunks: [], // Array of raw Buffers for outgoing data
        dataBufferSize: 0, // Running total of chunk byte lengths for size checks
        batchTimer: null, // Timer for batched sends
        lastDataTime: 0, // Timestamp of last data received
        // Streaming UTF-8 decoder that carries incomplete bytes across
        // flushes. If a multi-byte character is split between two SSH
        // data events and the first half is flushed before the second
        // arrives, toString('utf8') would replace the partial byte with
        // \uFFFD. The streaming decoder instead carries the partial byte
        // forward until the character is complete.
        decoder: new TextDecoder('utf-8'),
        writeQueue: null, // Queue for writes when stream is congested
        drainListener: false // Whether a drain listener is active
      };

      const config = {
        host: options.host,
        port: options.port || 22,
        username: options.username,
        readyTimeout: 30000,
        // Keep SSH connection alive for sticky sessions
        // These values can be configured via config.json
        keepaliveInterval: options.sshKeepaliveInterval || 10000,
        keepaliveCountMax: options.sshKeepaliveCountMax || 1000
      };

      // Authentication method (key already pre-processed above)
      if (options.password && options.password.length > 0) {
        config.password = options.password;
        console.log('[SSH] Using password authentication');
      } else if (options.privateKey && options.privateKey.length > 0) {
        config.privateKey = options.privateKey;
        if (options.passphrase && options.passphrase.length > 0) {
          config.passphrase = options.passphrase;
        }
        console.log('[SSH] Using private key authentication');
      } else {
        // Try keyboard-interactive for servers that require it
        config.tryKeyboard = true;
        console.log('[SSH] No auth provided, trying keyboard-interactive');
      }

      // Handle keyboard-interactive authentication
      conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        console.log('[SSH] Keyboard-interactive auth requested');
        // For password-based keyboard-interactive, send the password
        if (prompts.length > 0 && options.password) {
          finish([options.password]);
        } else {
          finish([]);
        }
      });

      conn.on('ready', () => {
        console.log(`[SSH] Connection ready: ${sessionId}`);
        
        // Start shell with proper PTY
        conn.shell({
          term: 'xterm-256color',
          cols: session.cols,
          rows: session.rows
        }, (err, stream) => {
          if (err) {
            console.error(`[SSH] Shell error: ${err.message}`);
            socket.emit('ssh-error', { sessionId, message: err.message });
            conn.end();
            reject(err);
            return;
          }

          session.stream = stream;
          this.sessions.set(sessionId, session);
          
          // Join the session room to receive broadcasts
          socket.join(`session-${sessionId}`);
          console.log(`[SSH] Shell started: ${sessionId}`);

          // Notify plugins about new session
          pluginManager.onSessionConnect(sessionId, {
            host: options.host,
            port: options.port || 22,
            username: options.username,
            name: options.name || 'SSH',
          });

          // Handle stream data with batching to reduce socket events
          // This prevents performance issues when multiple clients are connected.
          // Buffer raw bytes rather than converting to strings immediately —
          // this avoids corrupting multi-byte UTF-8 characters that span
          // chunk boundaries (each .toString('utf8') would replace the
          // incomplete halves with U+FFFD).
          stream.on('data', (data) => {
            this.bufferData(sessionId, data);
          });

          stream.stderr.on('data', (data) => {
            this.bufferData(sessionId, data);
          });

          stream.on('close', () => {
            console.log(`[SSH] Stream closed: ${sessionId}`);
            if (session.exitTimer) {
              clearTimeout(session.exitTimer);
              session.exitTimer = null;
            }
            this.flushData(sessionId);
            this.broadcastToSession(sessionId, 'ssh-disconnected', { sessionId });
            this.disconnect(sessionId);
            removeTab(sessionId);
            if (this.io) {
              this.io.emit('tab-closed', { sessionId });
              this.io.emit('sessions-updated');
            }
          });

          stream.on('exit', (code, signal) => {
            console.log(`[SSH] Stream exit: ${sessionId}, code: ${code}, signal: ${signal}`);
            this.broadcastToSession(sessionId, 'ssh-exit', { sessionId, code, signal });
            // Remote process exited. The ssh2 channel normally fires
            // `close` shortly after, but if it doesn't (network drop,
            // half-open socket) the session would linger in the map
            // forever, freezing sticky clients that reattach to it.
            // Arm a 500ms safety timer to force teardown if `close`
            // doesn't fire.
            if (session.exitTimer) clearTimeout(session.exitTimer);
            session.exitTimer = setTimeout(() => {
              console.warn(`[SSH] Stream close did not fire after exit; forcing disconnect for ${sessionId}`);
              this.disconnect(sessionId);
              if (this.io) {
                this.io.emit('tab-closed', { sessionId });
                this.io.emit('sessions-updated');
              }
            }, 500);
          });

          stream.on('error', (err) => {
            console.error(`[SSH] Stream error: ${sessionId}`, err);
            this.broadcastToSession(sessionId, 'ssh-error', { sessionId, message: err.message });
          });

          resolve(sessionId);
        });
      });

      conn.on('error', (err) => {
        console.error(`[SSH] Connection error: ${err.message}`);
        socket.emit('ssh-error', { sessionId, message: err.message });
        this.sessions.delete(sessionId);
        removeTab(sessionId);
        if (this.io) {
          this.io.emit('tab-closed', { sessionId });
          this.io.emit('sessions-updated');
        }
        reject(err);
      });

      conn.on('close', () => {
        console.log(`[SSH] Connection closed: ${sessionId}`);
        this.broadcastToSession(sessionId, 'ssh-disconnected', { sessionId });
        this.sessions.delete(sessionId);
        removeTab(sessionId);
        if (this.io) {
          this.io.emit('tab-closed', { sessionId });
          this.io.emit('sessions-updated');
        }
      });

      try {
        conn.connect(config);
      } catch (err) {
        console.error(`[SSH] Connect exception: ${err.message}`);
        reject(err);
      }
    });
  }

  // Broadcast data to all sockets connected to a session
  broadcastToSession(sessionId, event, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Use the socket.io instance set during initialization
    if (!this.io) return;
    
    // Emit to all sockets in the session room
    this.io.to(`session-${sessionId}`).emit(event, data);
  }

  // Buffer data for batched broadcast to reduce socket events
  // This improves performance when multiple clients are connected
  bufferData(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Track byte length for size-based flush threshold
    const byteLen = Buffer.isBuffer(data) ? data.length : data.length;
    
    // Add data to chunk array (avoids O(n^2) string concatenation)
    session.dataChunks.push(data);
    session.dataBufferSize += byteLen;
    session.lastDataTime = Date.now();
    
    // If buffer exceeds max size, flush immediately
    if (session.dataBufferSize >= this.batchMaxSize) {
      this.flushData(sessionId);
      return;
    }
    
    // If no timer is running, start one
    if (!session.batchTimer) {
      session.batchTimer = setTimeout(() => {
        this.flushData(sessionId);
      }, this.batchInterval);
    }
  }

  // Flush buffered data to all connected clients
  flushData(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Clear any pending timer
    if (session.batchTimer) {
      clearTimeout(session.batchTimer);
      session.batchTimer = null;
    }
    
    // If there's data to send, broadcast it
    if (session.dataChunks.length > 0) {
      // Concatenate raw Buffers first, then decode with the streaming
      // TextDecoder. Using { stream: true } carries any incomplete
      // trailing UTF-8 bytes forward to the next flush instead of
      // replacing them with U+FFFD. This is critical for TUI apps
      // whose escape sequences and wide characters span multiple SSH
      // data events that may be flushed separately.
      const combined = Buffer.concat(
        session.dataChunks.map(c => Buffer.isBuffer(c) ? c : Buffer.from(c, 'utf8'))
      );
      const joinedData = session.decoder.decode(combined, { stream: true });
      session.dataChunks = [];
      session.dataBufferSize = 0;
      
      // Write to headless terminal for state sync (batched write)
      if (session.terminal) {
        session.terminal.write(joinedData);
      }
      
      // Notify plugins about terminal output (batched, not per-chunk)
      pluginManager.onData(sessionId, joinedData);
      
      this.broadcastToSession(sessionId, 'ssh-data', { 
        sessionId, 
        data: joinedData
      });
    }
  }

  // Join a session (for receiving updates)
  joinSession(socket, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[SSH] Cannot join session ${sessionId}: session not found`);
      return false;
    }
    
    // Check if we have a terminal state to send
    let hasTerminalState = false;
    
    // Send current terminal state to the joining socket BEFORE joining the room
    // This ensures the client gets the full state before receiving any new data
    if (session.terminal && session.serializeAddon) {
      try {
        // Try to serialize full scrollback buffer first (includes all history)
        let serializedState = session.serializeAddon.serialize({ mode: 'all' });
        
        // Validate it's a string
        if (typeof serializedState !== 'string') {
          serializedState = String(serializedState);
        }
        
        // If full state is too large, fall back to viewport-only
        const fullMaxSize = 512 * 1024; // 512KB for full scrollback
        const viewportMaxSize = 50 * 1024; // 50KB fallback for viewport only
        
        if (serializedState.length > fullMaxSize) {
          console.warn(`[SSH] Full terminal state too large (${serializedState.length} bytes), falling back to viewport-only`);
          serializedState = session.serializeAddon.serialize({ mode: 'normal' });
          if (typeof serializedState !== 'string') {
            serializedState = String(serializedState);
          }
          
          if (serializedState.length > viewportMaxSize) {
            console.warn(`[SSH] Viewport state also too large (${serializedState.length} bytes), skipping sync`);
          } else {
            // Send viewport-only state
            const base64State = Buffer.from(serializedState, 'utf-8').toString('base64');
            socket.emit('ssh-screen-sync', {
              sessionId: sessionId,
              state: base64State,
              cols: session.cols,
              rows: session.rows,
              encoded: true,
              partial: true
            });
            hasTerminalState = true;
          }
        } else {
          // Send full state including scrollback
          const base64State = Buffer.from(serializedState, 'utf-8').toString('base64');
          console.log(`[SSH] Sending full serialized terminal state to socket ${socket.id}, size: ${serializedState.length}, base64: ${base64State.length}`);
          
          socket.emit('ssh-screen-sync', {
            sessionId: sessionId,
            state: base64State,
            cols: session.cols,
            rows: session.rows,
            encoded: true,
            partial: false
          });
          
          hasTerminalState = true;
        }
      } catch (err) {
        console.error(`[SSH] Error serializing terminal state:`, err.message);
      }
    }
    
    // Now join the session room to receive future updates
    socket.join(`session-${sessionId}`);
    session.sockets.add(socket.id);
    console.log(`[SSH] Socket ${socket.id} joined session ${sessionId}`);
    
    // Notify client that they've joined, including whether terminal state was sent
    // and who is the current controller
    socket.emit('ssh-joined', {
      sessionId: sessionId,
      noTerminalState: !hasTerminalState,
      controllerSocket: session.controllerSocket,
      isController: session.controllerSocket === socket.id,
      socketCount: session.sockets.size
    });
    
    if (this.io) {
      this.io.emit('sessions-updated');
    }
    
    return true;
  }

  // Leave a session
  leaveSession(socket, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    const wasController = session.controllerSocket === socket.id;
    session.sockets.delete(socket.id);
    socket.leave(`session-${sessionId}`);
    console.log(`[SSH] Socket ${socket.id} left session ${sessionId}`);
    
    // If the controller left, assign control to another socket
    if (wasController) {
      const remainingSockets = Array.from(session.sockets);
      if (remainingSockets.length > 0) {
        // Assign control to the first remaining socket
        session.controllerSocket = remainingSockets[0];
        console.log(`[SSH] Controller left, reassigning control to ${session.controllerSocket}`);
        
        // Notify the new controller and remaining clients about the new controller
        // Include terminal dimensions so the new controller can resize if needed
        if (this.io) {
          // Broadcast to all clients in the session about the new controller
          this.io.to(`session-${sessionId}`).emit('ssh-control-taken', {
            sessionId,
            controllerSocket: session.controllerSocket,
            cols: session.cols,
            rows: session.rows
          });
        }
      } else {
        session.controllerSocket = null;
      }
    }
    
    if (this.io) {
      this.io.emit('sessions-updated');
    }
  }

  // Take control of a session
  takeControl(socket, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[SSH] Cannot take control: session ${sessionId} not found`);
      return { success: false, error: 'Session not found' };
    }
    
    // Prevent rapid control transfers (cooldown of 1 second)
    // This prevents "control wars" where multiple clients keep taking control
    const now = Date.now();
    if (session.lastControlTransfer && (now - session.lastControlTransfer) < 1000) {
      console.log(`[SSH] Control transfer cooldown active for session ${sessionId}`);
      return { success: false, error: 'Please wait before taking control again' };
    }
    
    const previousController = session.controllerSocket;
    session.controllerSocket = socket.id;
    session.lastControlTransfer = now;
    console.log(`[SSH] Socket ${socket.id} took control of session ${sessionId} (was ${previousController})`);
    
    // Notify other clients that control was taken
    if (this.io) {
      // Broadcast to all OTHER clients that control was taken
      socket.to(`session-${sessionId}`).emit('ssh-control-taken', {
        sessionId,
        controllerSocket: socket.id
      });
    }
    
    if (this.io) {
      this.io.emit('sessions-updated');
    }
    
    return { 
      success: true, 
      cols: session.cols, 
      rows: session.rows,
      previousController: previousController
    };
  }

  // Release control of a session (become observer)
  releaseControl(socket, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }
    
    if (session.controllerSocket !== socket.id) {
      return { success: false, error: 'Not the controller' };
    }
    
    // Find another socket to give control to
    const remainingSockets = Array.from(session.sockets).filter(id => id !== socket.id);
    if (remainingSockets.length > 0) {
      session.controllerSocket = remainingSockets[0];
      console.log(`[SSH] Socket ${socket.id} released control, new controller: ${session.controllerSocket}`);
      
      if (this.io) {
        this.io.to(`session-${sessionId}`).emit('ssh-control-released', {
          sessionId,
          controllerSocket: session.controllerSocket
        });
      }
    } else {
      session.controllerSocket = null;
    }
    
    if (this.io) {
      this.io.emit('sessions-updated');
    }
    
    return { success: true };
  }

  // Check if a socket is the controller
  isController(socketId, sessionId) {
    const session = this.sessions.get(sessionId);
    return session && session.controllerSocket === socketId;
  }

  write(sessionId, data) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      const canWrite = session.stream.write(data);
      if (!canWrite) {
        // Stream buffer is full — queue write and wait for drain.
        // Cap the queue to avoid OOM on a slow/half-open remote;
        // 64 chunks is enough headroom for normal paste flows
        // while bounding memory in pathological cases.
        if (!session.writeQueue) session.writeQueue = [];
        if (session.writeQueue.length >= 64) {
          console.warn(`[SSH] writeQueue overflow for ${sessionId}; dropping ${session.writeQueue.length} queued chunks`);
          session.writeQueue = [];
          if (this.io) {
            this.io.to(`session-${sessionId}`).emit('ssh-error', {
              sessionId,
              message: 'bufferFull'
            });
          }
          return;
        }
        session.writeQueue.push(data);
        if (!session.drainListener) {
          session.drainListener = true;
          session.stream.once('drain', () => {
            session.drainListener = false;
            if (session.writeQueue && session.writeQueue.length > 0) {
              const queue = session.writeQueue;
              session.writeQueue = [];
              for (const chunk of queue) {
                this.write(sessionId, chunk);
              }
            }
          });
        }
      }
    }
  }

  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      try {
        session.stream.setWindow(rows, cols);
      } catch (err) {
        console.error(`[SSH] stream.setWindow failed for ${sessionId}:`, err.message);
      }
      session.cols = cols;
      session.rows = rows;

      // Also resize the headless terminal. xterm.js v6 throws on
      // resize(0, 0) or out-of-range values — wrap so a malformed
      // payload doesn't tear down the entire session.
      if (session.terminal) {
        try {
          session.terminal.resize(cols, rows);
        } catch (err) {
          console.error(`[SSH] headless terminal.resize failed for ${sessionId}:`, err.message);
        }
      }
    }
  }

  // Get current terminal state for a session
  getTerminalState(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.terminal || !session.serializeAddon) {
      return null;
    }
    
    try {
      // Serialize full scrollback buffer to preserve history on reload
      let serializedState = session.serializeAddon.serialize({ mode: 'all' });
      
      // Validate size - allow up to 1MB for manual sync requests
      const maxSize = 1024 * 1024; // 1MB max
      if (serializedState.length > maxSize) {
        console.warn(`[SSH] Terminal state too large (${serializedState.length} bytes), falling back to viewport-only`);
        serializedState = session.serializeAddon.serialize({ mode: 'normal' });
        if (serializedState.length > maxSize) {
          console.warn(`[SSH] Viewport state also too large (${serializedState.length} bytes), returning null`);
          return null;
        }
      }
      
      return {
        state: serializedState,
        cols: session.cols,
        rows: session.rows
      };
    } catch (err) {
      console.error(`[SSH] Error getting terminal state:`, err.message);
      return null;
    }
  }

  disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      // Clear any pending batch timer
      if (session.batchTimer) {
        clearTimeout(session.batchTimer);
        session.batchTimer = null;
      }
      // Clear any pending exit-safety timer
      if (session.exitTimer) {
        clearTimeout(session.exitTimer);
        session.exitTimer = null;
      }
      // Flush any remaining incomplete UTF-8 bytes from the streaming
      // decoder. Passing { stream: false } (or no option) signals the
      // decoder that the stream has ended, emitting any buffered bytes
      // as replacement characters — there should be none in a clean
      // disconnect, but this prevents a memory leak.
      try { session.decoder.decode(new Uint8Array(0)); } catch (_) {}
      if (session.stream) {
        try { session.stream.end(); } catch (_) {}
        // Also call destroy() to force teardown of half-open sockets.
        // end() only signals EOF and waits for the peer to acknowledge;
        // if the remote is unreachable, end() alone can leave a
        // half-open socket pinning the session in the map until GC.
        try { session.stream.destroy(); } catch (_) {}
      }
      if (session.conn) {
        try { session.conn.end(); } catch (_) {}
      }
      // Dispose of the headless terminal
      if (session.terminal) {
        session.terminal.dispose();
      }
      this.sessions.delete(sessionId);
      removeTab(sessionId);
      // Notify plugins about disconnect
      pluginManager.onSessionDisconnect(sessionId);
    }
  }

  disconnectAll(socketId) {
    for (const [sessionId, session] of this.sessions) {
      if (session.socket.id === socketId) {
        this.disconnect(sessionId);
      }
    }
  }

  getActiveSessions() {
    return this.sessions;
  }
}

module.exports = new SSHManager();