/** Shared bookmark writes for REST and authenticated WebSockets. */
const { loadConfig, saveConfig } = require('../utils/config');
const { getDecryptedBookmarks, storeBookmarks } = require('../utils/bookmark-encryption');

function saveBookmark(id, data, io) {
  const config = loadConfig();
  const bookmarks = getDecryptedBookmarks(config);
  let bookmark;
  if (id) {
    const index = bookmarks.findIndex(b => b.id === id);
    if (index === -1) {
      const error = new Error('Bookmark not found');
      error.status = 404;
      throw error;
    }
    bookmark = { ...bookmarks[index], ...data, id };
    delete bookmark.encryptedConnection;
    bookmarks[index] = bookmark;
  } else {
    bookmark = { id: Date.now().toString(), name: data.name, type: data.type || 'ssh' };
    if (bookmark.type === 'url') {
      bookmark.url = data.url;
    } else {
      bookmark.host = data.host;
      bookmark.port = data.port || 22;
      bookmark.username = data.username;
    }
    for (const field of ['password', 'privateKey', 'passphrase', 'folderId']) {
      if (data[field]) bookmark[field] = data[field];
    }
    bookmarks.push(bookmark);
  }
  storeBookmarks(config, bookmarks);
  if (!saveConfig(config)) throw new Error('Failed to save bookmark');
  io.emit(id ? 'bookmark-updated' : 'bookmark-added', bookmark);
  return bookmark;
}

module.exports = { saveBookmark };
