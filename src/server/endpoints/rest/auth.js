const {
  hashPassword,
  isPasswordSet,
  loadConfig,
  saveConfig,
  verifyPasswordAsync
} = require('../../utils/config');
const {
  clearBookmarkEncryptionKey,
  decryptBookmarksWithPassword,
  getBookmarkEncryptionKey,
  prepareEncryptedBookmarks,
  setBookmarkEncryptionKey,
  unlockBookmarkEncryption
} = require('../../utils/bookmark-encryption');

const authTokens = require('../../utils/auth-tokens');
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function currentBookmarkKey(config) {
  const key = getBookmarkEncryptionKey();
  if (!config.bookmarkEncryptionEnabled || !key) return null;
  return { key, salt: config.bookmarkEncryptionSalt };
}

function getLoginAttemptKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function isLoginRateLimited(req) {
  const key = getLoginAttemptKey(req);
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(time => now - time < LOGIN_WINDOW_MS);
  if (attempts.length === 0) loginAttempts.delete(key);
  else loginAttempts.set(key, attempts);
  return attempts.length >= MAX_LOGIN_ATTEMPTS;
}

function reserveLoginAttempt(req) {
  const key = getLoginAttemptKey(req);
  const attempts = loginAttempts.get(key) || [];
  attempts.push(Date.now());
  loginAttempts.set(key, attempts);
}

function clearFailedLogins(req) {
  loginAttempts.delete(getLoginAttemptKey(req));
}

function notifyEncryptionState(io, enabled) {
  if (io && typeof io.emit === 'function') {
    io.emit('bookmark-encryption-changed', { enabled });
  }
}

function notifyAuthState(io, passwordEnabled) {
  if (io && typeof io.emit === 'function') {
    io.emit('auth-state-changed', { passwordEnabled });
  }
}

