/**
 * Bookmark REST endpoints
 */

const { loadConfig, saveConfig } = require('../../utils/config');
const {
  BookmarkEncryptionLockedError,
  getDecryptedBookmarks,
  storeBookmarks
} = require('../../utils/bookmark-encryption');

function handleBookmarkError(res, err) {
  if (err instanceof BookmarkEncryptionLockedError) {
    return res.status(423).json({ error: 'Encrypted bookmarks are locked; sign in again' });
  }
  console.error('[BOOKMARKS] Failed to process bookmarks:', err.message);
  return res.status(500).json({ error: 'Failed to process bookmarks' });
}

/**
 * Register bookmark endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerBookmarkEndpoints(app, io) {
  // API: Get bookmarks
  app.get('/api/bookmarks', (req, res) => {
    try {
      const config = loadConfig();
      res.json(getDecryptedBookmarks(config));
    } catch (err) {
      handleBookmarkError(res, err);
    }
  });

  // API: Add bookmark
  app.post('/api/bookmarks', (req, res) => {
    const config = loadConfig();
    const bookmark = {
      id: Date.now().toString(),
      name: req.body.name,
      type: req.body.type || 'ssh'
    };
    
    // Add type-specific fields
    if (req.body.type === 'url') {
      bookmark.url = req.body.url;
    } else {
      bookmark.host = req.body.host;
      bookmark.port = req.body.port || 22;
      bookmark.username = req.body.username;
    }
    
    // Add optional fields
    if (req.body.password) bookmark.password = req.body.password;
    if (req.body.privateKey) bookmark.privateKey = req.body.privateKey;
    if (req.body.passphrase) bookmark.passphrase = req.body.passphrase;
    if (req.body.folderId) bookmark.folderId = req.body.folderId;
    
    try {
      const bookmarks = getDecryptedBookmarks(config);
      bookmarks.push(bookmark);
      storeBookmarks(config, bookmarks);
      if (!saveConfig(config)) {
        return res.status(500).json({ error: 'Failed to save bookmark' });
      }
      // Broadcast to all clients
      io.emit('bookmark-added', bookmark);
      res.json(bookmark);
    } catch (err) {
      handleBookmarkError(res, err);
    }
  });

  // API: Delete bookmark
  app.delete('/api/bookmarks/:id', (req, res) => {
    const config = loadConfig();
    try {
      const bookmarks = getDecryptedBookmarks(config).filter(b => b.id !== req.params.id);
      storeBookmarks(config, bookmarks);
      if (!saveConfig(config)) {
        return res.status(500).json({ error: 'Failed to delete bookmark' });
      }
      // Broadcast to all clients
      io.emit('bookmark-deleted', { id: req.params.id });
      res.json({ success: true });
    } catch (err) {
      handleBookmarkError(res, err);
    }
  });

  // API: Update bookmark
  app.put('/api/bookmarks/:id', (req, res) => {
    const config = loadConfig();
    try {
      const bookmarks = getDecryptedBookmarks(config);
      const index = bookmarks.findIndex(b => b.id === req.params.id);
      if (index === -1) {
        return res.status(404).json({ error: 'Bookmark not found' });
      }
      bookmarks[index] = {
        ...bookmarks[index],
        ...req.body,
        id: req.params.id
      };
      delete bookmarks[index].encryptedConnection;
      storeBookmarks(config, bookmarks);
      if (!saveConfig(config)) {
        return res.status(500).json({ error: 'Failed to update bookmark' });
      }
      // Broadcast decrypted data only to authenticated, connected clients.
      io.emit('bookmark-updated', bookmarks[index]);
      res.json(bookmarks[index]);
    } catch (err) {
      handleBookmarkError(res, err);
    }
  });

  // API: Save bookmark order
  app.post('/api/bookmarks/order', (req, res) => {
    const config = loadConfig();
    config.bookmarkOrder = req.body.order;
    if (saveConfig(config)) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save bookmark order' });
    }
  });

  // API: Get bookmark order
  app.get('/api/bookmarks/order', (req, res) => {
    const config = loadConfig();
    res.json(config.bookmarkOrder || []);
  });
}

module.exports = { registerBookmarkEndpoints };
