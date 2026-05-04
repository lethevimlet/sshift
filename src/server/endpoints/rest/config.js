/**
 * Config REST endpoints
 */

const { loadConfig, saveConfig } = require('../../utils/config');

const AUTH_WHITELIST = [
  '/api/auth/status',
  '/api/auth/login'
];

function registerConfigEndpoints(app, io) {
  app.get('/api/config', (req, res) => {
    const config = loadConfig();
    res.json({ 
      sticky: config.sticky !== false,
      takeControlDefault: config.takeControlDefault !== false,
      sshKeepaliveInterval: config.sshKeepaliveInterval || 10000,
      sshKeepaliveCountMax: config.sshKeepaliveCountMax || 1000,
      mobileKeysBarEnabled: config.mobileKeysBarEnabled !== false,
      webglRenderer: config.webglRenderer !== false,
      imageAddonEnabled: config.imageAddonEnabled !== false,
      layouts: config.layouts || null,
      passwordEnabled: !!config.passwordHash
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
    
    // Update mobile keys bar setting if provided
    if (req.body.hasOwnProperty('mobileKeysBarEnabled')) {
      config.mobileKeysBarEnabled = req.body.mobileKeysBarEnabled;
    }
    
    // Update WebGL renderer setting if provided
    if (req.body.hasOwnProperty('webglRenderer')) {
      config.webglRenderer = req.body.webglRenderer;
    }
    
    // Update image addon setting if provided
    if (req.body.hasOwnProperty('imageAddonEnabled')) {
      config.imageAddonEnabled = req.body.imageAddonEnabled;
    }
    
    // Save config
    const saved = saveConfig(config);
    if (saved) {
      res.json({ 
        success: true,
        sticky: config.sticky !== false,
        takeControlDefault: config.takeControlDefault !== false,
        sshKeepaliveInterval: config.sshKeepaliveInterval || 10000,
        sshKeepaliveCountMax: config.sshKeepaliveCountMax || 1000,
        mobileKeysBarEnabled: config.mobileKeysBarEnabled !== false,
        webglRenderer: config.webglRenderer !== false,
        imageAddonEnabled: config.imageAddonEnabled !== false
      });
    } else {
      res.status(500).json({ error: 'Failed to save config' });
    }
  });
}

module.exports = { registerConfigEndpoints };