// Load environment variables from .env files
// Priority: .env/.env.local > .env.local > .env/.env > .env
const path = require('path');
const fs = require('fs');

// Load .env files in priority order (highest priority first)
const envPaths = [
  path.join(__dirname, '.env', '.env.local'),
  path.join(__dirname, '.env.local'),
  path.join(__dirname, '.env', '.env'),
  path.join(__dirname, '.env')
];

envPaths.forEach(envPath => {
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
});

const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const sshManager = require('./ssh-manager');
const sftpManager = require('./sftp-manager');

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

// Config paths - try .env/config.json first, then fall back to root config.json
const ENV_CONFIG_PATH = path.join(__dirname, '.env', 'config.json');
const ROOT_CONFIG_PATH = path.join(__dirname, 'config.json');

// Track open tabs across all clients
const openTabs = new Map(); // sessionId -> { name, type, connectionData, activeSockets: Set }
let tabOrder = []; // Array of sessionIds in order
let currentLayout = 'single'; // Current active layout for sync

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default config structure
const defaultConfig = {
  port: 8022,
  devPort: 3000,
  bind: '0.0.0.0',
  sticky: true,
  sshKeepaliveInterval: 10000,
  sshKeepaliveCountMax: 1000,
  bookmarks: [],
  folders: []
};

// Get config path (prioritize .env/config.json)
function getConfigPath() {
  if (fs.existsSync(ENV_CONFIG_PATH)) {
    console.log('[CONFIG] Using .env/config.json');
    return ENV_CONFIG_PATH;
  }
  console.log('[CONFIG] Using root config.json');
  return ROOT_CONFIG_PATH;
}

// Load config
function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return { ...defaultConfig };
}

// Save config
function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving config:', err);
    return false;
  }
}

// Determine port with priority: PORT env var > config > defaults
function getPort() {
  // Priority 1: PORT environment variable (highest priority)
  if (process.env.PORT) {
    return parseInt(process.env.PORT, 10);
  }
  
  // Priority 2: Check if running in dev mode
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('dev');
  
  // Priority 3: Load from config
  const config = loadConfig();
  
  if (isDev) {
    return config.devPort || 3000;
  }
  
  return config.port || 8022;
}

// Determine bind address with priority: BIND env var > config > defaults
function getBindAddress() {
  // Priority 1: BIND environment variable (highest priority)
  if (process.env.BIND) {
    return process.env.BIND;
  }
  
  // Priority 2: Load from config
  const config = loadConfig();
  
  // Priority 3: Default
  return config.bind || '0.0.0.0';
}

const PORT = getPort();
const BIND = getBindAddress();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Get bookmarks
app.get('/api/bookmarks', (req, res) => {
  const config = loadConfig();
  res.json(config.bookmarks);
});

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

// API: Get active sessions
app.get('/api/sessions', (req, res) => {
  const sessions = [];
  
  // Get SSH sessions from ssh-manager
  const sshSessions = sshManager.getActiveSessions();
  for (const [sessionId, session] of sshSessions) {
    const tab = openTabs.get(sessionId);
    sessions.push({
      id: sessionId,
      type: 'ssh',
      name: tab?.name || session.host || 'Unknown',
      host: session.host,
      port: session.port,
      username: session.username,
      connectedAt: session.connectedAt,
      activeSockets: tab?.activeSockets?.size || 0,
      controllerSocket: session.controllerSocket
    });
  }
  
  // Get SFTP sessions from sftp-manager
  const sftpSessions = sftpManager.getActiveSessions();
  for (const [sessionId, session] of sftpSessions) {
    const tab = openTabs.get(sessionId);
    sessions.push({
      id: sessionId,
      type: 'sftp',
      name: tab?.name || session.host || 'Unknown',
      host: session.host,
      port: session.port,
      username: session.username,
      connectedAt: session.connectedAt,
      activeSockets: tab?.activeSockets?.size || 0
    });
  }
  
  res.json(sessions);
});

