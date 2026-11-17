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
      scrollback: config.scrollback || 10000,
      mobileKeysBarEnabled: config.mobileKeysBarEnabled !== false,
      webglRenderer: config.webglRenderer !== false,
      imageAddonEnabled: config.imageAddonEnabled !== false,
      layouts: config.layouts || null,
      passwordEnabled: !!config.passwordHash,
      bookmarkEncryptionEnabled: config.bookmarkEncryptionEnabled === true
    });
  });

  // API: Update config
  app.post('/api/config', (req, res) => {
    const config = loadConfig();
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    // Booleans must be booleans: the string "false" used to be stored and
    // then read as enabled.
    const bool = (v) => v === true || v === 'true';
    const int = (v, min, max, fallback) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
    };

    for (const key of ['sticky', 'takeControlDefault', 'mobileKeysBarEnabled', 'webglRenderer', 'imageAddonEnabled']) {
      if (has(key)) config[key] = bool(body[key]);
    }
    // 1 s .. 10 min between SSH keepalives; 1 .. 10000 unanswered ones.
    if (has('sshKeepaliveInterval')) {
      config.sshKeepaliveInterval = int(body.sshKeepaliveInterval, 1000, 600000, 10000);
    }
    if (has('sshKeepaliveCountMax')) {
      config.sshKeepaliveCountMax = int(body.sshKeepaliveCountMax, 1, 10000, 1000);
    }
    if (has('scrollback')) {
      config.scrollback = int(body.scrollback, 0, 100000, 10000);
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
        scrollback: config.scrollback || 10000,
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