function revokeAuthenticatedClients(io) {
  authTokens.revokeAll();
  if (io && typeof io.disconnectSockets === 'function') {
    setTimeout(() => io.disconnectSockets(true), 50);
  }
}

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function registerAuthEndpoints(app, io) {
  app.get('/api/auth/status', (req, res) => {
    const config = loadConfig();
    res.json({
      passwordEnabled: !!config.passwordHash,
      bookmarkEncryptionEnabled: config.bookmarkEncryptionEnabled === true
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { password } = req.body || {};
    if (!isPasswordSet()) {
      return res.json({ success: true, authenticated: true });
    }
    if (!isNonEmptyString(password)) {
      return res.status(400).json({ error: 'Password required' });
    }
    if (isLoginRateLimited(req)) {
      return res.status(429).json({ error: 'Too many login attempts; try again shortly' });
    }
    // Reserve a slot before starting scrypt so concurrent bursts cannot all
    // pass the limit while earlier password checks are still in flight.
    reserveLoginAttempt(req);
    if (!await verifyPasswordAsync(password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    clearFailedLogins(req);
    try {
      unlockBookmarkEncryption(loadConfig(), password);
    } catch (err) {
      console.error('[AUTH] Failed to unlock encrypted bookmarks:', err.message);
      return res.status(500).json({ error: 'Encrypted bookmarks could not be unlocked' });
    }
    const config = loadConfig();
    const token = authTokens.issueToken(config.passwordHash, currentBookmarkKey(config));
    res.json({ success: true, token });
  });

  app.post('/api/auth/set-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (isPasswordSet()) {
      if (!isNonEmptyString(currentPassword) || !await verifyPasswordAsync(currentPassword)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    if (!isNonEmptyString(newPassword)) {
      return res.status(400).json({ error: 'Password cannot be empty' });
    }
    const config = loadConfig();
    const encryptionRequested = req.body.encryptBookmarks === undefined
      ? config.bookmarkEncryptionEnabled === true
      : req.body.encryptBookmarks === true;

    try {
      let bookmarks = config.bookmarks || [];
      if (config.bookmarkEncryptionEnabled) {
        bookmarks = decryptBookmarksWithPassword(config, currentPassword).bookmarks;
      }

      let nextKey = null;
      if (encryptionRequested) {
        const encrypted = prepareEncryptedBookmarks(bookmarks, newPassword);
        config.bookmarks = encrypted.bookmarks;
        config.bookmarkEncryptionEnabled = true;
        config.bookmarkEncryptionSalt = encrypted.salt;
        nextKey = encrypted.key;
      } else {
        config.bookmarks = bookmarks;
        config.bookmarkEncryptionEnabled = false;
        config.bookmarkEncryptionSalt = null;
      }
      config.passwordHash = hashPassword(newPassword);

      if (!saveConfig(config)) {
        return res.status(500).json({ error: 'Failed to save password' });
      }
      setBookmarkEncryptionKey(nextKey);
      notifyEncryptionState(io, encryptionRequested);
      notifyAuthState(io, true);
      revokeAuthenticatedClients(io);
      res.json({ success: true });
    } catch (err) {
      console.error('[AUTH] Failed to configure password protection:', err.message);
      res.status(500).json({ error: 'Failed to configure bookmark encryption' });
    }
  });

  app.post('/api/auth/remove-password', async (req, res) => {
    const { currentPassword } = req.body || {};
    if (!isPasswordSet()) {
      return res.json({ success: true });
    }
    if (!isNonEmptyString(currentPassword) || !await verifyPasswordAsync(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const config = loadConfig();
    try {
      if (config.bookmarkEncryptionEnabled) {
        config.bookmarks = decryptBookmarksWithPassword(config, currentPassword).bookmarks;
        config.bookmarkEncryptionEnabled = false;
        config.bookmarkEncryptionSalt = null;
      }
      config.passwordHash = null;
      if (!saveConfig(config)) {
        return res.status(500).json({ error: 'Failed to remove password' });
      }
      clearBookmarkEncryptionKey();
      notifyEncryptionState(io, false);
      notifyAuthState(io, false);
      revokeAuthenticatedClients(io);
      res.json({ success: true });
    } catch (err) {
      console.error('[AUTH] Failed to disable password protection:', err.message);
      res.status(500).json({ error: 'Failed to decrypt bookmarks before removing password' });
    }
  });

  app.post('/api/auth/bookmark-encryption', async (req, res) => {
    const { currentPassword, enabled } = req.body || {};
    if (!isPasswordSet()) {
      return res.status(400).json({ error: 'Password protection must be enabled first' });
    }
    if (!isNonEmptyString(currentPassword) || !await verifyPasswordAsync(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const config = loadConfig();
    try {
      if (enabled) {
        if (!config.bookmarkEncryptionEnabled) {
          const encrypted = prepareEncryptedBookmarks(config.bookmarks || [], currentPassword);
          config.bookmarks = encrypted.bookmarks;
          config.bookmarkEncryptionEnabled = true;
          config.bookmarkEncryptionSalt = encrypted.salt;
          if (!saveConfig(config)) {
            return res.status(500).json({ error: 'Failed to enable bookmark encryption' });
          }
          setBookmarkEncryptionKey(encrypted.key);
        } else {
          unlockBookmarkEncryption(config, currentPassword);
        }
      } else if (config.bookmarkEncryptionEnabled) {
        const decrypted = decryptBookmarksWithPassword(config, currentPassword);
        config.bookmarks = decrypted.bookmarks;
        config.bookmarkEncryptionEnabled = false;
        config.bookmarkEncryptionSalt = null;
        if (!saveConfig(config)) {
          return res.status(500).json({ error: 'Failed to disable bookmark encryption' });
        }
        clearBookmarkEncryptionKey();
      }
      // Keep remembered browsers able to unlock bookmarks after a restart.
      authTokens.rewrapBookmarkKey(
        enabled ? getBookmarkEncryptionKey() : null,
        enabled ? loadConfig().bookmarkEncryptionSalt : null
      );
      notifyEncryptionState(io, enabled === true);
      res.json({ success: true, bookmarkEncryptionEnabled: enabled === true });
    } catch (err) {
      console.error('[AUTH] Failed to update bookmark encryption:', err.message);
      res.status(500).json({ error: 'Failed to update bookmark encryption' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      authTokens.revokeToken(token);
      // Sockets opened with this token keep their session otherwise.
      if (io && io.sockets && io.sockets.sockets) {
        for (const socket of io.sockets.sockets.values()) {
          const t = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
          if (t === token) socket.disconnect(true);
        }
      }
    }
    res.json({ success: true });
  });
}

function isValidAuthToken(token) {
  if (!token) return false;
  const config = loadConfig();
  if (!authTokens.verifyToken(token, config.passwordHash)) return false;
  // After a restart the bookmark key is gone from memory; a remembered
  // browser carries what is needed to restore it.
  if (config.bookmarkEncryptionEnabled && !getBookmarkEncryptionKey()) {
    const key = authTokens.getBookmarkKeyForToken(token, config.bookmarkEncryptionSalt);
    if (key) {
      setBookmarkEncryptionKey(key);
      key.fill(0);
    }
  }
  return true;
}

module.exports = { registerAuthEndpoints, isValidAuthToken };
