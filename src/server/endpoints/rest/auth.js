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
  prepareEncryptedBookmarks,
  setBookmarkEncryptionKey,
  unlockBookmarkEncryption
} = require('../../utils/bookmark-encryption');

const authTokens = new Map();
const loginAttempts = new Map();
const TOKEN_TTL = 24 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;

function generateToken() {
  const crypto = require('crypto');
  return crypto.randomBytes(32).toString('hex');
}

function cleanExpiredTokens() {
  const now = Date.now();
  for (const [token, expiry] of authTokens) {
    if (expiry < now) authTokens.delete(token);
  }
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
  authTokens.clear();
  if (io && typeof io.disconnectSockets === 'function') {
    setTimeout(() => io.disconnectSockets(true), 50);
  }
}

function registerAuthEndpoints(app, io) {
  app.get('/api/auth/status', (req, res) => {
    const config = loadConfig();
    res.json({
      passwordEnabled: !!config.passwordHash,
      bookmarkEncryptionEnabled: config.bookmarkEncryptionEnabled === true
    });
  });

  app.post('/api/auth/login', async (req, res) => {
    const { password } = req.body;
    if (!isPasswordSet()) {
      return res.json({ success: true, authenticated: true });
    }
    if (!password) {
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
    const token = generateToken();
    authTokens.set(token, Date.now() + TOKEN_TTL);
    cleanExpiredTokens();
    res.json({ success: true, token });
  });

  app.post('/api/auth/set-password', async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (isPasswordSet()) {
      if (!currentPassword || !await verifyPasswordAsync(currentPassword)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    if (!newPassword || newPassword.length < 1) {
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
    const { currentPassword } = req.body;
    if (!isPasswordSet()) {
      return res.json({ success: true });
    }
    if (!currentPassword || !await verifyPasswordAsync(currentPassword)) {
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
    const { currentPassword, enabled } = req.body;
    if (!isPasswordSet()) {
      return res.status(400).json({ error: 'Password protection must be enabled first' });
    }
    if (!currentPassword || !await verifyPasswordAsync(currentPassword)) {
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
      notifyEncryptionState(io, enabled === true);
      res.json({ success: true, bookmarkEncryptionEnabled: enabled === true });
    } catch (err) {
      console.error('[AUTH] Failed to update bookmark encryption:', err.message);
      res.status(500).json({ error: 'Failed to update bookmark encryption' });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) authTokens.delete(token);
    res.json({ success: true });
  });
}

function isValidAuthToken(token) {
  if (!token) return false;
  cleanExpiredTokens();
  const expiry = authTokens.get(token);
  if (!expiry) return false;
  if (expiry < Date.now()) {
    authTokens.delete(token);
    return false;
  }
  return true;
}

module.exports = { registerAuthEndpoints, isValidAuthToken };