// API: Close a specific session
app.delete('/api/sessions/:id', (req, res) => {
  const sessionId = req.params.id;
  const tab = openTabs.get(sessionId);
  
  if (!tab) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  console.log('[API] Force closing session:', sessionId);
  
  // Disconnect the session
  if (tab.type === 'ssh') {
    sshManager.disconnect(sessionId);
  } else if (tab.type === 'sftp') {
    sftpManager.disconnect(sessionId);
  }
  
  // Remove from openTabs
  openTabs.delete(sessionId);
  tabOrder = tabOrder.filter(id => id !== sessionId);
  
  // Broadcast to all clients that the session was closed
  io.emit('tab-closed', { sessionId });
  
  res.json({ success: true, sessionId });
});

// API: Close all sessions
app.post('/api/sessions/close-all', (req, res) => {
  console.log('[API] Force closing all sessions');
  
  const closedSessions = [];
  
  for (const [sessionId, tab] of openTabs) {
    // Disconnect the session
    if (tab.type === 'ssh') {
      sshManager.disconnect(sessionId);
    } else if (tab.type === 'sftp') {
      sftpManager.disconnect(sessionId);
    }
    
    closedSessions.push(sessionId);
    
    // Broadcast to all clients
    io.emit('tab-closed', { sessionId });
  }
  
  // Clear all tabs
  openTabs.clear();
  tabOrder = [];
  
  res.json({ success: true, closedCount: closedSessions.length });
});

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

// API: Get version
app.get('/api/version', (req, res) => {
  try {
    const packagePath = path.join(__dirname, 'package.json');
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    res.json({ version: packageData.version });
  } catch (err) {
    console.error('Error reading version:', err);
    res.status(500).json({ error: 'Failed to read version' });
  }
});

// API: Check for updates
app.get('/api/check-update', async (req, res) => {
  try {
    const https = require('https');
    
    // Get local version
    const packagePath = path.join(__dirname, 'package.json');
    const packageData = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const localVersion = packageData.version;
    
    // Get remote version from GitHub
    const options = {
      hostname: 'api.github.com',
      path: '/repos/lethevimlet/sshift/contents/package.json',
      method: 'GET',
      headers: {
        'User-Agent': 'sshift-update-checker',
        'Accept': 'application/vnd.github.v3+json'
      }
    };
    
    const githubRequest = https.request(options, (githubResponse) => {
      let data = '';
      
      githubResponse.on('data', (chunk) => {
        data += chunk;
      });
      
      githubResponse.on('end', () => {
        try {
          if (githubResponse.statusCode !== 200) {
            console.error('GitHub API error:', githubResponse.statusCode, data);
            res.status(500).json({ error: 'Failed to check for updates' });
            return;
          }
          
          const response = JSON.parse(data);
          const content = Buffer.from(response.content, 'base64').toString('utf8');
          const remotePackage = JSON.parse(content);
          const remoteVersion = remotePackage.version;
          
          // Compare versions
          const compareVersions = (v1, v2) => {
            const parts1 = v1.split('.').map(Number);
            const parts2 = v2.split('.').map(Number);
            
            for (let i = 0; i < 3; i++) {
              if (parts1[i] < parts2[i]) return -1;
              if (parts1[i] > parts2[i]) return 1;
            }
            return 0;
          };
          
          const comparison = compareVersions(localVersion, remoteVersion);
          const updateAvailable = comparison < 0;
          
          res.json({
            localVersion,
            remoteVersion,
            updateAvailable,
            checkedAt: new Date().toISOString()
          });
        } catch (err) {
          console.error('Error parsing GitHub response:', err);
          res.status(500).json({ error: 'Failed to parse update information' });
        }
      });
    });
    
    githubRequest.on('error', (err) => {
      console.error('Error checking for updates:', err);
      res.status(500).json({ error: 'Failed to check for updates' });
    });
    
    githubRequest.end();
  } catch (err) {
    console.error('Error in check-update:', err);
    res.status(500).json({ error: 'Failed to check for updates' });
  }
});

