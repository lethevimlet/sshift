/**
 * Bookmark REST endpoints
 */

const { loadConfig, saveConfig } = require('../../utils/config');

/**
 * Register bookmark endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerBookmarkEndpoints(app, io) {
  // API: Get bookmarks
  app.get('/api/bookmarks', (req, res) => {
    const config = loadConfig();
    res.json(config.bookmarks);
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
    
    config.bookmarks.push(bookmark);
    if (saveConfig(config)) {
      // Broadcast to all clients
      io.emit('bookmark-added', bookmark);
      res.json(bookmark);
    } else {
      res.status(500).json({ error: 'Failed to save bookmark' });
    }
  });

  // API: Delete bookmark
  app.delete('/api/bookmarks/:id', (req, res) => {
    const config = loadConfig();
    config.bookmarks = config.bookmarks.filter(b => b.id !== req.params.id);
    if (saveConfig(config)) {
      // Broadcast to all clients
      io.emit('bookmark-deleted', { id: req.params.id });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete bookmark' });
    }
  });

  // API: Update bookmark
  app.put('/api/bookmarks/:id', (req, res) => {
    const config = loadConfig();
    const index = config.bookmarks.findIndex(b => b.id === req.params.id);
    if (index !== -1) {
      config.bookmarks[index] = {
        ...config.bookmarks[index],
        ...req.body,
        id: req.params.id
      };
      if (saveConfig(config)) {
        // Broadcast to all clients
        io.emit('bookmark-updated', config.bookmarks[index]);
        res.json(config.bookmarks[index]);
      } else {
        res.status(500).json({ error: 'Failed to update bookmark' });
      }
    } else {
      res.status(404).json({ error: 'Bookmark not found' });
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