/**
 * Sessions REST endpoints
 */

const { getOpenTabs, removeTab, getTabOrder } = require('../../utils/tab-manager');
const { sshManager, sftpManager } = require('../../services');

/**
 * Register sessions endpoints
 * @param {Object} app - Express app
 * @param {Object} io - Socket.IO instance
 */
function registerSessionsEndpoints(app, io) {
  // API: Get active sessions
  app.get('/api/sessions', (req, res) => {
    const sessions = [];
    const openTabs = getOpenTabs();
    
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
    const openTabs = getOpenTabs();
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
    removeTab(sessionId);
    
    // Broadcast to all clients that the session was closed
    io.emit('tab-closed', { sessionId });
    
    res.json({ success: true, sessionId });
  });

  // API: Close all sessions
  app.post('/api/sessions/close-all', (req, res) => {
    console.log('[API] Force closing all sessions');
    
    const closedSessions = [];
    const openTabs = getOpenTabs();
    
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
    
    // Clear all tabs - need to iterate and remove
    for (const sessionId of closedSessions) {
      removeTab(sessionId);
    }
    
    res.json({ success: true, closedCount: closedSessions.length });
  });
}

module.exports = { registerSessionsEndpoints };