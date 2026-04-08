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
const path = require('path');
const socketIO = require('socket.io');

// Import utilities
const { loadConfig, getPort, getBindAddress } = require('./utils/config');

// Import services
const { sshManager, sftpManager } = require('./services');

// Import endpoints
const { rest, ws } = require('./endpoints');

// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
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
  console.log(`Web SSH/SFTP Client running at http://${address}:${PORT}`);
  // OSC 8 hyperlink: ESC ] 8 ; ; URL BEL text ESC ] 8 ; ; BEL
  const ESC = '\x1b';
  console.log(`${ESC}]8;;http://${address}:${PORT}${ESC}\\Open in browser${ESC}]8;;${ESC}\\`);
});

// Export for testing
module.exports = { app, server, io };