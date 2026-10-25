/**
 * Bookmark REST endpoints
 */

const { loadConfig, saveConfig } = require('../../utils/config');
const { saveBookmark } = require('../../services/bookmarks');
const {
  BookmarkEncryptionLockedError,
  getDecryptedBookmarks,
  storeBookmarks
} = require('../../utils/bookmark-encryption');

function handleBookmarkError(res, err) {
  if (err.status === 404) return res.status(404).json({ error: err.message });
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
    try {
      res.json(saveBookmark(null, req.body, io));
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
    try {
      res.json(saveBookmark(req.params.id, req.body, io));
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
