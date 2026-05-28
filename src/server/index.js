/**
 * Main server entry point
 * Refactored to use modular structure:
 * - utils: reusable logic (config, tab-manager, env-loader)
 * - services: business logic (ssh-manager, sftp-manager)
 * - endpoints: REST and WebSocket handlers
 */

// Polyfill: util.isDate was removed in Node.js 24+ but ssh2 still depends on it
const util = require('util');
if (typeof util.isDate !== 'function') {
  util.isDate = (d) => d instanceof Date;
}

// Load environment variables from .env files
require('./utils/env-loader');

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const socketIO = require('socket.io');
const selfsigned = require('selfsigned');
const httpolyglot = require('httpolyglot');

// Import utilities
const { ensureConfig, loadConfig, getPort, getBindAddress, getEnableHttps, getHttpRedirect, getCertPath, getKeyPath, getDataDir, getLegacyDataDir, isPasswordSet, USER_INSTALL_DIR } = require('./utils/config');

// Import services
const { sshManager, sftpManager } = require('./services');

// Import tab manager
const tabManager = require('./utils/tab-manager');

// Import plugin manager
const pluginManager = require('./plugins/plugin-manager');

// Import endpoints
const { rest, ws } = require('./endpoints');

const SSL_CERT_FILE = 'ssl-cert.pem';
const SSL_KEY_FILE = 'ssl-key.pem';

/**
 * Get SSL credentials, reusing persisted certificates if available.
 * Generates new self-signed certificates only if no persisted ones exist.
 * Migrates certs from package directory to user-space directory if needed.
 * @returns {Promise<Object>} Certificate and private key
 */
async function getSSLCredentials() {
  const customCertPath = getCertPath();
  const customKeyPath = getKeyPath();

  if (customCertPath && customKeyPath) {
    console.log('[HTTPS] Using custom certificate from config:');
    console.log('[HTTPS]   Cert:', customCertPath);
    console.log('[HTTPS]   Key:', customKeyPath);
    try {
      return {
        cert: fs.readFileSync(customCertPath, 'utf8'),
        key: fs.readFileSync(customKeyPath, 'utf8')
      };
    } catch (err) {
      console.error('[HTTPS] Failed to read custom certificate files:', err.message);
      console.error('[HTTPS] Falling back to self-signed certificate');
    }
  } else if (customCertPath || customKeyPath) {
    console.warn('[HTTPS] Both certPath and keyPath must be set in config. Only one was provided; falling back to self-signed certificate.');
  }

  const dataDir = getDataDir();
  const certPath = path.join(dataDir, SSL_CERT_FILE);
  const keyPath = path.join(dataDir, SSL_KEY_FILE);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('[HTTPS] Reusing persisted SSL certificate from', dataDir);
    try {
      const cert = fs.readFileSync(certPath, 'utf8');
      const key = fs.readFileSync(keyPath, 'utf8');
      if (!certIncludesOrg(cert)) {
        console.log('[HTTPS] Existing certificate lacks organizationName, regenerating...');
      } else {
        return { cert, key };
      }
    } catch (err) {
      console.warn('[HTTPS] Failed to read persisted certificate, regenerating:', err.message);
    }
  } else {
    // Migrate from legacy (package) directory if certs exist there
    const legacyDir = getLegacyDataDir();
    if (legacyDir) {
      const legacyCert = path.join(legacyDir, SSL_CERT_FILE);
      const legacyKey = path.join(legacyDir, SSL_KEY_FILE);
      if (fs.existsSync(legacyCert) && fs.existsSync(legacyKey)) {
        console.log('[HTTPS] Migrating SSL certificate from', legacyDir, 'to', dataDir);
        try {
          if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
          }
          const certData = fs.readFileSync(legacyCert, 'utf8');
          const keyData = fs.readFileSync(legacyKey, 'utf8');
          fs.writeFileSync(certPath, certData, { mode: 0o600 });
          fs.writeFileSync(keyPath, keyData, { mode: 0o600 });
          console.log('[HTTPS] SSL certificate migrated to user-space directory');
          if (certIncludesOrg(certData)) {
            return { cert: certData, key: keyData };
          }
          console.log('[HTTPS] Migrated certificate lacks organizationName, regenerating...');
        } catch (err) {
          console.warn('[HTTPS] Failed to migrate certificate:', err.message);
        }
      }
    }
  }

  const creds = await generateSelfSignedCert();

  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(certPath, creds.cert, { mode: 0o600 });
    fs.writeFileSync(keyPath, creds.key, { mode: 0o600 });
    console.log('[HTTPS] SSL certificate persisted to', dataDir);
  } catch (err) {
    console.warn('[HTTPS] Failed to persist certificate:', err.message);
  }

  return creds;
}

/**
 * Check if a PEM certificate includes an organizationName (O=) attribute.
 * @param {string} certPem - PEM-encoded certificate
 * @returns {boolean} True if O=sshift is present
 */
