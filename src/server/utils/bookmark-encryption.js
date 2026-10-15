const crypto = require('crypto');

const SENSITIVE_FIELDS = [
  'host',
  'port',
  'username',
  'password',
  'privateKey',
  'passphrase',
  'url'
];

let bookmarkEncryptionKey = null;

class BookmarkEncryptionLockedError extends Error {
  constructor(message = 'Encrypted bookmarks are locked') {
    super(message);
    this.name = 'BookmarkEncryptionLockedError';
    this.code = 'BOOKMARKS_LOCKED';
  }
}

function deriveKey(password, salt) {
  return crypto.scryptSync(password, Buffer.from(salt, 'base64'), 32);
}

function encryptConnectionData(data, key, bookmarkId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(bookmarkId)));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(data), 'utf8'),
    cipher.final()
  ]);
  return {
    version: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptConnectionData(payload, key, bookmarkId) {
  if (!payload || payload.version !== 1) {
    throw new Error('Unsupported encrypted bookmark format');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64')
  );
  decipher.setAAD(Buffer.from(String(bookmarkId)));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}

function encryptBookmark(bookmark, key) {
  const stored = { ...bookmark };
  const connectionData = {};
  for (const field of SENSITIVE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(stored, field)) {
      connectionData[field] = stored[field];
      delete stored[field];
    }
  }
  delete stored.encryptedConnection;
  stored.encryptedConnection = encryptConnectionData(connectionData, key, stored.id);
  return stored;
}

function decryptBookmark(bookmark, key) {
  if (!bookmark.encryptedConnection) return { ...bookmark };
  const stored = { ...bookmark };
  const connectionData = decryptConnectionData(stored.encryptedConnection, key, stored.id);
  delete stored.encryptedConnection;
  return { ...stored, ...connectionData };
}

function encryptBookmarks(bookmarks, key) {
  return (bookmarks || []).map(bookmark => encryptBookmark(bookmark, key));
}

function decryptBookmarks(bookmarks, key) {
  return (bookmarks || []).map(bookmark => decryptBookmark(bookmark, key));
}

function prepareEncryptedBookmarks(bookmarks, password, salt = crypto.randomBytes(16).toString('base64')) {
  const key = deriveKey(password, salt);
  return { salt, key, bookmarks: encryptBookmarks(bookmarks, key) };
}

function decryptBookmarksWithPassword(config, password) {
  if (!config.bookmarkEncryptionSalt) {
    throw new Error('Bookmark encryption salt is missing');
  }
  const key = deriveKey(password, config.bookmarkEncryptionSalt);
  return { key, bookmarks: decryptBookmarks(config.bookmarks, key) };
}

function unlockBookmarkEncryption(config, password) {
  if (!config.bookmarkEncryptionEnabled) {
    clearBookmarkEncryptionKey();
    return;
  }
  if (!config.bookmarkEncryptionSalt) {
    throw new Error('Bookmark encryption salt is missing');
  }
  // Password verification happens before this call. Keep login available
  // even if one bookmark payload is corrupt; decryption errors remain scoped
  // to bookmark access instead of locking the user out of the whole app.
  setBookmarkEncryptionKey(deriveKey(password, config.bookmarkEncryptionSalt));
}

function getDecryptedBookmarks(config) {
  if (!config.bookmarkEncryptionEnabled) return config.bookmarks || [];
  if (!bookmarkEncryptionKey) throw new BookmarkEncryptionLockedError();
  return decryptBookmarks(config.bookmarks, bookmarkEncryptionKey);
}

function storeBookmarks(config, bookmarks) {
  if (!config.bookmarkEncryptionEnabled) {
    config.bookmarks = bookmarks;
    return;
  }
  if (!bookmarkEncryptionKey) throw new BookmarkEncryptionLockedError();
  config.bookmarks = encryptBookmarks(bookmarks, bookmarkEncryptionKey);
}

function setBookmarkEncryptionKey(key) {
  if (bookmarkEncryptionKey) bookmarkEncryptionKey.fill(0);
  bookmarkEncryptionKey = key ? Buffer.from(key) : null;
}

function clearBookmarkEncryptionKey() {
  if (bookmarkEncryptionKey) bookmarkEncryptionKey.fill(0);
  bookmarkEncryptionKey = null;
}

module.exports = {
  BookmarkEncryptionLockedError,
  deriveKey,
  encryptBookmarks,
  decryptBookmarks,
  prepareEncryptedBookmarks,
  decryptBookmarksWithPassword,
  unlockBookmarkEncryption,
  getDecryptedBookmarks,
  storeBookmarks,
  setBookmarkEncryptionKey,
  clearBookmarkEncryptionKey
};
