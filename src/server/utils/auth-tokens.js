/**
 * Persistent login tokens ("remembered devices").
 *
 * Until v1.9.8 tokens lived only in a process-memory Map with a fixed 24 h
 * lifetime, so every server restart (update, reboot, crash) and every day
 * of uptime threw all browsers back to the password prompt. Tokens now
 * survive restarts and never expire on their own. A token stops working
 * only when:
 *   - the browser logs out (Settings → Logout revokes that one token), or
 *   - the password changes / is removed (all tokens are revoked), including
 *     a password hash changed outside the app: each token is bound to a
 *     fingerprint of the password hash it was issued under.
 *
 * Storage: <dataDir>/auth-tokens.json (mode 0600). Only SHA-256 hashes of
 * tokens are stored, so the file alone cannot be used to log in.
 *
 * Encrypted bookmarks: the bookmark key is derived from the password and
 * normally exists only in memory after a password login. To keep bookmarks
 * usable after a restart without asking for the password again, each token
 * record carries the bookmark key wrapped (AES-256-GCM) with a key derived
 * from the raw token, which is never stored. Presenting the token after a
 * restart unwraps it.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_TOKENS = 100;
const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

let storePath = null;
let store = null; // { version, tokens: { [hash]: record } }
// Raw tokens seen since this process started (needed to re-wrap the
// bookmark key for them when it changes). Never persisted.
const seenRawTokens = new Map(); // hash -> raw token

function defaultStorePath() {
  // Unit tests must never touch the real data directory (a revokeAll there
  // would log out the browsers of a live instance on the same machine).
  if (process.env.JEST_WORKER_ID && !process.env.SSHIFT_DATA_DIR) {
    return path.join(require('os').tmpdir(), `sshift-test-auth-tokens-${process.pid}.json`);
  }
  let dataDir = null;
  try {
    const config = require('./config');
    if (typeof config.getDataDir === 'function') dataDir = config.getDataDir();
  } catch (_) {}
  if (!dataDir) {
    dataDir = process.env.SSHIFT_DATA_DIR
      ? path.resolve(process.env.SSHIFT_DATA_DIR)
      : path.join(require('os').homedir(), '.local', 'share', 'sshift');
  }
  return path.join(dataDir, 'auth-tokens.json');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function passwordFingerprint(passwordHash) {
  if (!passwordHash) return null;
  return crypto.createHash('sha256').update(String(passwordHash)).digest('hex');
}

function wrapKeyFor(token, salt) {
  return crypto.hkdfSync('sha256', Buffer.from(String(token)), Buffer.from(String(salt || '')), 'sshift-bookmark-key-wrap', 32);
}

function wrapBookmarkKey(token, key, salt) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(wrapKeyFor(token, salt)), iv);
  const ciphertext = Buffer.concat([cipher.update(key), cipher.final()]);
  return {
    salt,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function unwrapBookmarkKey(token, wrapped) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    Buffer.from(wrapKeyFor(token, wrapped.salt)),
    Buffer.from(wrapped.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(wrapped.ciphertext, 'base64')),
    decipher.final()
  ]);
}

function load() {
  if (store) return store;
  if (!storePath) storePath = defaultStorePath();
  store = { version: 1, tokens: {} };
  try {
    if (fs.existsSync(storePath)) {
      const data = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      if (data && typeof data.tokens === 'object' && data.tokens) {
        store.tokens = data.tokens;
      }
    }
  } catch (err) {
    console.error('[AUTH] Could not read token store, starting empty:', err.message);
  }
  return store;
}

function save() {
  if (!store) return;
  if (!storePath) storePath = defaultStorePath();
  let tempPath = null;
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    tempPath = `${storePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const fd = fs.openSync(tempPath, 'w', 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(store, null, 2));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tempPath, storePath);
  } catch (err) {
    console.error('[AUTH] Could not save token store:', err.message);
    if (tempPath) {
      try { fs.unlinkSync(tempPath); } catch (_) {}
    }
  }
}

function evictOldest() {
  const entries = Object.entries(store.tokens);
  if (entries.length <= MAX_TOKENS) return;
  entries.sort((a, b) => (a[1].lastUsed || 0) - (b[1].lastUsed || 0));
  for (const [hash] of entries.slice(0, entries.length - MAX_TOKENS)) {
    delete store.tokens[hash];
    seenRawTokens.delete(hash);
  }
}

/**
 * Issue a new token bound to the current password hash.
 * @param {string} passwordHash current config.passwordHash
 * @param {{key: Buffer, salt: string}|null} bookmarkKey key to wrap, if bookmark encryption is on
 */
function issueToken(passwordHash, bookmarkKey) {
  load();
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  const now = Date.now();
  const record = { created: now, lastUsed: now, pw: passwordFingerprint(passwordHash) };
  if (bookmarkKey && bookmarkKey.key) {
    record.bookmarkKey = wrapBookmarkKey(token, bookmarkKey.key, bookmarkKey.salt);
  }
  store.tokens[hash] = record;
  seenRawTokens.set(hash, token);
  evictOldest();
  save();
  return token;
}

/**
 * Check a token. Returns the record (truthy) when valid, else null.
 * Invalidates the token when it was issued under a different password.
 */
function verifyToken(token, passwordHash) {
  if (!token || typeof token !== 'string') return null;
  load();
  const hash = hashToken(token);
  const record = store.tokens[hash];
  if (!record) return null;
  if (record.pw !== passwordFingerprint(passwordHash)) {
    delete store.tokens[hash];
    seenRawTokens.delete(hash);
    save();
    return null;
  }
  seenRawTokens.set(hash, token);
  const now = Date.now();
  if (now - (record.lastUsed || 0) > LAST_USED_WRITE_INTERVAL_MS) {
    record.lastUsed = now;
    save();
  }
  return record;
}

/**
 * Bookmark key wrapped for this token, or null (none stored, stale salt,
 * or unwrap failure).
 */
function getBookmarkKeyForToken(token, salt) {
  load();
  const record = store.tokens[hashToken(token)];
  if (!record || !record.bookmarkKey) return null;
  if (salt && record.bookmarkKey.salt !== salt) return null;
  try {
    return unwrapBookmarkKey(token, record.bookmarkKey);
  } catch (_) {
    return null;
  }
}

/**
 * The bookmark key changed (encryption toggled with the password): wrap the
 * new key for every token whose raw value this process has seen, and drop
 * the stale wrapped key from the others.
 */
function rewrapBookmarkKey(key, salt) {
  load();
  for (const [hash, record] of Object.entries(store.tokens)) {
    const raw = seenRawTokens.get(hash);
    if (key && raw) record.bookmarkKey = wrapBookmarkKey(raw, key, salt);
    else delete record.bookmarkKey;
  }
  save();
}

function revokeToken(token) {
  if (!token) return;
  load();
  const hash = hashToken(token);
  seenRawTokens.delete(hash);
  if (store.tokens[hash]) {
    delete store.tokens[hash];
    save();
  }
}

function revokeAll() {
  load();
  store.tokens = {};
  seenRawTokens.clear();
  save();
}

// Tests only.
function _setStorePath(p) {
  storePath = p;
  store = null;
  seenRawTokens.clear();
}

module.exports = {
  issueToken,
  verifyToken,
  getBookmarkKeyForToken,
  rewrapBookmarkKey,
  revokeToken,
  revokeAll,
  _setStorePath
};
