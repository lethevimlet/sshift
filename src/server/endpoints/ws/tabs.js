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
  getOpenTabs,
  getCurrentTheme,
  setCurrentTheme,
  getCurrentAccent,
  setCurrentAccent
} = require('../../utils/tab-manager');
const { sshManager, sftpManager } = require('../../services');

/**
 * Register tab management WebSocket handlers
 * @param {Object} socket - Socket.IO socket
 * @param {Object} io - Socket.IO instance
 */
function registerTabHandlers(socket, io) {
  // Tab close event (client-side tab close, not full disconnect)
  socket.on('tab-close', (data) => {
    console.log('[TAB] Tab closed:', data.sessionId, 'by socket:', socket.id);

    // Remove this socket from the tab's active sockets
    const tab = getTab(data.sessionId);
    if (tab) {
      removeSocketFromTab(data.sessionId, socket.id);

      // If other sockets are still viewing this tab, the originating
      // client's close must NOT tear down the session for them.
      // Just notify remaining viewers to refresh their sessions list.
      // The originating client already removed the tab locally via
      // closeTab() (app.js), so it does NOT need a tab-closed echo.
      if (tab.activeSockets.size > 0) {
        console.log('[TAB] Tab closed by', socket.id, 'but', tab.activeSockets.size, 'viewer(s) remain; keeping session:', data.sessionId);
        // SSH: drop this socket from the session room so it stops
        // receiving broadcasts from this session.
        if (tab.type === 'ssh') {
          sshManager.leaveSession(socket, data.sessionId);
        }
        // Tell remaining clients to refresh any open "manage sessions"
        // modal — they may want to reflect the new viewer count.
        io.emit('sessions-updated');
        return;
      }

      // No more viewers left after this close. Honor the sticky flag:
      // sticky sessions stay alive on the server indefinitely (until
      // explicitly killed by another path or server restart). Non-
      // sticky sessions get the same 5s grace path used by
      // handleTabDisconnect, so a transient close-then-reopen round-
      // trip (e.g. closing and reloading a devtools session) doesn't
      // yank the SSH connection out from under the user.
      clearCloseTimer(data.sessionId);
      if (tab.sticky) {
        console.log('[TAB] Sticky session remains open on server (no viewers):', data.sessionId);
        io.emit('sessions-updated');
        return;
      }

      console.log('[TAB] Non-sticky session, scheduling close after grace period:', data.sessionId);
      const gracePeriod = 5000;
      setCloseTimer(data.sessionId, setTimeout(() => {
        const currentTab = getTab(data.sessionId);
        if (currentTab && currentTab.activeSockets.size === 0) {
          console.log('[TAB] Grace period expired, closing session:', data.sessionId);
          if (currentTab.type === 'ssh') {
            sshManager.disconnect(data.sessionId);
          } else if (currentTab.type === 'sftp') {
            sftpManager.disconnect(data.sessionId);
          }
          removeTab(data.sessionId);
          io.emit('tab-closed', { sessionId: data.sessionId });
          io.emit('sessions-updated');
        } else {
          console.log('[TAB] Session has new sockets, canceling close:', data.sessionId);
        }
      }, gracePeriod));
    } else {
      // No tab record — broadcast close so stale client UIs clear it.
      io.emit('tab-closed', { sessionId: data.sessionId });
      io.emit('sessions-updated');
    }
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
    }
    // Don't update tab order for empty tab lists — a new client syncing
    // before receiving server tabs would wipe the server-side tab order.
    // The server is the single source of truth for tab order.
    
    // Broadcast to all other clients only if there are tabs to sync.
    // Empty tab lists during initial sync should not disrupt other clients.
    if (data.tabs && data.tabs.length > 0) {
      socket.broadcast.emit('tabs-sync', { 
        tabs: data.tabs,
        layout: data.layout
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

  // Theme change - sync across all clients
  socket.on('theme-change', (data) => {
    console.log('[TAB] Theme change:', data.theme);
    
    // Update server-side theme
    setCurrentTheme(data.theme);
    
    // Broadcast to all other clients
    socket.broadcast.emit('theme-changed', { 
      theme: data.theme 
    });
  });

  // Accent change - sync across all clients
  socket.on('accent-change', (data) => {
    console.log('[TAB] Accent change:', data.accent);
    
    // Update server-side accent
    setCurrentAccent(data.accent);
    
    // Broadcast to all other clients
    socket.broadcast.emit('accent-changed', { 
      accent: data.accent 
    });
  });
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