const { Client } = require('ssh2');
const { Terminal } = require('@xterm/headless');
const { SerializeAddon } = require('@xterm/addon-serialize');

class SSHManager {
  constructor() {
    this.sessions = new Map();
    // Data batching configuration
    this.batchInterval = 16; // ~60fps - batch data for this many ms before sending
    this.batchMaxSize = 64 * 1024; // 64KB max batch size - send immediately if exceeded
  }

  connect(socket, options) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const sessionId = options.sessionId || require('uuid').v4();

      console.log(`[SSH] Attempting connection to ${options.username}@${options.host}:${options.port || 22}`);

      const cols = options.cols || 80;
      const rows = options.rows || 24;
      
      // Create a headless terminal to maintain state
      const terminal = new Terminal({
        cols: cols,
        rows: rows,
        allowProposedApi: true
      });
      
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
        dataBuffer: '', // Buffer for outgoing data
        batchTimer: null, // Timer for batched sends
        lastDataTime: 0 // Timestamp of last data received
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

      // Authentication method
      if (options.password && options.password.length > 0) {
        config.password = options.password;
        console.log('[SSH] Using password authentication');
      } else if (options.privateKey && options.privateKey.length > 0) {
        // Handle private key - can be string or buffer
        try {
          // If it's a base64 encoded key, decode it
          if (options.privateKey.includes('BEGIN')) {
            config.privateKey = options.privateKey;
          } else {
            // Try to decode base64
            config.privateKey = Buffer.from(options.privateKey, 'base64').toString('utf8');
          }
        } catch (e) {
          config.privateKey = options.privateKey;
        }
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

          // Handle stream data with batching to reduce socket events
          // This prevents performance issues when multiple clients are connected
          stream.on('data', (data) => {
            const dataStr = data.toString('utf8');
            
            // Write to headless terminal to maintain state (immediate)
            session.terminal.write(dataStr);
            
            // Buffer data for batched broadcast
            this.bufferData(sessionId, dataStr);
          });

          stream.stderr.on('data', (data) => {
            const dataStr = data.toString('utf8');
            
            // Write to headless terminal (immediate)
            session.terminal.write(dataStr);
            
            // Buffer data for batched broadcast
            this.bufferData(sessionId, dataStr);
          });

          stream.on('close', () => {
            console.log(`[SSH] Stream closed: ${sessionId}`);
            // Flush any remaining buffered data before disconnect
            this.flushData(sessionId);
            this.broadcastToSession(sessionId, 'ssh-disconnected', { sessionId });
            this.disconnect(sessionId);
          });

          stream.on('exit', (code, signal) => {
            console.log(`[SSH] Stream exit: ${sessionId}, code: ${code}, signal: ${signal}`);
            this.broadcastToSession(sessionId, 'ssh-exit', { sessionId, code, signal });
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
        reject(err);
      });

      conn.on('close', () => {
        console.log(`[SSH] Connection closed: ${sessionId}`);
        this.broadcastToSession(sessionId, 'ssh-disconnected', { sessionId });
        this.sessions.delete(sessionId);
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
    
    // Get all connected sockets from the socket.io instance
    const io = require('./server').io;
    if (!io) return;
    
    // Emit to all sockets in the session room
    io.to(`session-${sessionId}`).emit(event, data);
  }

  // Buffer data for batched broadcast to reduce socket events
  // This improves performance when multiple clients are connected
  bufferData(sessionId, dataStr) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    
    // Add data to buffer
    session.dataBuffer += dataStr;
    session.lastDataTime = Date.now();
    
    // If buffer exceeds max size, flush immediately
    if (session.dataBuffer.length >= this.batchMaxSize) {
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
    if (session.dataBuffer.length > 0) {
      this.broadcastToSession(sessionId, 'ssh-data', { 
        sessionId, 
        data: session.dataBuffer 
      });
      session.dataBuffer = '';
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
    // This provides the complete screen state for TUIs
    if (session.terminal && session.serializeAddon) {
      try {
        // Serialize only the current viewport to avoid large payloads
        // 'all' mode can cause stack overflow with large scrollback buffers
        let serializedState = session.serializeAddon.serialize({
          mode: 'normal' // Only current viewport, not full scrollback
        });
        
        // Ensure it's a string (not a complex object)
        if (typeof serializedState !== 'string') {
          serializedState = String(serializedState);
        }
        
        // Validate the serialized state is not too large
        // Use a conservative limit to avoid Socket.IO stack overflow
        const maxSize = 50 * 1024; // 50KB max (reduced to be safe)
        if (serializedState.length > maxSize) {
          console.warn(`[SSH] Terminal state too large (${serializedState.length} bytes), skipping sync`);
        } else {
          console.log(`[SSH] Sending serialized terminal state to socket ${socket.id}, size: ${serializedState.length}`);
          
          // Use base64 encoding to avoid Socket.IO's binary detection
          // which can cause stack overflow with large strings
          const base64State = Buffer.from(serializedState, 'utf-8').toString('base64');
          
          // Send the serialized state to the joining client
          // Use a plain object with primitive values only
          socket.emit('ssh-screen-sync', {
            sessionId: sessionId,
            state: base64State,
            cols: session.cols,
            rows: session.rows,
            encoded: true // Flag to indicate base64 encoding
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
      controllerSocket: session.controllerSocket, // Tell client who is in control
      isController: session.controllerSocket === socket.id // Tell client if they are in control
    });
    
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
        const io = require('./server').io;
        if (io) {
          // Broadcast to all clients in the session about the new controller
          io.to(`session-${sessionId}`).emit('ssh-control-taken', {
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
    const io = require('./server').io;
    if (io) {
      // Broadcast to all OTHER clients that control was taken
      socket.to(`session-${sessionId}`).emit('ssh-control-taken', {
        sessionId,
        controllerSocket: socket.id
      });
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
      
      const io = require('./server').io;
      if (io) {
        io.to(`session-${sessionId}`).emit('ssh-control-released', {
          sessionId,
          controllerSocket: session.controllerSocket
        });
      }
    } else {
      session.controllerSocket = null;
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
      session.stream.write(data);
    }
  }

  resize(sessionId, cols, rows) {
    const session = this.sessions.get(sessionId);
    if (session && session.stream) {
      session.stream.setWindow(rows, cols);
      session.cols = cols;
      session.rows = rows;
      
      // Also resize the headless terminal
      if (session.terminal) {
        session.terminal.resize(cols, rows);
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
      // Use 'normal' mode to avoid stack overflow with large scrollback buffers
      const serializedState = session.serializeAddon.serialize({ mode: 'normal' });
      
      // Validate size
      const maxSize = 1024 * 1024; // 1MB max
      if (serializedState.length > maxSize) {
        console.warn(`[SSH] Terminal state too large (${serializedState.length} bytes), returning null`);
        return null;
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
      if (session.stream) {
        session.stream.end();
      }
      if (session.conn) {
        session.conn.end();
      }
      // Dispose of the headless terminal
      if (session.terminal) {
        session.terminal.dispose();
      }
      this.sessions.delete(sessionId);
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