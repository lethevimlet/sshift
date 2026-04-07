/**
 * Unit test for moveTabToPanel active session behavior
 */

// Mock DOM elements
class MockElement {
  constructor(tagName, id) {
    this.tagName = tagName;
    this.id = id;
    this.dataset = {};
    this.classList = new MockClassList();
    this.children = [];
    this.style = {};
    this.textContent = '';
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    const attrMatch = selector.match(/\[data-session-id="([^"]+)"\]/);
    if (attrMatch) {
      const sessionId = attrMatch[1];
      return this.children.find(c => c.dataset.sessionId === sessionId);
    }
    return this.children.find(c => c.id === selector);
  }

  querySelectorAll(selector) {
    if (selector.startsWith('.')) {
      // Handle multiple classes (e.g., '.tab.active')
      const classes = selector.substring(1).split('.');
      return this.children.filter(c => {
        return classes.every(cls => c.classList.contains(cls));
      });
    }
    return this.children;
  }
}

class MockClassList {
  constructor() {
    this.classes = new Set();
  }

  add(cls) {
    this.classes.add(cls);
  }

  remove(cls) {
    this.classes.delete(cls);
  }

  toggle(cls, force) {
    if (force !== undefined) {
      if (force) {
        this.classes.add(cls);
      } else {
        this.classes.delete(cls);
      }
    } else {
      if (this.classes.has(cls)) {
        this.classes.delete(cls);
      } else {
        this.classes.add(cls);
      }
    }
  }

  contains(cls) {
    return this.classes.has(cls);
  }
}

// Mock app
class MockApp {
  constructor() {
    this.sessions = new Map();
    this.sftpSessions = new Map();
    this.activeSessionId = null;
    this.activeSessionsByPanel = new Map();
    this.currentLayout = { id: 'columns-2', name: '2 Columns' };
    this.panels = new Map();
    
    // Create mock panels
    this.createMockPanel('panel-0');
    this.createMockPanel('panel-1');
  }

  createMockPanel(panelId) {
    const tabs = new MockElement('div', panelId === 'panel-0' ? 'tabs' : `${panelId}-tabs`);
    const terminals = new MockElement('div', panelId === 'panel-0' ? 'terminals' : `${panelId}-terminals`);
    this.panels.set(panelId, { tabs, terminals });
  }

  getAllPanels() {
    return Array.from(this.panels.keys());
  }

  getTabsContainer(panelId) {
    const panel = this.panels.get(panelId);
    return panel ? panel.tabs : null;
  }

  getTerminalsContainer(panelId) {
    const panel = this.panels.get(panelId);
    return panel ? panel.terminals : null;
  }

  getPanelForSession(sessionId) {
    for (const [panelId, panel] of this.panels) {
      const tab = panel.tabs.querySelector(`[data-session-id="${sessionId}"]`);
      if (tab) return panelId;
    }
    return 'panel-0';
  }

  hideEmptyState(panelId) {
    // Mock implementation
  }

  showEmptyState(panelId) {
    // Mock implementation
  }

  switchTab(sessionId, panelId = null) {
    // Determine which panel this session belongs to
    if (!panelId) {
      panelId = this.getPanelForSession(sessionId);
    }
    
    // Update per-panel active session
    this.activeSessionsByPanel.set(panelId, sessionId);
    
    // Update global active session (for backwards compatibility)
    this.activeSessionId = sessionId;
    
    // Get the tabs container for this panel
    const tabsContainer = this.getTabsContainer(panelId);
    if (tabsContainer) {
      // Update active tab only within this panel
      tabsContainer.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.sessionId === sessionId);
      });
    }

    // Get the terminals container for this panel
    const terminalsContainer = this.getTerminalsContainer(panelId);
    if (terminalsContainer) {
      // Update active terminal only within this panel
      terminalsContainer.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
        const isActive = wrapper.id === `terminal-wrapper-${sessionId}`;
        wrapper.classList.toggle('active', isActive);
      });
    }
  }

  moveTabToPanel(sessionId, targetPanelId) {
    const currentPanelId = this.getPanelForSession(sessionId);
    if (currentPanelId === targetPanelId) return; // Already in target panel
    
    const sourceTabsContainer = this.getTabsContainer(currentPanelId);
    const targetTabsContainer = this.getTabsContainer(targetPanelId);
    const sourceTerminalsContainer = this.getTerminalsContainer(currentPanelId);
    const targetTerminalsContainer = this.getTerminalsContainer(targetPanelId);
    
    if (!sourceTabsContainer || !targetTabsContainer) return;
    if (!sourceTerminalsContainer || !targetTerminalsContainer) return;
    
    // Move tab element
    const tabElement = sourceTabsContainer.querySelector(`[data-session-id="${sessionId}"]`);
    if (tabElement) {
      // Remove from source
      const idx = sourceTabsContainer.children.indexOf(tabElement);
      if (idx > -1) {
        sourceTabsContainer.children.splice(idx, 1);
      }
      // Add to target
      targetTabsContainer.appendChild(tabElement);
    }
    
    // Move terminal element
    const terminalElement = sourceTerminalsContainer.querySelector(`[data-session-id="${sessionId}"]`);
    if (terminalElement) {
      // Remove from source
      const idx = sourceTerminalsContainer.children.indexOf(terminalElement);
      if (idx > -1) {
        sourceTerminalsContainer.children.splice(idx, 1);
      }
      // Add to target
      targetTerminalsContainer.appendChild(terminalElement);
    }
    
    // Hide empty state in target panel if it has tabs now
    const targetTabs = targetTabsContainer.children;
    if (targetTabs.length > 0) {
      this.hideEmptyState(targetPanelId);
    }
    
    // Show empty state in source panel if it has no tabs now
    const sourceTabs = sourceTabsContainer.children;
    if (sourceTabs.length === 0) {
      this.showEmptyState(currentPanelId);
    }
    
    // Update active sessions:
    // 1. Make the moved tab active in the target panel
    this.switchTab(sessionId, targetPanelId);
    
    // 2. Activate the first remaining tab in the source panel (if any)
    if (sourceTabs.length > 0) {
      const firstRemainingSessionId = sourceTabs[0].dataset.sessionId;
      this.switchTab(firstRemainingSessionId, currentPanelId);
    } else {
      // No tabs left in source panel, clear its active session
      this.activeSessionsByPanel.delete(currentPanelId);
    }
    
    console.log('[TEST] Moved tab', sessionId, 'from', currentPanelId, 'to', targetPanelId);
  }
}

