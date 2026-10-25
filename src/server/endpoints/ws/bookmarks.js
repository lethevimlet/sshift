const { isPasswordSet } = require('../../utils/config');
const { isValidAuthToken } = require('../rest/auth');
const { BookmarkEncryptionLockedError } = require('../../utils/bookmark-encryption');
const { saveBookmark } = require('../../services/bookmarks');

function registerBookmarkHandlers(socket, io) {
  socket.on('bookmark-save', (data, acknowledge) => {
    if (typeof acknowledge !== 'function') return;
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (isPasswordSet() && !isValidAuthToken(token)) {
      return acknowledge({ error: 'Authentication required' });
    }
    if (!data || !data.bookmark || typeof data.bookmark !== 'object' || Array.isArray(data.bookmark)) {
      return acknowledge({ error: 'Invalid bookmark' });
    }
    try {
      acknowledge({ bookmark: saveBookmark(data.id, data.bookmark, io) });
    } catch (err) {
      acknowledge({ error: err instanceof BookmarkEncryptionLockedError
        ? 'Encrypted bookmarks are locked; sign in again'
        : err.status === 404 ? err.message : 'Failed to save bookmark' });
    }
  });
}

module.exports = { registerBookmarkHandlers };
