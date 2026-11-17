const { Client } = require('ssh2');
const { convertKeyIfNeeded } = require('../utils/key-converter');
const { removeTab } = require('../utils/tab-manager');

class SFTPManager {
  constructor() {
    this.sessions = new Map();
    this.activeUploads = new Map();
    this.nextUploadId = 1;
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
        console.error('[SFTP] Key conversion failed:', e.message);
        return Promise.reject(new Error(e.message));
      }
    }

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

      // Authentication method (key already pre-processed above)
      if (options.password && options.password.length > 0) {
        config.password = options.password;
        console.log('[SFTP] Using password authentication');
      } else if (options.privateKey && options.privateKey.length > 0) {
        config.privateKey = options.privateKey;
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
            host: options.host,
            port: options.port || 22,
            username: options.username,
            connectedAt: Date.now(),
            homeDir: null
          };

          // Resolve the user's home directory so we can fall back to it
          // when listing "/" fails (e.g. chrooted SFTP or restricted
          // server configs).  realpath('.') returns the absolute path of
          // the remote working directory, which defaults to the user's
          // home on most SSH servers.
          sftp.realpath('.', (realpathErr, resolvedPath) => {
            if (!realpathErr && resolvedPath) {
              session.homeDir = resolvedPath;
              console.log(`[SFTP] Resolved home directory for ${options.username}: ${resolvedPath}`);
            } else {
              console.warn(`[SFTP] Could not resolve home directory: ${realpathErr?.message}`);
            }

            // A client-chosen id can collide with a live session (two
            // browsers recreating the same tab): retire the old connection
            // so its late close event cannot tear down this one.
            const previous = this.sessions.get(sessionId);
            if (previous && previous !== session) {
              console.warn(`[SFTP] Replacing existing session with the same id: ${sessionId}`);
              previous.replaced = true;
              try { previous.conn.end(); } catch (_) {}
            }
            this.sessions.set(sessionId, session);
            ownSession = session;
            established = true;
            // Every viewer (creator + sftp-join) hears errors/disconnects,
            // not only the socket that created the session.
            try { socket.join(`sftp-${sessionId}`); } catch (_) {}
            console.log(`[SFTP] SFTP session started: ${sessionId}`);
            resolve(sessionId);
          });
        });
      });

      let established = false;
      let ownSession = null;
      const owns = () => {
        const current = this.sessions.get(sessionId);
        if (current && current.conn === conn) ownSession = current;
        return !!current && current.conn === conn;
      };
      const notify = (event, payload) => {
        if (established && socket.nsp) socket.nsp.to(`sftp-${sessionId}`).emit(event, payload);
        else socket.emit(event, payload);
      };

      conn.on('error', (err) => {
        console.error(`[SFTP] Connection error: ${err.message}`);
        if (ownSession && ownSession.replaced) return reject(err);
        notify('sftp-error', { sessionId, message: err.message });
        if (owns()) {
          this.sessions.delete(sessionId);
          removeTab(sessionId);
        } else if (!this.sessions.has(sessionId)) {
          removeTab(sessionId);
        }
        reject(err);
      });

      conn.on('close', () => {
        console.log(`[SFTP] Connection closed: ${sessionId}`);
        if (!owns()) {
          // Replaced by a newer connection with the same id, or never
          // established: leave the live session and its tab alone.
          if (!established && !this.sessions.has(sessionId)) removeTab(sessionId);
          reject(new Error('Connection closed'));
          return;
        }
        notify('sftp-disconnected', { sessionId });
        this.sessions.delete(sessionId);
        removeTab(sessionId);
      });