// API: Get update status
app.get('/api/update-status', (req, res) => {
  const updateMarker = path.join(__dirname, '.updating');
  const restartMarker = path.join(__dirname, '.restart-after-update');
  
  // Read package.json for current version
  let version = 'unknown';
  try {
    const pkgPath = path.join(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    version = pkg.version;
  } catch (e) {
    console.error('[UPDATE] Failed to read version:', e.message);
  }
  
  // Check if we're in the middle of an update
  const isUpdating = fs.existsSync(updateMarker);
  const restartRequested = fs.existsSync(restartMarker);
  
  res.json({
    version,
    updating: isUpdating,
    restartRequested,
    ready: !isUpdating // Server is ready if not updating
  });
});

// API: Trigger update
app.post('/api/update', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const platform = process.platform;
    
    // Determine the install script based on platform
    let installScript;
    if (platform === 'win32') {
      installScript = path.join(__dirname, 'install.ps1');
    } else {
      installScript = path.join(__dirname, 'install.sh');
    }
    
    // Check if install script exists
    if (!fs.existsSync(installScript)) {
      res.status(500).json({ error: 'Install script not found' });
      return;
    }
    
    // Write update marker to indicate update in progress
    const updateMarker = path.join(__dirname, '.updating');
    try {
      fs.writeFileSync(updateMarker, JSON.stringify({
        startTime: Date.now(),
        oldVersion: require('./package.json').version
      }));
    } catch (e) {
      console.error('[UPDATE] Failed to write update marker:', e.message);
    }
    
    // Write a restart marker file to indicate we want to restart after update
    const restartMarker = path.join(__dirname, '.restart-after-update');
    try {
      fs.writeFileSync(restartMarker, 'true');
    } catch (e) {
      console.error('[UPDATE] Failed to write restart marker:', e.message);
    }
    
    // Send response immediately, then update in background
    res.json({ message: 'Update started. Server will restart automatically.' });
    
    // Execute update script with --update flag (detached from parent process)
    const updateCommand = platform === 'win32' 
      ? `powershell.exe -ExecutionPolicy Bypass -File "${installScript}" --update`
      : `"${installScript}" --update`;
    
    console.log('[UPDATE] Starting update process...');
    
    // Wait for response to be sent before spawning update process
    res.on('finish', () => {
      // Use spawn with detached mode to allow the update script to continue after parent exits
      const updateProcess = spawn(updateCommand, [], {
        cwd: __dirname,
        shell: true,
        detached: true,
        stdio: 'ignore'
      });
      
      // Unref the child process so the parent can exit without waiting for it
      updateProcess.unref();
      
      // Give the update script a moment to start
      setTimeout(() => {
        // Exit immediately to allow the update script to manage the restart
        console.log('[UPDATE] Exiting for update...');
        process.exit(0);
      }, 500);
    });
  } catch (err) {
    console.error('Error triggering update:', err);
    res.status(500).json({ error: 'Failed to trigger update' });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Send current open tabs to new client
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
        sticky: tab.sticky
        // Exclude activeSockets (Set) to avoid serialization issues
      };
    });
  
  socket.emit('open-tabs', { 
    tabs: orderedTabs,
    layout: currentLayout
  });

  // SSH connection
  socket.on('ssh-connect', async (data) => {
    console.log('[SSH] ssh-connect event received:', JSON.stringify({
      sessionId: data.sessionId,
      host: data.host,
      port: data.port,
      username: data.username,
      hasPassword: !!data.password,
      hasPrivateKey: !!data.privateKey
    }));
    
    try {
      // Get SSH keepalive settings from config
      const config = loadConfig();
      const sshKeepaliveInterval = config.sshKeepaliveInterval || 10000;
      const sshKeepaliveCountMax = config.sshKeepaliveCountMax || 1000;
      
      // Pass keepalive settings to SSH manager
      const connectionData = {
        ...data,
        sshKeepaliveInterval,
        sshKeepaliveCountMax
      };
      
      const sessionId = await sshManager.connect(socket, connectionData);
      console.log('[SSH] Connection successful, emitting ssh-connected for:', sessionId);
      
      // Get sticky from config
      const sticky = config.sticky !== false; // Default to true
      
      // Track this tab
      openTabs.set(sessionId, {
        name: data.name || 'SSH',
        type: 'ssh',
        connectionData: data,
        activeSockets: new Set([socket.id]),
        sticky: sticky
      });
      
      // Add to tab order if not already present
      if (!tabOrder.includes(sessionId)) {
        tabOrder.push(sessionId);
      }
      
      // Broadcast to all clients that a new tab was opened
      io.emit('tab-opened', {
        sessionId,
        name: data.name || 'SSH',
        type: 'ssh',
        connectionData: data
      });
      
      socket.emit('ssh-connected', { sessionId });
    } catch (err) {
      console.error('[SSH] Connection failed:', err.message);
      socket.emit('ssh-error', { message: err.message, sessionId: data.sessionId });
    }
  });

  // SSH join existing session
  socket.on('ssh-join', (data) => {
    console.log('[SSH] ssh-join event received for session:', data.sessionId);
    const success = sshManager.joinSession(socket, data.sessionId);
    if (success) {
      // Add this socket to the tab's active sockets
      const tab = openTabs.get(data.sessionId);
      if (tab) {
        tab.activeSockets.add(socket.id);
      }
      // Note: ssh-joined is emitted by joinSession() with noTerminalState flag
    } else {
      socket.emit('ssh-error', { message: 'Session not found', sessionId: data.sessionId });
    }
  });

  // SSH request screen sync (for manual refresh or reconnection)
  socket.on('ssh-request-sync', (data) => {
    console.log('[SSH] ssh-request-sync event received for session:', data.sessionId);
    const state = sshManager.getTerminalState(data.sessionId);
    if (state) {
      socket.emit('ssh-screen-sync', {
        sessionId: data.sessionId,
        state: state.state,
        cols: state.cols,
        rows: state.rows
      });
    } else {
      socket.emit('ssh-error', { message: 'Session not found', sessionId: data.sessionId });
    }
  });

  // SSH data (user input)
  socket.on('ssh-data', (data) => {
    // Only allow input from the controller
    if (!sshManager.isController(socket.id, data.sessionId)) {
      console.log(`[SSH] Ignoring input from non-controller socket ${socket.id}`);
      return;
    }
    sshManager.write(data.sessionId, data.data);
  });

  // SSH take control
  socket.on('ssh-take-control', (data) => {
    console.log(`[SSH] Socket ${socket.id} requesting control of session ${data.sessionId}`);
    const result = sshManager.takeControl(socket, data.sessionId);
    
    if (result.success) {
      // Send success response to the requesting client with terminal dimensions
      socket.emit('ssh-control-acquired', {
        sessionId: data.sessionId,
        cols: result.cols,
        rows: result.rows
      });
    } else {
      socket.emit('ssh-error', { 
        sessionId: data.sessionId, 
        message: result.error || 'Failed to take control' 
      });
    }
  });

  // SSH release control
  socket.on('ssh-release-control', (data) => {
    console.log(`[SSH] Socket ${socket.id} releasing control of session ${data.sessionId}`);
    sshManager.releaseControl(socket, data.sessionId);
  });

  // SSH resize
  socket.on('ssh-resize', (data) => {
    // Only allow resize from the controller
    if (!sshManager.isController(socket.id, data.sessionId)) {
      console.log(`[SSH] Ignoring resize from non-controller socket ${socket.id}`);
      return;
    }
    sshManager.resize(data.sessionId, data.cols, data.rows);
    
    // Broadcast resize to all other clients in the session
    // This ensures all clients stay in sync with the server terminal size
    socket.to(`session-${data.sessionId}`).emit('ssh-resize-sync', {
      sessionId: data.sessionId,
      cols: data.cols,
      rows: data.rows
    });
  });

  // SSH disconnect
  socket.on('ssh-disconnect', (data) => {
    sshManager.disconnect(data.sessionId);
    
    // Remove from open tabs and order
    openTabs.delete(data.sessionId);
    tabOrder = tabOrder.filter(id => id !== data.sessionId);
    
    // Broadcast to all clients that tab was closed
    io.emit('tab-closed', { sessionId: data.sessionId });
  });

  // Tab close event (client-side tab close, not full disconnect)
  socket.on('tab-close', (data) => {
    console.log('[TAB] Tab closed:', data.sessionId, 'by socket:', socket.id);
    
    // Remove this socket from the tab's active sockets
    const tab = openTabs.get(data.sessionId);
    if (tab) {
      tab.activeSockets.delete(socket.id);
      
      // When user explicitly closes a tab, close the session immediately
      // regardless of sticky setting (user intent is to close)
      if (tab.activeSockets.size === 0) {
        // Clear any existing close timer
        if (tab.closeTimer) {
          clearTimeout(tab.closeTimer);
        }
        
        console.log('[TAB] Tab explicitly closed by user, closing session:', data.sessionId);
        
        // Close the session immediately
        if (tab.type === 'ssh') {
          sshManager.disconnect(data.sessionId);
        } else if (tab.type === 'sftp') {
          sftpManager.disconnect(data.sessionId);
        }
        openTabs.delete(data.sessionId);
        tabOrder = tabOrder.filter(id => id !== data.sessionId);
        
        // Broadcast to all clients that tab was closed
        io.emit('tab-closed', { sessionId: data.sessionId });
      }
    } else {
      // Broadcast to all clients that tab was closed
      io.emit('tab-closed', { sessionId: data.sessionId });
    }
  });

  // Tab reorder event
  socket.on('tab-reorder', (data) => {
    console.log('[TAB] Tab reorder:', data.order);
    tabOrder = data.order;
    
    // Broadcast new order to all other clients
    socket.broadcast.emit('tab-order', { order: tabOrder });
  });

  // Tab rename - sync across all sessions
  socket.on('tab-rename', (data) => {
    console.log('[TAB] Tab rename:', data.sessionId, 'to', data.name);
    
    // Update the tab name in openTabs
    const tab = openTabs.get(data.sessionId);
    if (tab) {
      tab.name = data.name;
      openTabs.set(data.sessionId, tab);
    }
    
    // Broadcast rename to all other clients
    socket.broadcast.emit('tab-renamed', { 
      sessionId: data.sessionId, 
      name: data.name 
    });
  });

  // Layout change - sync across all sessions
  socket.on('layout-change', (data) => {
    console.log('[LAYOUT] Layout change:', data.layoutId);
    currentLayout = data.layoutId;
    
    // Broadcast to all other clients
    socket.broadcast.emit('layout-changed', { layoutId: data.layoutId });
  });

  // SFTP connection
  socket.on('sftp-connect', async (data) => {
    try {
      console.log('[SFTP] Received sftp-connect with sessionId:', data.sessionId);
      
      // Get SSH keepalive settings from config
      const config = loadConfig();
      const sshKeepaliveInterval = config.sshKeepaliveInterval || 10000;
      const sshKeepaliveCountMax = config.sshKeepaliveCountMax || 1000;
      
      // Pass keepalive settings to SFTP manager
      const connectionData = {
        ...data,
        sshKeepaliveInterval,
        sshKeepaliveCountMax
      };
      
      const sessionId = await sftpManager.connect(socket, connectionData);
      console.log('[SFTP] Emitting sftp-connected with sessionId:', sessionId);
      
      // Get sticky from config
      const sticky = config.sticky !== false; // Default to true
      
      // Track this tab
      openTabs.set(sessionId, {
        name: data.name || 'SFTP',
        type: 'sftp',
        connectionData: data,
        activeSockets: new Set([socket.id]),
        sticky: sticky
      });
      
      // Add to tab order if not already present
      if (!tabOrder.includes(sessionId)) {
        tabOrder.push(sessionId);
      }
      
      // Broadcast to all clients that a new tab was opened
      io.emit('tab-opened', {
        sessionId,
        name: data.name || 'SFTP',
        type: 'sftp',
        connectionData: data
      });
      
      socket.emit('sftp-connected', { sessionId });
    } catch (err) {
      console.error('[SFTP] Error in sftp-connect:', err.message);
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP list directory
  socket.on('sftp-list', async (data) => {
    try {
      console.log('[SFTP] Received sftp-list for sessionId:', data.sessionId, 'path:', data.path);
      const files = await sftpManager.list(data.sessionId, data.path);
      console.log('[SFTP] Emitting sftp-list-result for sessionId:', data.sessionId, 'files:', files.length);
      socket.emit('sftp-list-result', { path: data.path, files, sessionId: data.sessionId });
    } catch (err) {
      console.error('[SFTP] Error in sftp-list:', err.message);
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP download
  socket.on('sftp-download', async (data) => {
    try {
      const fileData = await sftpManager.download(data.sessionId, data.path);
      socket.emit('sftp-download-result', { path: data.path, data: fileData.toString('base64') });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP upload
  socket.on('sftp-upload', async (data) => {
    try {
      await sftpManager.upload(data.sessionId, data.path, Buffer.from(data.data, 'base64'));
      socket.emit('sftp-upload-result', { path: data.path, success: true });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP mkdir
  socket.on('sftp-mkdir', async (data) => {
    try {
      await sftpManager.mkdir(data.sessionId, data.path);
      socket.emit('sftp-mkdir-result', { path: data.path, success: true });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP delete
  socket.on('sftp-delete', async (data) => {
    try {
      await sftpManager.delete(data.sessionId, data.path);
      socket.emit('sftp-delete-result', { path: data.path, success: true });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP rename
  socket.on('sftp-rename', async (data) => {
    try {
      await sftpManager.rename(data.sessionId, data.oldPath, data.newPath);
      socket.emit('sftp-rename-result', { 
        oldPath: data.oldPath, 
        newPath: data.newPath, 
        success: true 
      });
    } catch (err) {
      socket.emit('sftp-error', { message: err.message });
    }
  });

  // SFTP disconnect
  socket.on('sftp-disconnect', (data) => {
    sftpManager.disconnect(data.sessionId);
    
    // Remove from open tabs
    openTabs.delete(data.sessionId);
    
    // Broadcast to all clients that tab was closed
    io.emit('tab-closed', { sessionId: data.sessionId });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Remove this socket from all tabs and handle controller reassignment
    for (const [sessionId, tab] of openTabs) {
      tab.activeSockets.delete(socket.id);
      
      // For SSH sessions, handle controller reassignment when a socket leaves
      if (tab.type === 'ssh') {
        sshManager.leaveSession(socket, sessionId);
      }
      
      // If no more active sockets
      if (tab.activeSockets.size === 0) {
        // For sticky sessions: keep session open on server indefinitely
        // (until explicitly closed by user or server restart)
        if (tab.sticky) {
          console.log('[TAB] Sticky session remains open on server:', sessionId);
          // Clear any existing close timer (shouldn't have one, but just in case)
          if (tab.closeTimer) {
            clearTimeout(tab.closeTimer);
            tab.closeTimer = null;
          }
        } else {
          // For non-sticky sessions: close after grace period
          // Check if a close timer already exists
          if (tab.closeTimer) {
            clearTimeout(tab.closeTimer);
          }
          
          const gracePeriod = 5000; // 5 second grace period for reloads
          
          console.log(`[TAB] Non-sticky session, scheduling close in ${gracePeriod}ms:`, sessionId);
          
          tab.closeTimer = setTimeout(() => {
            // Double-check that no new sockets have joined
            if (tab.activeSockets.size === 0) {
              console.log('[TAB] Grace period expired, closing session:', sessionId);
              if (tab.type === 'ssh') {
                sshManager.disconnect(sessionId);
              } else if (tab.type === 'sftp') {
                sftpManager.disconnect(sessionId);
              }
              openTabs.delete(sessionId);
            } else {
              console.log('[TAB] Session has new sockets, canceling close:', sessionId);
            }
          }, gracePeriod);
        }
      }
    }
    
    // Note: We don't call disconnectAll here because the grace period logic above
    // handles session cleanup. Calling disconnectAll would bypass the grace period.
  });
});

server.listen(PORT, BIND, () => {
  const address = BIND === '0.0.0.0' || BIND === '::' ? 'localhost' : BIND;
  console.log(`Web SSH/SFTP Client running at http://${address}:${PORT}`);
  // OSC 8 hyperlink: ESC ] 8 ; ; URL BEL text ESC ] 8 ; ; BEL
  const ESC = '\x1b';
  const BEL = '\x07';
  console.log(`Click to open: ${ESC}]8;;http://localhost:${PORT}${BEL}http://localhost:${PORT}${ESC}]8;;${BEL}`);
  
  // Write PID file for update script to manage process
  const pidFile = path.join(__dirname, '.sshift.pid');
  try {
    fs.writeFileSync(pidFile, process.pid.toString());
    console.log(`[PID] Written PID ${process.pid} to ${pidFile}`);
  } catch (err) {
    console.error('[PID] Failed to write PID file:', err.message);
  }
});

// Clean up PID file on exit
process.on('exit', () => {
  const pidFile = path.join(__dirname, '.sshift.pid');
  try {
    if (fs.existsSync(pidFile)) {
      fs.unlinkSync(pidFile);
    }
  } catch (err) {
    // Ignore errors during cleanup
  }
});

process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

// Export io for use in managers
module.exports = { io };