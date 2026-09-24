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
const { ensureLocalCertificates } = require('./utils/certs');
const httpolyglot = require('httpolyglot');

// Import utilities
const { ensureConfig, loadConfig, getPort, getBindAddress, getEnableHttps, getHttpRedirect, getCertPath, getKeyPath, getDataDir, isPasswordSet, USER_INSTALL_DIR, migrateLegacyPackageConfig } = require('./utils/config');

// Import services
const { sshManager, sftpManager } = require('./services');

// Import tab manager
const tabManager = require('./utils/tab-manager');

// Import plugin manager
const pluginManager = require('./plugins/plugin-manager');

// Import endpoints
const { rest, ws } = require('./endpoints');

/**
 * Get SSL credentials.
 *
 * Custom certPath/keyPath from config win. Otherwise a local CA and a
 * CA-signed server certificate are kept in the user-space data directory
 * (see utils/certs.js): the CA is created once and survives npm updates
 * and Docker recreation (when /data is a volume); the server certificate
 * is re-issued from it whenever it is missing, self-signed (pre-1.8.1
 * installs), expiring or no longer covers the current hostname/IPs.
 * @returns {Promise<Object>} Certificate chain and private key
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
      console.error('[HTTPS] Falling back to the local CA-signed certificate');
    }
  } else if (customCertPath || customKeyPath) {
    console.warn('[HTTPS] Both certPath and keyPath must be set in config. Only one was provided; falling back to the local CA-signed certificate.');
  }

  const dataDir = getDataDir();
  const result = await ensureLocalCertificates(dataDir, {
    log: msg => console.log('[HTTPS]', msg)
  });
  if (result.caCreated) {
    console.log('[HTTPS] NOTE: a new local CA was created. Devices that trusted the previous');
    console.log('[HTTPS]       self-signed certificate must install the new CA from /api/cert.');
  } else if (!result.certIssued) {
    console.log('[HTTPS] Reusing persisted local CA and server certificate from', dataDir);
  }
  return { cert: result.cert, key: result.key };
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
  // Rescue legacy package-directory configs BEFORE anything else: they
  // are destroyed by the next `npm install -g` (GUI update). Must run
  // before ensureConfig(), which would otherwise consider the package-
  // dir config "existing" and skip creating the durable user-space one.
  migrateLegacyPackageConfig();
  ensureConfig();

  if (enableHttps) {
    try {
      sslCredentials = await getSSLCredentials();

      if (enableHttpRedirect) {
        server = httpolyglot.createServer({
          key: sslCredentials.key,
          cert: sslCredentials.cert
        }, app);
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

  // HTTP to HTTPS redirect middleware (for dual-protocol httpolyglot server)
  if (enableHttpRedirect) {
    app.use((req, res, next) => {
      // The CA download must stay reachable over plain HTTP: a device that
      // does not trust the CA yet cannot fetch it over HTTPS without warnings.
      if (req.path === '/api/cert') return next();
      if (!req.socket.encrypted) {
        const host = req.headers.host ? req.headers.host.split(':')[0] : 'localhost';
        const port = getPort();
        return res.redirect(301, `https://${host}:${port}${req.url}`);
      }
      next();
    });
  }

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

    // Send current open tabs to new client.
    // NOTE: theme, accent and layout are deliberately NOT included —
    // they are per-device preferences stored in each browser's
    // localStorage (they survive server restarts and can differ per
    // device). Broadcasting them here used to clobber every new client's
    // own preference with the server's in-memory copy.
    const { getOpenTabs, getTabOrder, getActiveTabsByPanel } = require('./utils/tab-manager');
    
    const openTabs = getOpenTabs();
    const tabOrder = getTabOrder();
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
      activeTabsByPanel
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
      console.log('[HTTPS] Note: the certificate is issued by sshift\'s local CA. Browsers warn until that CA is trusted.');
      console.log('[HTTPS] Install the CA on each device once: download it from /api/cert (also over plain http://).');
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