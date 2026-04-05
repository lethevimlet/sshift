const { Client } = require('ssh2');

class SFTPManager {
  constructor() {
    this.sessions = new Map();
  }

  connect(socket, options) {
    return new Promise((resolve, reject) => {
      const conn = new Client();
      const sessionId = options.sessionId || require('uuid').v4();

      console.log(`[SFTP] Attempting connection to ${options.username}@${options.host}:${options.port || 22}`);

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
        console.log('[SFTP] Using password authentication');
      } else if (options.privateKey && options.privateKey.length > 0) {
        try {
          if (options.privateKey.includes('BEGIN')) {
            config.privateKey = options.privateKey;
          } else {
            config.privateKey = Buffer.from(options.privateKey, 'base64').toString('utf8');
          }
        } catch (e) {
          config.privateKey = options.privateKey;
        }
        if (options.passphrase && options.passphrase.length > 0) {
          config.passphrase = options.passphrase;
        }
        console.log('[SFTP] Using private key authentication');
      } else {
        config.tryKeyboard = true;
        console.log('[SFTP] No auth provided, trying keyboard-interactive');
      }

      // Handle keyboard-interactive authentication
      conn.on('keyboard-interactive', (name, instructions, instructionsLang, prompts, finish) => {
        console.log('[SFTP] Keyboard-interactive auth requested');
        if (prompts.length > 0 && options.password) {
          finish([options.password]);
        } else {
          finish([]);
        }
      });

      conn.on('ready', () => {
        console.log(`[SFTP] Connection ready: ${sessionId}`);
        
        conn.sftp((err, sftp) => {
          if (err) {
            console.error(`[SFTP] SFTP error: ${err.message}`);
            conn.end();
            socket.emit('sftp-error', { sessionId, message: err.message });
            reject(err);
            return;
          }

          const session = {
            id: sessionId,
            conn: conn,
            sftp: sftp,
            socket: socket,
            // Connection info for sessions API
            host: options.host,
            port: options.port || 22,
            username: options.username,
            connectedAt: Date.now()
          };

          this.sessions.set(sessionId, session);
          console.log(`[SFTP] SFTP session started: ${sessionId}`);
          resolve(sessionId);
        });
      });

      conn.on('error', (err) => {
        console.error(`[SFTP] Connection error: ${err.message}`);
        socket.emit('sftp-error', { sessionId, message: err.message });
        this.sessions.delete(sessionId);
        reject(err);
      });

      conn.on('close', () => {
        console.log(`[SFTP] Connection closed: ${sessionId}`);
        socket.emit('sftp-disconnected', { sessionId });
        this.sessions.delete(sessionId);
      });

      try {
        conn.connect(config);
      } catch (err) {
        console.error(`[SFTP] Connect exception: ${err.message}`);
        reject(err);
      }
    });
  }

  list(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      session.sftp.readdir(path, (err, list) => {
        if (err) {
          reject(err);
          return;
        }

        const files = list.map(item => ({
          name: item.filename,
          type: item.attrs.isDirectory() ? 'd' : '-',
          size: item.attrs.size,
          modifyTime: item.attrs.mtime * 1000,
          permissions: item.attrs.mode
        }));

        resolve(files);
      });
    });
  }

  download(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      const chunks = [];
      session.sftp.createReadStream(path).on('data', (chunk) => {
        chunks.push(chunk);
      }).on('end', () => {
        resolve(Buffer.concat(chunks));
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  upload(sessionId, path, data) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      const stream = session.sftp.createWriteStream(path);
      stream.on('close', () => resolve()).on('error', (err) => reject(err));
      stream.write(data);
      stream.end();
    });
  }

  mkdir(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      session.sftp.mkdir(path, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  delete(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      session.sftp.stat(path, (err, stats) => {
        if (err) {
          reject(err);
          return;
        }

        if (stats.isDirectory()) {
          session.sftp.rmdir(path, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        } else {
          session.sftp.unlink(path, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }
      });
    });
  }

  rename(sessionId, oldPath, newPath) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      session.sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  disconnect(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      if (session.conn) {
        session.conn.end();
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

module.exports = new SFTPManager();