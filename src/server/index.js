/**
 * Main server entry point
 * Refactored to use modular structure:
 * - utils: reusable logic (config, tab-manager, env-loader)
 * - services: business logic (ssh-manager, sftp-manager)
 * - endpoints: REST and WebSocket handlers
 */

// Load environment variables from .env files
require('./utils/env-loader');

const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const socketIO = require('socket.io');
const selfsigned = require('selfsigned');

// Import utilities
const { ensureConfig, loadConfig, getPort, getBindAddress, getEnableHttps, getDataDir } = require('./utils/config');

// Import services
const { sshManager, sftpManager } = require('./services');

// Import endpoints
const { rest, ws } = require('./endpoints');

const SSL_CERT_FILE = 'ssl-cert.pem';
const SSL_KEY_FILE = 'ssl-key.pem';

/**
 * Get SSL credentials, reusing persisted certificates if available.
 * Generates new self-signed certificates only if no persisted ones exist.
 * @returns {Promise<Object>} Certificate and private key
 */
async function getSSLCredentials() {
  const dataDir = getDataDir();
  const certPath = path.join(dataDir, SSL_CERT_FILE);
  const keyPath = path.join(dataDir, SSL_KEY_FILE);

  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    console.log('[HTTPS] Reusing persisted SSL certificate from', dataDir);
    try {
      return {
        cert: fs.readFileSync(certPath, 'utf8'),
        key: fs.readFileSync(keyPath, 'utf8')
      };
    } catch (err) {
      console.warn('[HTTPS] Failed to read persisted certificate, regenerating:', err.message);
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
    const attrs = [{ name: 'commonName', value: hostname }];
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
let server;
let io; // Declare io at module level for exports
let sslCredentials = null;

// Async initialization function
async function initializeServer() {
  ensureConfig();

  if (enableHttps) {
    try {
      sslCredentials = await getSSLCredentials();
      server = https.createServer({
        key: sslCredentials.key,
        cert: sslCredentials.cert
      }, app);
      console.log('[HTTPS] HTTPS server created with self-signed certificate');
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
    // Increase ping timeout for sticky sessions
    // This prevents disconnection during temporary network issues
    pingTimeout: 60000, // 60 seconds (default 20s)
    pingInterval: 25000 // 25 seconds (default)
  });

  // Set the socket.io instance for services that need it
  sshManager.setIO(io);

  // Middleware
  app.use(express.json());

  // Serve static files from the webapp directory
  const webappPath = path.join(__dirname, '../webapp');
  app.use(express.static(webappPath));
  app.use('/js', express.static(path.join(webappPath, 'js')));
  app.use('/css', express.static(path.join(webappPath, 'css')));
  app.use('/libs', express.static(path.join(webappPath, 'libs')));
  app.use('/tests', express.static(path.join(webappPath, 'tests')));

  // Main route
  app.get('/', (req, res) => {
    res.sendFile(path.join(webappPath, 'index.html'));
  });

  // Register REST endpoints
  rest.registerAllRestEndpoints(app, io);

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Send current open tabs to new client
    const { getOpenTabs, getTabOrder, getCurrentTheme, getCurrentAccent } = require('./utils/tab-manager');
    const { getCurrentLayout } = require('./endpoints/ws/layout');
    
    const openTabs = getOpenTabs();
    const tabOrder = getTabOrder();
    const currentLayout = getCurrentLayout();
    const currentTheme = getCurrentTheme();
    const currentAccent = getCurrentAccent();
    
    // Exclude activeSockets (Set object) to avoid Socket.IO serialization issues
    const orderedTabs = tabOrder
      .filter(sessionId => openTabs.has(sessionId))
      .map(sessionId => {
        const tab = openTabs.get(sessionId);
        return {
          sessionId,
          name: tab.name,
          type: tab.type,
          connectionData: {
            host: tab.connectionData?.host,
            port: tab.connectionData?.port,
            username: tab.connectionData?.username,
            name: tab.connectionData?.name
            // Exclude password, privateKey, and other sensitive data
          },
          sticky: tab.sticky,
          panelId: tab.panelId || 'panel-0' // Include panel assignment
          // Exclude activeSockets (Set) to avoid serialization issues
        };
      });
    
    socket.emit('open-tabs', { 
      tabs: orderedTabs,
      layout: currentLayout,
      theme: currentTheme,
      accent: currentAccent
    });

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
    const protocol = enableHttps ? 'https' : 'http';
    console.log(`Web SSH/SFTP Client running at ${protocol}://${address}:${PORT}`);
    // OSC 8 hyperlink: ESC ] 8 ; ; URL BEL text ESC ] 8 ; ; BEL
    const ESC = '\x1b';
    console.log(`${ESC}]8;;${protocol}://${address}:${PORT}${ESC}\\Open in browser${ESC}]8;;${ESC}\\`);
    
    if (enableHttps) {
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