function certIncludesOrg(certPem) {
  try {
    const { X509Certificate } = require('crypto');
    const x509 = new X509Certificate(certPem);
    return /O=sshift/i.test(x509.subject);
  } catch {
    return false;
  }
}

/**
 * Generate self-signed SSL certificates using selfsigned package (pure JS, no OpenSSL dependency)
 * @returns {Promise<Object>} Certificate and private key
 */
async function generateSelfSignedCert() {
  console.log('[HTTPS] Generating self-signed certificate...');
  
  const os = require('os');
  
  const interfaces = os.networkInterfaces();
  const localIPs = ['127.0.0.1'];
  
  Object.values(interfaces).forEach(iface => {
    iface.forEach(addr => {
      if (addr.family === 'IPv4' && !addr.internal) {
        localIPs.push(addr.address);
      }
    });
  });
  
  const hostname = os.hostname() || 'localhost';
  
  console.log('[HTTPS] Certificate will be valid for:', localIPs.join(', '), 'and hostname:', hostname);
  
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 2, value: hostname },
    ...localIPs.map(ip => ({ type: 7, ip }))
  ];
  
  try {
    const attrs = [
      { name: 'commonName', value: hostname },
      { name: 'organizationName', value: 'sshift' }
    ];
    const pems = await selfsigned.generate(attrs, {
      days: 365,
      keySize: 2048,
      algorithm: 'sha256',
      extensions: [{
        name: 'subjectAltName',
        altNames
      }]
    });
    
    console.log('[HTTPS] Self-signed certificate generated successfully');
    return {
      cert: pems.cert,
      key: pems.private
    };
  } catch (err) {
    console.error('[HTTPS] Error generating certificate:', err);
    throw err;
  }
}

// Create Express app
const app = express();

// Determine if HTTPS should be enabled
const enableHttps = getEnableHttps();
const enableHttpRedirect = enableHttps && getHttpRedirect();
let server;
let io;
let sslCredentials = null;
let actuallyHttps = false;

