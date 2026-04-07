/**
 * Config REST endpoints
 */

const { loadConfig, saveConfig } = require('../../utils/config');

/**
 * Register config endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerConfigEndpoints(app, io) {
  // API: Get config (for sticky sessions and SSH keepalive)
  app.get('/api/config', (req, res) => {
    const config = loadConfig();
    res.json({ 
      sticky: config.sticky !== false, // Default to true
      takeControlDefault: config.takeControlDefault !== false, // Default to true
      sshKeepaliveInterval: config.sshKeepaliveInterval || 10000,
      sshKeepaliveCountMax: config.sshKeepaliveCountMax || 1000,
      mobileKeysBarEnabled: config.mobileKeysBarEnabled !== false, // Default to true
      layouts: config.layouts || null // Include layouts if defined in config
    });
  });

  // API: Update config
  app.post('/api/config', (req, res) => {
    const config = loadConfig();
    
    // Update sticky setting if provided
    if (req.body.hasOwnProperty('sticky')) {
      config.sticky = req.body.sticky;
    }
    
    // Update takeControlDefault setting if provided
    if (req.body.hasOwnProperty('takeControlDefault')) {
      config.takeControlDefault = req.body.takeControlDefault;
    }
    
    // Update SSH keepalive settings if provided
    if (req.body.hasOwnProperty('sshKeepaliveInterval')) {
      config.sshKeepaliveInterval = parseInt(req.body.sshKeepaliveInterval) || 10000;
    }
    
    if (req.body.hasOwnProperty('sshKeepaliveCountMax')) {
      config.sshKeepaliveCountMax = parseInt(req.body.sshKeepaliveCountMax) || 1000;
    }
    
    // Save config
    const saved = saveConfig(config);
    if (saved) {
      res.json({ 
        success: true,
        sticky: config.sticky !== false,
        takeControlDefault: config.takeControlDefault !== false,
        sshKeepaliveInterval: config.sshKeepaliveInterval || 10000,
        sshKeepaliveCountMax: config.sshKeepaliveCountMax || 1000
      });
    } else {
      res.status(500).json({ error: 'Failed to save config' });
    }
  });
}

module.exports = { registerConfigEndpoints };