function createMockSession(id, name) {
  // Create tab element
  const tab = new MockElement('div', `tab-${id}`);
  tab.classList.add('tab');
  tab.dataset.sessionId = id;
  tab.textContent = name;
  
  // Create terminal wrapper
  const wrapper = new MockElement('div', `terminal-wrapper-${id}`);
  wrapper.classList.add('terminal-wrapper');
  wrapper.dataset.sessionId = id;
  wrapper.textContent = `Terminal ${name}`;
  
  return { tab, wrapper };
}

// Test runner
function runTests() {
  console.log('Starting Tab Drag Active State Tests');
  console.log('='.repeat(50));
  
  let passed = 0;
  let failed = 0;
  
  function log(message, type = 'info') {
    const prefix = type === 'pass' ? '✓ PASS:' : type === 'fail' ? '✗ FAIL:' : '  INFO:';
    console.log(`${prefix} ${message}`);
  }
  
  try {
    // Setup
    const app = new MockApp();
    
    // Test 1: Create 3 sessions in panel-0
    log('Test 1: Setup - Create 3 sessions in panel-0');
    
    const session1 = createMockSession('session-1', 'Server 1');
    const session2 = createMockSession('session-2', 'Server 2');
    const session3 = createMockSession('session-3', 'Server 3');
    
    app.panels.get('panel-0').tabs.appendChild(session1.tab);
    app.panels.get('panel-0').tabs.appendChild(session2.tab);
    app.panels.get('panel-0').tabs.appendChild(session3.tab);
    app.panels.get('panel-0').terminals.appendChild(session1.wrapper);
    app.panels.get('panel-0').terminals.appendChild(session2.wrapper);
    app.panels.get('panel-0').terminals.appendChild(session3.wrapper);
    
    app.sessions.set('session-1', { id: 'session-1', name: 'Server 1' });
    app.sessions.set('session-2', { id: 'session-2', name: 'Server 2' });
    app.sessions.set('session-3', { id: 'session-3', name: 'Server 3' });
    
    // Activate session-1 in panel-0
    app.switchTab('session-1', 'panel-0');
    
    const activeInPanel0 = app.activeSessionsByPanel.get('panel-0');
    if (activeInPanel0 === 'session-1') {
      log('Panel-0 has session-1 active', 'pass');
      passed++;
    } else {
      log(`Expected session-1 active, got ${activeInPanel0}`, 'fail');
      failed++;
    }
    
    // Test 2: Move session-1 from panel-0 to panel-1
    log('Test 2: Move session-1 from panel-0 to panel-1');
    
    app.moveTabToPanel('session-1', 'panel-1');
    
    // Check that session-1 is now active in panel-1
    const activeInPanel1AfterMove = app.activeSessionsByPanel.get('panel-1');
    if (activeInPanel1AfterMove === 'session-1') {
      log('Moved tab (session-1) is active in target panel (panel-1)', 'pass');
      passed++;
    } else {
      log(`Expected session-1 active in panel-1, got ${activeInPanel1AfterMove}`, 'fail');
      failed++;
    }
    
    // Check that panel-0 has a new active tab (should be session-2, the first remaining)
    const activeInPanel0AfterMove = app.activeSessionsByPanel.get('panel-0');
    if (activeInPanel0AfterMove === 'session-2') {
      log('Source panel (panel-0) activated first remaining tab (session-2)', 'pass');
      passed++;
    } else {
      log(`Expected session-2 active in panel-0, got ${activeInPanel0AfterMove}`, 'fail');
      failed++;
    }
    
    // Test 3: Verify only one active tab per panel
    log('Test 3: Verify exactly one active tab per panel');
    
    const activeTabsPanel0 = app.panels.get('panel-0').tabs.querySelectorAll('.tab.active');
    const activeTabsPanel1 = app.panels.get('panel-1').tabs.querySelectorAll('.tab.active');
    const activeTerminalsPanel0 = app.panels.get('panel-0').terminals.querySelectorAll('.terminal-wrapper.active');
    const activeTerminalsPanel1 = app.panels.get('panel-1').terminals.querySelectorAll('.terminal-wrapper.active');
    
    if (activeTabsPanel0.length === 1 && activeTabsPanel1.length === 1) {
      log('Each panel has exactly one active tab', 'pass');
      passed++;
    } else {
      log(`Panel-0 has ${activeTabsPanel0.length} active tabs, Panel-1 has ${activeTabsPanel1.length} active tabs`, 'fail');
      failed++;
    }
    
    if (activeTerminalsPanel0.length === 1 && activeTerminalsPanel1.length === 1) {
      log('Each panel has exactly one active terminal', 'pass');
      passed++;
    } else {
      log(`Panel-0 has ${activeTerminalsPanel0.length} active terminals, Panel-1 has ${activeTerminalsPanel1.length} active terminals`, 'fail');
      failed++;
    }
    
    // Test 4: Move session-2 from panel-0 to panel-1
    log('Test 4: Move session-2 from panel-0 to panel-1');
    
    app.moveTabToPanel('session-2', 'panel-1');
    
    // Check that session-2 is now active in panel-1
    const activeInPanel1AfterSecondMove = app.activeSessionsByPanel.get('panel-1');
    if (activeInPanel1AfterSecondMove === 'session-2') {
      log('Moved tab (session-2) is active in target panel (panel-1)', 'pass');
      passed++;
    } else {
      log(`Expected session-2 active in panel-1, got ${activeInPanel1AfterSecondMove}`, 'fail');
      failed++;
    }
    
    // Check that panel-0 has session-3 active (the only remaining tab)
    const activeInPanel0AfterSecondMove = app.activeSessionsByPanel.get('panel-0');
    if (activeInPanel0AfterSecondMove === 'session-3') {
      log('Source panel (panel-0) activated first remaining tab (session-3)', 'pass');
      passed++;
    } else {
      log(`Expected session-3 active in panel-0, got ${activeInPanel0AfterSecondMove}`, 'fail');
      failed++;
    }
    
    // Test 5: Move last tab from panel-0 to panel-1
    log('Test 5: Move last tab (session-3) from panel-0 to panel-1');
    
    app.moveTabToPanel('session-3', 'panel-1');
    
    // Check that session-3 is now active in panel-1
    const activeInPanel1AfterThirdMove = app.activeSessionsByPanel.get('panel-1');
    if (activeInPanel1AfterThirdMove === 'session-3') {
      log('Moved tab (session-3) is active in target panel (panel-1)', 'pass');
      passed++;
    } else {
      log(`Expected session-3 active in panel-1, got ${activeInPanel1AfterThirdMove}`, 'fail');
      failed++;
    }
    
    // Check that panel-0 has no active session
    const activeInPanel0AfterThirdMove = app.activeSessionsByPanel.get('panel-0');
    if (activeInPanel0AfterThirdMove === undefined) {
      log('Source panel (panel-0) has no active session (empty panel)', 'pass');
      passed++;
    } else {
      log(`Expected no active session in panel-0, got ${activeInPanel0AfterThirdMove}`, 'fail');
      failed++;
    }
    
    // Test 6: Verify all tabs are in panel-1
    log('Test 6: Verify all tabs are now in panel-1');
    
    const tabsInPanel0 = app.panels.get('panel-0').tabs.children.length;
    const tabsInPanel1 = app.panels.get('panel-1').tabs.children.length;
    
    if (tabsInPanel0 === 0 && tabsInPanel1 === 3) {
      log('All tabs moved to panel-1, panel-0 is empty', 'pass');
      passed++;
    } else {
      log(`Panel-0 has ${tabsInPanel0} tabs, Panel-1 has ${tabsInPanel1} tabs`, 'fail');
      failed++;
    }
    
  } catch (error) {
    log(`ERROR: ${error.message}`, 'fail');
    console.error(error);
    failed++;
  }
  
  // Summary
  console.log('='.repeat(50));
  const result = failed === 0 ? 'pass' : 'fail';
  console.log(`Tests Complete: ${passed} passed, ${failed} failed`);
  
  if (failed === 0) {
    console.log('🎉 All tests passed!');
    return true;
  } else {
    console.log('⚠️ Some tests failed. Please review the implementation.');
    return false;
  }
}

// Run tests
const success = runTests();
process.exit(success ? 0 : 1);