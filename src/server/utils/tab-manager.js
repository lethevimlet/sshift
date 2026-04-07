/**
 * Tab management utility
 * Tracks open tabs across all clients
 */

// Track open tabs across all clients
// Map: sessionId -> { name, type, connectionData, activeSockets: Set }
const openTabs = new Map();

// Array of sessionIds in order
let tabOrder = [];

// Current active layout for sync
let currentLayout = 'single';

/**
 * Get all open tabs
 * @returns {Map} Map of open tabs
 */
function getOpenTabs() {
  return openTabs;
}

/**
 * Get tab order array
 * @returns {Array} Array of sessionIds
 */
function getTabOrder() {
  return tabOrder;
}

/**
 * Set tab order array
 * @param {Array} order - Array of sessionIds
 */
function setTabOrder(order) {
  tabOrder = order;
}

/**
 * Add sessionId to tab order
 * @param {string} sessionId - Session ID
 */
function addToTabOrder(sessionId) {
  if (!tabOrder.includes(sessionId)) {
    tabOrder.push(sessionId);
  }
}

/**
 * Get current layout
 * @returns {string} Current layout ID
 */
function getCurrentLayout() {
  return currentLayout;
}

/**
 * Set current layout
 * @param {string} layoutId - Layout ID
 */
function setCurrentLayout(layoutId) {
  currentLayout = layoutId;
}

/**
 * Add a tab
 * @param {string} sessionId - Session ID
 * @param {Object} tabData - Tab data
 */
function addTab(sessionId, tabData) {
  openTabs.set(sessionId, tabData);
  if (!tabOrder.includes(sessionId)) {
    tabOrder.push(sessionId);
  }
}

/**
 * Get a tab by session ID
 * @param {string} sessionId - Session ID
 * @returns {Object|undefined} Tab data
 */
function getTab(sessionId) {
  return openTabs.get(sessionId);
}

/**
 * Remove a tab
 * @param {string} sessionId - Session ID
 */
function removeTab(sessionId) {
  openTabs.delete(sessionId);
  tabOrder = tabOrder.filter(id => id !== sessionId);
}

/**
 * Add a socket to a tab
 * @param {string} sessionId - Session ID
 * @param {string} socketId - Socket ID
 */
function addSocketToTab(sessionId, socketId) {
  const tab = openTabs.get(sessionId);
  if (tab) {
    tab.activeSockets.add(socketId);
  }
}

/**
 * Remove a socket from a tab
 * @param {string} sessionId - Session ID
 * @param {string} socketId - Socket ID
 */
function removeSocketFromTab(sessionId, socketId) {
  const tab = openTabs.get(sessionId);
  if (tab) {
    tab.activeSockets.delete(socketId);
  }
}

/**
 * Check if a tab has any active sockets
 * @param {string} sessionId - Session ID
 * @returns {boolean} True if tab has active sockets
 */
function hasActiveSockets(sessionId) {
  const tab = openTabs.get(sessionId);
  return tab && tab.activeSockets.size > 0;
}

/**
 * Get the number of active sockets for a tab
 * @param {string} sessionId - Session ID
 * @returns {number} Number of active sockets
 */
function getActiveSocketCount(sessionId) {
  const tab = openTabs.get(sessionId);
  return tab ? tab.activeSockets.size : 0;
}

/**
 * Set close timer for a tab
 * @param {string} sessionId - Session ID
 * @param {NodeJS.Timeout} timer - Timer reference
 */
function setCloseTimer(sessionId, timer) {
  const tab = openTabs.get(sessionId);
  if (tab) {
    tab.closeTimer = timer;
  }
}

/**
 * Clear close timer for a tab
 * @param {string} sessionId - Session ID
 */
function clearCloseTimer(sessionId) {
  const tab = openTabs.get(sessionId);
  if (tab && tab.closeTimer) {
    clearTimeout(tab.closeTimer);
    tab.closeTimer = null;
  }
}

/**
 * Get close timer for a tab
 * @param {string} sessionId - Session ID
 * @returns {NodeJS.Timeout|null} Timer reference
 */
function getCloseTimer(sessionId) {
  const tab = openTabs.get(sessionId);
  return tab ? tab.closeTimer : null;
}

/**
 * Update tab name
 * @param {string} sessionId - Session ID
 * @param {string} name - New name
 */
function updateTabName(sessionId, name) {
  const tab = openTabs.get(sessionId);
  if (tab) {
    tab.name = name;
  }
}

/**
 * Update tab panel assignment
 * @param {string} sessionId - Session ID
 * @param {string} panelId - Panel ID
 */
function updateTabPanel(sessionId, panelId) {
  const tab = openTabs.get(sessionId);
  if (tab) {
    tab.panelId = panelId;
  }
}

/**
 * Iterate over all tabs
 * @param {Function} callback - Callback function (sessionId, tab) => void
 */
function forEachTab(callback) {
  openTabs.forEach(callback);
}

module.exports = {
  getOpenTabs,
  getTabOrder,
  setTabOrder,
  addToTabOrder,
  getCurrentLayout,
  setCurrentLayout,
  addTab,
  getTab,
  removeTab,
  addSocketToTab,
  removeSocketFromTab,
  hasActiveSockets,
  getActiveSocketCount,
  setCloseTimer,
  clearCloseTimer,
  getCloseTimer,
  updateTabName,
  updateTabPanel,
  forEachTab
};