try {
      conn.connect(config);
    } catch (err) {
      console.error(`[SFTP] Connect exception: ${err.message}`);
      reject(err);
    }
  });
  }

  home(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return session.homeDir || null;
  }

  realpath(sessionId, path) {
    return new Promise((resolve, reject) => {
      const session = this.sessions.get(sessionId);
      if (!session) {
        reject(new Error('Session not found'));
        return;
      }

      session.sftp.realpath(path, (err, resolvedPath) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(resolvedPath);
      });
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

  stat(sessionId, path) {
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

        // Return the raw ssh2 Stats object so callers can use the
        // standard `stats.isDirectory()` / `stats.isFile()` METHODS
        // (not properties). The previous normalized return shape
        // (`{ isDirectory: bool, isFile: bool }`) broke callers —
        // notably `sftp-download` at src/server/endpoints/ws/sftp.js
        // which calls `stats.isDirectory()` as a function and crashed
        // with "stats.isDirectory is not a function" on every file
        // download attempt. We add normalized properties as aliases
        // so existing callers that read them as booleans still work.
        resolve({
          // Raw ssh2 Stats methods (primary API).
          isDirectory: () => stats.isDirectory(),
          isFile: () => stats.isFile(),
          // Aliased scalar fields for callers that read these as values.
          size: stats.size,
          modifyTime: stats.mtime * 1000,
          isDirectoryValue: stats.isDirectory(),
          isFileValue: stats.isFile()
        });
      });
    });
  }

  getReadStream(sessionId, path) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    return session.sftp.createReadStream(path);
  }

  // An upload whose browser vanished (tab closed, network lost) never sends
  // end/cancel: drop it after this long without a chunk, closing the
  // remote file handle it holds.
  _armUploadIdle(upload) {
    if (upload.idleTimer) clearTimeout(upload.idleTimer);
    upload.idleTimer = setTimeout(() => {
      if (!this.activeUploads.has(upload.id)) return;
      console.warn(`[SFTP] Upload ${upload.id} (${upload.path}) idle for 2 minutes, aborting`);
      this.uploadCancel(upload.id);
    }, 2 * 60 * 1000);
    if (upload.idleTimer.unref) upload.idleTimer.unref();
  }

  uploadStart(sessionId, path, fileName, fileSize) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const uploadId = String(this.nextUploadId++);
    const stream = session.sftp.createWriteStream(path);

    const upload = {
      id: uploadId,
      sessionId,
      stream,
      bytesWritten: 0,
      totalBytes: fileSize,
      fileName,
      path,
      error: null,
      resolveEnd: null,
      rejectEnd: null
    };

    stream.on('error', (err) => {
      upload.error = err;
      if (upload.rejectEnd) {
        upload.rejectEnd(err);
        upload.rejectEnd = null;
        upload.resolveEnd = null;
      }
      if (upload.idleTimer) clearTimeout(upload.idleTimer);
      this.activeUploads.delete(uploadId);
    });

    stream.on('close', () => {
      if (upload.idleTimer) clearTimeout(upload.idleTimer);
      if (upload.resolveEnd) {
        upload.resolveEnd({ path: upload.path, fileName: upload.fileName });
        upload.resolveEnd = null;
        upload.rejectEnd = null;
      }
      this.activeUploads.delete(uploadId);
    });

    this.activeUploads.set(uploadId, upload);
    this._armUploadIdle(upload);
    return uploadId;
  }

  uploadChunk(uploadId, chunkBase64) {
    return new Promise((resolve, reject) => {
      const upload = this.activeUploads.get(uploadId);
      if (!upload) {
        reject(new Error('Upload not found'));
        return;
      }
      if (upload.error) {
        reject(upload.error);
        return;
      }

      if (typeof chunkBase64 !== 'string') {
        reject(new Error('Invalid chunk'));
        return;
      }
      this._armUploadIdle(upload);
      const chunkData = Buffer.from(chunkBase64, 'base64');

      upload.stream.write(chunkData, (err) => {
        if (err) {
          reject(err);
          return;
        }
        upload.bytesWritten += chunkData.length;
        resolve({
          bytesWritten: upload.bytesWritten,
          totalBytes: upload.totalBytes
        });
      });
    });
  }

  uploadEnd(uploadId) {
    return new Promise((resolve, reject) => {
      const upload = this.activeUploads.get(uploadId);
      if (!upload) {
        reject(new Error('Upload not found'));
        return;
      }
      if (upload.error) {
        this.activeUploads.delete(uploadId);
        reject(upload.error);
        return;
      }

      upload.resolveEnd = resolve;
      upload.rejectEnd = reject;
      upload.stream.end();
    });
  }

  uploadCancel(uploadId) {
    const upload = this.activeUploads.get(uploadId);
    if (upload) {
      if (upload.idleTimer) clearTimeout(upload.idleTimer);
      try { upload.stream.destroy(); } catch (_) {}
      if (upload.rejectEnd) {
        upload.rejectEnd(new Error('Upload cancelled'));
        upload.rejectEnd = null;
        upload.resolveEnd = null;
      }
      this.activeUploads.delete(uploadId);
    }
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
      for (const upload of [...this.activeUploads.values()]) {
        if (upload.sessionId === sessionId) this.uploadCancel(upload.id);
      }
      if (session.conn) {
        session.conn.end();
      }
      this.sessions.delete(sessionId);
      removeTab(sessionId);
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

  // Join an existing SFTP session (for multi-client viewing)
  joinSession(socket, sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      console.log(`[SFTP] Cannot join session ${sessionId}: session not found`);
      return false;
    }
    try { socket.join(`sftp-${sessionId}`); } catch (_) {}
    return true;
  }

  // Leave an SFTP session (just removes the socket, doesn't disconnect)
  leaveSession(socket, sessionId) {
    // SFTP sessions don't track per-socket membership like SSH does
    // The session stays alive as long as the SSH connection is active
    console.log(`[SFTP] Socket ${socket.id} left session ${sessionId}`);
  }
}

module.exports = new SFTPManager();