// Async initialization function
async function initializeServer() {
  ensureConfig();

  if (enableHttps) {
    try {
      sslCredentials = await getSSLCredentials();

      if (enableHttpRedirect) {
        server = httpolyglot.createServer({
          key: sslCredentials.key,
          cert: sslCredentials.cert
        }, app);
        server.on('request', (req, res) => {
          if (!req.socket.encrypted) {
            const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
            const port = getPort();
            res.writeHead(301, { Location: `https://${host}:${port}${req.url}` });
            res.end();
          }
        });
        actuallyHttps = true;
        console.log('[HTTPS] HTTPS server created with HTTP redirect enabled (dual-protocol)');
      } else {
        server = https.createServer({
          key: sslCredentials.key,
          cert: sslCredentials.cert
        }, app);
        actuallyHttps = true;
        console.log('[HTTPS] HTTPS server created with self-signed certificate');
      }
    } catch (err) {
      console.error('[HTTPS] Failed to create HTTPS server, falling back to HTTP:', err.message);
      server = http.createServer(app);
    }
  } else {
    server = http.createServer(app);
    console.log('[HTTP] HTTP server created (HTTPS disabled)');
  }

  io = socketIO(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    pingTimeout: 60000,
    pingInterval: 25000,
    maxHttpBufferSize: 5e6
  });

  // Socket.IO auth middleware
  io.use((socket, next) => {
    if (!isPasswordSet()) return next();
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (isValidAuthToken(token)) return next();
    next(new Error('Authentication required'));
  });

  // Set the socket.io instance for services that need it
  sshManager.setIO(io);

  // Initialize plugin system
  const config = loadConfig();
  pluginManager.init({
    io,
    sshManager,
    tabManager,
    config,
  });

  // Middleware
  app.use(express.json());

  // Auth middleware - block API endpoints when password is set
  const { isValidAuthToken } = require('./endpoints/rest/auth');
  const AUTH_WHITELIST = ['/auth/status', '/auth/login', '/cert', '/security-info', '/version', '/update-status'];

  app.use('/api', (req, res, next) => {
    if (AUTH_WHITELIST.some(p => req.path === p)) return next();
    if (!isPasswordSet()) return next();
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (isValidAuthToken(token)) return next();
    res.status(401).json({ error: 'Authentication required' });
  });

  app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) return next();
    next();
  });

  const webappPath = path.join(__dirname, '../webapp');

  // Service Worker script - must be served from root with proper headers
  // MUST come before express.static so version placeholders are replaced
  // and no-cache headers are set. Without this, express.static serves
  // the raw file with __VERSION__ unreplaced and default cache headers,
  // completely breaking cache busting on updates.
  app.get('/sw.js', (req, res) => {
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Service-Worker-Allowed', '/');
    const swPath = path.join(webappPath, 'sw.js');
    fs.readFile(swPath, 'utf8', (err, data) => {
      if (err) return res.status(500).send('/* SW load error */');
      const version = require(path.join(__dirname, '../../package.json')).version;
      res.send(data.replace(/__VERSION__/g, version));
    });
  });

  // Main route - no-cache so browser always checks for updates
  // MUST come before express.static so version placeholders are replaced
  // and no-cache headers are set. Without this, express.static serves
  // the raw index.html with __VERSION__ unreplaced.
  app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    const htmlPath = path.join(webappPath, 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) return res.status(500).send('Error loading page');
      const version = require(path.join(__dirname, '../../package.json')).version;
      res.send(data.replace(/__VERSION__/g, version));
    });
  });

  // Serve static files from the webapp directory
  // These come AFTER the custom / and /sw.js handlers so those routes
  // can set proper cache headers and replace version placeholders.
  app.use(express.static(webappPath, {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      } else if (filePath.endsWith('.js') || filePath.endsWith('.css')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    }
  }));
  app.use('/js', express.static(path.join(webappPath, 'js'), {
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  app.use('/css', express.static(path.join(webappPath, 'css'), {
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  app.use('/libs', express.static(path.join(webappPath, 'libs'), {
    maxAge: '1d',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  app.use('/tests', express.static(path.join(webappPath, 'tests')));

  // Register REST endpoints
  rest.registerAllRestEndpoints(app, io);

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send current open tabs to new client
    const { getOpenTabs, getTabOrder, getCurrentTheme, getCurrentAccent, getActiveTabsByPanel } = require('./utils/tab-manager');
    const { getCurrentLayout } = require('./endpoints/ws/layout');
    
    const openTabs = getOpenTabs();
    const tabOrder = getTabOrder();
    const currentLayout = getCurrentLayout();
    const currentTheme = getCurrentTheme();
    const currentAccent = getCurrentAccent();
    const activeTabsByPanelMap = getActiveTabsByPanel();
    const activeTabsByPanel = Object.fromEntries(activeTabsByPanelMap);
    
    // Build ordered tabs and default active tab per panel if not tracked yet.
    // When a panel has no recorded active tab (e.g. server restart), the first
    // tab in that panel becomes active.
    const tabsByPanel = {};
    const orderedTabs = tabOrder
      .filter(sessionId => openTabs.has(sessionId))
      .map(sessionId => {
        const tab = openTabs.get(sessionId);
        const panelId = tab.panelId || 'panel-0';
        if (!tabsByPanel[panelId]) tabsByPanel[panelId] = [];
        tabsByPanel[panelId].push(sessionId);
        return {
          sessionId,
          name: tab.name,
          type: tab.type,
          connectionData: {
            host: tab.connectionData?.host,
            port: tab.connectionData?.port,
            username: tab.connectionData?.username,
            name: tab.connectionData?.name
          },
          sticky: tab.sticky,
          panelId,
          active: false // set below
        };
      });
    
    // Determine active tab per panel: use tracked active, or default to first tab
    for (const [panelId, sessionIds] of Object.entries(tabsByPanel)) {
      const tracked = activeTabsByPanelMap.get(panelId);
      const activeId = (tracked && sessionIds.includes(tracked)) ? tracked : sessionIds[0];
      if (activeId) activeTabsByPanel[panelId] = activeId;
    }
    
    // Mark active tab in orderedTabs
    orderedTabs.forEach(tab => {
      tab.active = activeTabsByPanel[tab.panelId] === tab.sessionId;
    });
    
    socket.emit('open-tabs', { 
      tabs: orderedTabs,
      layout: currentLayout,
      activeTabsByPanel,
      theme: currentTheme,
      accent: currentAccent
    });

    // Sync flash state for tabs that need attention
    pluginManager.syncFlashState(socket);

    // Register all WebSocket handlers
    ws.registerAllWSHandlers(socket, io);

    // Handle disconnect
    socket.on('disconnect', () => {
      ws.handleDisconnect(socket, io);
    });
  });

  // Start server
  const PORT = getPort();
  const BIND = getBindAddress();

  server.listen(PORT, BIND, () => {
    const address = BIND === '0.0.0.0' || BIND === '::' ? 'localhost' : BIND;
    const protocol = actuallyHttps ? 'https' : 'http';
    console.log(`Web SSH/SFTP Client running at ${protocol}://${address}:${PORT}`);
    // OSC 8 hyperlink: ESC ] 8 ; ; URL BEL text ESC ] 8 ; ; BEL
    const ESC = '\x1b';
    console.log(`${ESC}]8;;${protocol}://${address}:${PORT}${ESC}\\Open in browser${ESC}]8;;${ESC}\\`);
    
if (actuallyHttps) {
      console.log('[HTTPS] Note: Using self-signed certificate. Your browser may show a security warning.');
      console.log('[HTTPS] For mobile devices, you may need to accept the certificate warning to use native text selection.');
    }
  });
}

// Start the server
initializeServer().catch(err => {
  console.error('Failed to initialize server:', err);
  process.exit(1);
});

// Export for testing
module.exports = { app, server, io };