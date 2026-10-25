/**
 * Tab management WebSocket handlers
 */

const { 
  getTab, 
  removeTab, 
  removeSocketFromTab, 
  getTabOrder, 
  addToTabOrder, 
  setTabOrder, 
  setCloseTimer,
  clearCloseTimer,
  getCloseTimer,
  updateTabName,
  updateTabPanel,
  setActiveTab,
  setActiveSession,
  getOpenTabs
} = require('../../utils/tab-manager');
const { sshManager, sftpManager } = require('../../services');

/**
 * Register tab management WebSocket handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function registerTabHandlers(socket, io) {
  // An explicit close ends the shared session. Socket disconnect/reload is
  // handled separately below and retains sticky sessions/reconnect grace.
  socket.on('tab-close', (data) => {
    console.log('[TAB] Tab closed:', data.sessionId, 'by socket:', socket.id);
    const tab = getTab(data.sessionId);
    clearCloseTimer(data.sessionId);
    // Remove restoration state before disconnecting the stream, which can
    // synchronously emit events. No reconnect should resurrect a closed tab.
    removeTab(data.sessionId);
    if (tab) {
      if (tab.type === 'ssh') {
        sshManager.disconnect(data.sessionId);
      } else if (tab.type === 'sftp') {
        sftpManager.disconnect(data.sessionId);
      }
    }
    io.emit('tab-closed', { sessionId: data.sessionId });
    io.emit('sessions-updated');
  });

  // Tab reorder event
  socket.on('tab-reorder', (data) => {
    console.log('[TAB] Tab reorder:', data.tabs?.length || 0, 'tabs, layout:', data.layout);
    
    // Update tab order with panel assignments
    if (data.tabs && Array.isArray(data.tabs)) {
      setTabOrder(data.tabs.map(t => typeof t === 'string' ? t : t.sessionId));
      
      // Update panel assignments in openTabs
      data.tabs.forEach(tabData => {
        if (typeof tabData === 'object' && tabData.sessionId && tabData.panelId) {
          updateTabPanel(tabData.sessionId, tabData.panelId);
        }
      });
    } else if (data.order) {
      // Legacy format support
      setTabOrder(data.order);
    }
    
    // Broadcast new order to all other clients
    socket.broadcast.emit('tab-order', { 
      tabs: data.tabs,
      order: getTabOrder(),
      layout: data.layout
    });
  });

  // Tabs save event - for cross-tab sync
  socket.on('tabs-save', (data) => {
    console.log('[TAB] Tabs save:', data.tabs?.length || 0, 'tabs, layout:', data.layout);
    
    // Update tab order with panel assignments
    if (data.tabs && Array.isArray(data.tabs) && data.tabs.length > 0) {
      setTabOrder(data.tabs.map(t => typeof t === 'string' ? t : t.sessionId));
      
      // Update panel assignments and active tabs in openTabs
      data.tabs.forEach(tabData => {
        if (typeof tabData === 'object' && tabData.sessionId && tabData.panelId) {
          updateTabPanel(tabData.sessionId, tabData.panelId);
          // Track which tab is active per panel
          if (tabData.active) {
            setActiveTab(tabData.panelId, tabData.sessionId);
          }
        }
      });
      setActiveSession(data.activeSessionId);
    }
    // Don't update tab order for empty tab lists — a new client syncing
    // before receiving server tabs would wipe the server-side tab order.
    // The server is the single source of truth for tab order.
    
    // Broadcast to all other clients only if there are tabs to sync.
    // Empty tab lists during initial sync should not disrupt other clients.
    if (data.tabs && data.tabs.length > 0) {
      socket.broadcast.emit('tabs-sync', { 
        tabs: data.tabs,
        layout: data.layout,
        activeSessionId: data.activeSessionId
      });
    }
  });

  // Tab rename - sync across all sessions
  socket.on('tab-rename', (data) => {
    console.log('[TAB] Tab rename:', data.sessionId, 'to', data.name);
    
    // Update the tab name in openTabs
    updateTabName(data.sessionId, data.name);
    
    // Broadcast rename to all other clients
    socket.broadcast.emit('tab-renamed', { 
      sessionId: data.sessionId, 
      name: data.name 
    });
  });

  // theme-change / accent-change handlers removed: theme and accent are
  // per-device preferences kept in each browser's localStorage and are
  // no longer synced through the server.
}

/**
 * Handle socket disconnect for tab management
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function handleTabDisconnect(socket, io) {
  console.log('Client disconnected:', socket.id);
  
  // Remove this socket from all tabs and handle controller reassignment
  const openTabs = getOpenTabs();
  for (const [sessionId, tab] of openTabs) {
    removeSocketFromTab(sessionId, socket.id);
    
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
        clearCloseTimer(sessionId);
      } else {
        // For non-sticky sessions: close after grace period
        // Check if a close timer already exists
        clearCloseTimer(sessionId);
        
        const gracePeriod = 5000; // 5 second grace period for reloads
        
        console.log(`[TAB] Non-sticky session, scheduling close in ${gracePeriod}ms:`, sessionId);
        
        setCloseTimer(sessionId, setTimeout(() => {
          const currentTab = getTab(sessionId);
          // Double-check that no new sockets have joined
          if (currentTab && currentTab.activeSockets.size === 0) {
            console.log('[TAB] Grace period expired, closing session:', sessionId);
            if (currentTab.type === 'ssh') {
              sshManager.disconnect(sessionId);
            } else if (currentTab.type === 'sftp') {
              sftpManager.disconnect(sessionId);
            }
            removeTab(sessionId);
          } else {
            console.log('[TAB] Session has new sockets, canceling close:', sessionId);
          }
        }, gracePeriod));
      }
    }
  };
}

module.exports = { registerTabHandlers, handleTabDisconnect };
