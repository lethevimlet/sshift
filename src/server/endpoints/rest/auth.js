const { isPasswordSet, verifyPassword, setPassword, removePassword } = require('../../utils/config');

const authTokens = new Map();
const TOKEN_TTL = 24 * 60 * 60 * 1000;

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

function registerAuthEndpoints(app, io) {
  app.get('/api/auth/status', (req, res) => {
    res.json({ passwordEnabled: isPasswordSet() });
  });

  app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    if (!isPasswordSet()) {
      return res.json({ success: true, authenticated: true });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password required' });
    }
    if (!verifyPassword(password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    const token = generateToken();
    authTokens.set(token, Date.now() + TOKEN_TTL);
    cleanExpiredTokens();
    res.json({ success: true, token });
  });

  app.post('/api/auth/set-password', (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (isPasswordSet()) {
      if (!currentPassword || !verifyPassword(currentPassword)) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    if (!newPassword || newPassword.length < 1) {
      return res.status(400).json({ error: 'Password cannot be empty' });
    }
    const result = setPassword(newPassword);
    if (result) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save password' });
    }
  });

  app.post('/api/auth/remove-password', (req, res) => {
    const { currentPassword } = req.body;
    if (!isPasswordSet()) {
      return res.json({ success: true });
    }
    if (!currentPassword || !verifyPassword(currentPassword)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const result = removePassword();
    if (result) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to remove password' });
    }
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