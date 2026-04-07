/**
 * Test for layout switching active tab behavior
 * Tests that switching from multi-panel to single panel always sets an active tab
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
    if (selector.startsWith('.')) {
      const className = selector.substring(1);
      return this.children.find(c => c.classList.contains(className));
    }
    return this.children.find(c => c.id === selector);
  }

  querySelectorAll(selector) {
    if (selector.startsWith('.')) {
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

// Mock app with layout switching
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
    if (!panelId) {
      panelId = this.getPanelForSession(sessionId);
    }
    
    this.activeSessionsByPanel.set(panelId, sessionId);
    this.activeSessionId = sessionId;
    
    const tabsContainer = this.getTabsContainer(panelId);
    if (tabsContainer) {
      tabsContainer.querySelectorAll('.tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.sessionId === sessionId);
      });
    }

    const terminalsContainer = this.getTerminalsContainer(panelId);
    if (terminalsContainer) {
      terminalsContainer.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
        const isActive = wrapper.id === `terminal-wrapper-${sessionId}`;
        wrapper.classList.toggle('active', isActive);
      });
    }
  }

  // Simulate switching to single panel layout
  switchToSinglePanel() {
    // Simulate the logic from applyLayout for single panel
    const tabsContainer = this.getTabsContainer('panel-0');
    const terminalsContainer = this.getTerminalsContainer('panel-0');
    
    // Find the first active tab across all panels
    let activeTabToKeep = null;
    const panels = this.getAllPanels();
    
    // Check each panel in order for an active session
    for (const panelId of panels) {
      const activeSessionId = this.activeSessionsByPanel.get(panelId);
      if (activeSessionId && this.sessions.has(activeSessionId)) {
        activeTabToKeep = activeSessionId;
        break;
      }
    }
    
    // If no active tab found, use the first tab in the panel
    if (!activeTabToKeep) {
      const firstTab = tabsContainer.querySelector('.tab');
      if (firstTab) {
        activeTabToKeep = firstTab.dataset.sessionId;
      }
    }
    
    // Deactivate all tabs first
    tabsContainer.querySelectorAll('.tab').forEach(tab => {
      tab.classList.remove('active');
    });
    
    // Hide all terminal wrappers
    terminalsContainer.querySelectorAll('.terminal-wrapper').forEach(wrapper => {
      wrapper.classList.remove('active');
    });
    
    // Activate only the selected tab
    if (activeTabToKeep) {
      const activeTab = tabsContainer.querySelector(`[data-session-id="${activeTabToKeep}"]`);
      const activeWrapper = terminalsContainer.querySelector(`[data-session-id="${activeTabToKeep}"]`);
      
      if (activeTab) activeTab.classList.add('active');
      if (activeWrapper) activeWrapper.classList.add('active');
      
      // Update activeSessionsByPanel for single panel
      this.activeSessionsByPanel.clear();
      this.activeSessionsByPanel.set('panel-0', activeTabToKeep);
    }
  }
}

function createMockSession(id, name) {
  const tab = new MockElement('div', `tab-${id}`);
  tab.classList.add('tab');
  tab.dataset.sessionId = id;
  tab.textContent = name;
  
  const wrapper = new MockElement('div', `terminal-wrapper-${id}`);
  wrapper.classList.add('terminal-wrapper');
  wrapper.dataset.sessionId = id;
  wrapper.textContent = `Terminal ${name}`;
  
  return { tab, wrapper };
}

function runTests() {
  console.log('Starting Layout Switch Active Tab Tests');
  console.log('='.repeat(60));
  
  let passed = 0;
  let failed = 0;
  
  function log(message, type = 'info') {
    const prefix = type === 'pass' ? '✓ PASS:' : type === 'fail' ? '✗ FAIL:' : '  INFO:';
    console.log(`${prefix} ${message}`);
  }
  
  function assertEqual(actual, expected, message) {
    if (actual === expected) {
      log(message, 'pass');
      passed++;
      return true;
    } else {
      log(`${message} (expected: ${expected}, got: ${actual})`, 'fail');
      failed++;
      return false;
    }
  }
  
  try {
    // Test 1: Switch to single panel with active tabs in multi-panel
    console.log('\n--- Test 1: Switch to single panel with active tabs ---');
    const app1 = new MockApp();
    
    // Create sessions in both panels
    const s1 = createMockSession('s1', 'Server 1');
    const s2 = createMockSession('s2', 'Server 2');
    const s3 = createMockSession('s3', 'Server 3');
    
    app1.panels.get('panel-0').tabs.appendChild(s1.tab);
    app1.panels.get('panel-0').tabs.appendChild(s2.tab);
    app1.panels.get('panel-1').tabs.appendChild(s3.tab);
    app1.panels.get('panel-0').terminals.appendChild(s1.wrapper);
    app1.panels.get('panel-0').terminals.appendChild(s2.wrapper);
    app1.panels.get('panel-1').terminals.appendChild(s3.wrapper);
    
    app1.sessions.set('s1', { id: 's1', name: 'Server 1' });
    app1.sessions.set('s2', { id: 's2', name: 'Server 2' });
    app1.sessions.set('s3', { id: 's3', name: 'Server 3' });
    
    // Set active tabs in both panels
    app1.switchTab('s2', 'panel-0');
    app1.switchTab('s3', 'panel-1');
    
    // Move all tabs to panel-0 (simulating layout switch)
    app1.panels.get('panel-0').tabs.appendChild(s3.tab);
    app1.panels.get('panel-0').terminals.appendChild(s3.wrapper);
    
    // Switch to single panel
    app1.switchToSinglePanel();
    
    // Should have s2 active (first panel's active tab)
    assertEqual(app1.activeSessionsByPanel.get('panel-0'), 's2', 'Active tab is s2 (from panel-0)');
    
    // Test 2: Switch to single panel with no active tabs
    console.log('\n--- Test 2: Switch to single panel with no active tabs ---');
    const app2 = new MockApp();
    
    const t1 = createMockSession('t1', 'Terminal 1');
    const t2 = createMockSession('t2', 'Terminal 2');
    
    app2.panels.get('panel-0').tabs.appendChild(t1.tab);
    app2.panels.get('panel-0').tabs.appendChild(t2.tab);
    app2.panels.get('panel-0').terminals.appendChild(t1.wrapper);
    app2.panels.get('panel-0').terminals.appendChild(t2.wrapper);
    
    app2.sessions.set('t1', { id: 't1', name: 'Terminal 1' });
    app2.sessions.set('t2', { id: 't2', name: 'Terminal 2' });
    
    // Don't set any active tabs (simulate the bug scenario)
    app2.activeSessionsByPanel.clear();
    
    // Switch to single panel
    app2.switchToSinglePanel();
    
    // Should have t1 active (first tab)
    assertEqual(app2.activeSessionsByPanel.get('panel-0'), 't1', 'Active tab is t1 (first tab fallback)');
    
    // Test 3: Switch to single panel with active tab in second panel only
    console.log('\n--- Test 3: Switch with active tab in second panel only ---');
    const app3 = new MockApp();
    
    const u1 = createMockSession('u1', 'User 1');
    const u2 = createMockSession('u2', 'User 2');
    
    app3.panels.get('panel-0').tabs.appendChild(u1.tab);
    app3.panels.get('panel-1').tabs.appendChild(u2.tab);
    app3.panels.get('panel-0').terminals.appendChild(u1.wrapper);
    app3.panels.get('panel-1').terminals.appendChild(u2.wrapper);
    
    app3.sessions.set('u1', { id: 'u1', name: 'User 1' });
    app3.sessions.set('u2', { id: 'u2', name: 'User 2' });
    
    // Only set active in panel-1
    app3.switchTab('u2', 'panel-1');
    
    // Move all tabs to panel-0
    app3.panels.get('panel-0').tabs.appendChild(u2.tab);
    app3.panels.get('panel-0').terminals.appendChild(u2.wrapper);
    
    // Switch to single panel
    app3.switchToSinglePanel();
    
    // Should have u2 active (from panel-1)
    assertEqual(app3.activeSessionsByPanel.get('panel-0'), 'u2', 'Active tab is u2 (from panel-1)');
    
    // Test 4: Verify DOM state after switch
    console.log('\n--- Test 4: Verify DOM state after switch ---');
    const app4 = new MockApp();
    
    const d1 = createMockSession('d1', 'Device 1');
    const d2 = createMockSession('d2', 'Device 2');
    const d3 = createMockSession('d3', 'Device 3');
    
    app4.panels.get('panel-0').tabs.appendChild(d1.tab);
    app4.panels.get('panel-0').tabs.appendChild(d2.tab);
    app4.panels.get('panel-0').tabs.appendChild(d3.tab);
    app4.panels.get('panel-0').terminals.appendChild(d1.wrapper);
    app4.panels.get('panel-0').terminals.appendChild(d2.wrapper);
    app4.panels.get('panel-0').terminals.appendChild(d3.wrapper);
    
    app4.sessions.set('d1', { id: 'd1', name: 'Device 1' });
    app4.sessions.set('d2', { id: 'd2', name: 'Device 2' });
    app4.sessions.set('d3', { id: 'd3', name: 'Device 3' });
    
    // No active tabs set
    app4.activeSessionsByPanel.clear();
    
    // Switch to single panel
    app4.switchToSinglePanel();
    
    // Check active classes
    const activeTabs = app4.panels.get('panel-0').tabs.querySelectorAll('.tab.active');
    const activeTerminals = app4.panels.get('panel-0').terminals.querySelectorAll('.terminal-wrapper.active');
    
    assertEqual(activeTabs.length, 1, 'Exactly one active tab');
    assertEqual(activeTerminals.length, 1, 'Exactly one active terminal');
    assertEqual(activeTabs[0].dataset.sessionId, 'd1', 'First tab is active');
    assertEqual(activeTerminals[0].dataset.sessionId, 'd1', 'First terminal is active');
    
    // Test 5: Empty panel scenario
    console.log('\n--- Test 5: Empty panel scenario ---');
    const app5 = new MockApp();
    
    // No tabs at all
    app5.activeSessionsByPanel.clear();
    
    // Switch to single panel
    app5.switchToSinglePanel();
    
    // Should have no active session
    assertEqual(app5.activeSessionsByPanel.get('panel-0'), undefined, 'No active session for empty panel');
    
  } catch (error) {
    log(`ERROR: ${error.message}`, 'fail');
    console.error(error);
    failed++;
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
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