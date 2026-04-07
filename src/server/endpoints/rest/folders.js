/**
 * Folder REST endpoints
 */

const { loadConfig, saveConfig } = require('../../utils/config');

/**
 * Register folder endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerFolderEndpoints(app, io) {
  // API: Get folders
  app.get('/api/folders', (req, res) => {
    const config = loadConfig();
    res.json(config.folders || []);
  });

  // API: Add folder
  app.post('/api/folders', (req, res) => {
    const config = loadConfig();
    const folder = {
      id: Date.now().toString(),
      name: req.body.name,
      icon: req.body.icon || 'folder',
      expanded: true
    };
    if (!config.folders) {
      config.folders = [];
    }
    config.folders.push(folder);
    if (saveConfig(config)) {
      // Broadcast to all clients
      io.emit('folder-added', folder);
      res.json(folder);
    } else {
      res.status(500).json({ error: 'Failed to save folder' });
    }
  });

  // API: Update folder
  app.put('/api/folders/:id', (req, res) => {
    const config = loadConfig();
    if (!config.folders) {
      config.folders = [];
    }
    const index = config.folders.findIndex(f => f.id === req.params.id);
    if (index !== -1) {
      config.folders[index] = {
        ...config.folders[index],
        ...req.body,
        id: req.params.id
      };
      if (saveConfig(config)) {
        // Broadcast to all clients
        io.emit('folder-updated', config.folders[index]);
        res.json(config.folders[index]);
      } else {
        res.status(500).json({ error: 'Failed to update folder' });
      }
    } else {
      res.status(404).json({ error: 'Folder not found' });
    }
  });

  // API: Delete folder
  app.delete('/api/folders/:id', (req, res) => {
    const config = loadConfig();
    if (!config.folders) {
      config.folders = [];
    }
    config.folders = config.folders.filter(f => f.id !== req.params.id);
    // Move bookmarks from deleted folder to root (no folderId)
    config.bookmarks = config.bookmarks.map(b => {
      if (b.folderId === req.params.id) {
        const { folderId, ...rest } = b;
        return rest;
      }
      return b;
    });
    if (saveConfig(config)) {
      // Broadcast to all clients
      io.emit('folder-deleted', { id: req.params.id });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete folder' });
    }
  });

  // API: Save folder order
  app.post('/api/folders/order', (req, res) => {
    const config = loadConfig();
    config.folderOrder = req.body.order;
    if (saveConfig(config)) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save folder order' });
    }
  });

  // API: Get folder order
  app.get('/api/folders/order', (req, res) => {
    const config = loadConfig();
    res.json(config.folderOrder || []);
  });

  // API: Save folder expanded states
  app.post('/api/folders/expanded', (req, res) => {
    const config = loadConfig();
    config.folderExpandedStates = req.body.states;
    if (saveConfig(config)) {
      // Broadcast to all clients
      io.emit('folder-expanded-states', { states: req.body.states });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to save folder expanded states' });
    }
  });

  // API: Get folder expanded states
  app.get('/api/folders/expanded', (req, res) => {
    const config = loadConfig();
    res.json(config.folderExpandedStates || {});
  });
}

module.exports = { registerFolderEndpoints };