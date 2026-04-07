/**
 * Comprehensive test for moveTabToPanel active session behavior
 * Tests various edge cases and scenarios
 */

// Mock DOM elements (same as before)
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
    this.createMockPanel('panel-2');
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

  moveTabToPanel(sessionId, targetPanelId) {
    const currentPanelId = this.getPanelForSession(sessionId);
    if (currentPanelId === targetPanelId) return;
    
    const sourceTabsContainer = this.getTabsContainer(currentPanelId);
    const targetTabsContainer = this.getTabsContainer(targetPanelId);
    const sourceTerminalsContainer = this.getTerminalsContainer(currentPanelId);
    const targetTerminalsContainer = this.getTerminalsContainer(targetPanelId);
    
    if (!sourceTabsContainer || !targetTabsContainer) return;
    if (!sourceTerminalsContainer || !targetTerminalsContainer) return;
    
    const tabElement = sourceTabsContainer.querySelector(`[data-session-id="${sessionId}"]`);
    if (tabElement) {
      const idx = sourceTabsContainer.children.indexOf(tabElement);
      if (idx > -1) {
        sourceTabsContainer.children.splice(idx, 1);
      }
      targetTabsContainer.appendChild(tabElement);
    }
    
    const terminalElement = sourceTerminalsContainer.querySelector(`[data-session-id="${sessionId}"]`);
    if (terminalElement) {
      const idx = sourceTerminalsContainer.children.indexOf(terminalElement);
      if (idx > -1) {
        sourceTerminalsContainer.children.splice(idx, 1);
      }
      targetTerminalsContainer.appendChild(terminalElement);
    }
    
    const targetTabs = targetTabsContainer.children;
    if (targetTabs.length > 0) {
      this.hideEmptyState(targetPanelId);
    }
    
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
      this.activeSessionsByPanel.delete(currentPanelId);
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
  console.log('Starting Comprehensive Tab Drag Active State Tests');
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
    // Test 1: Basic drag from one panel to another
    console.log('\n--- Test 1: Basic drag from one panel to another ---');
    const app1 = new MockApp();
    
    // Setup: 3 tabs in panel-0
    const s1 = createMockSession('s1', 'Server 1');
    const s2 = createMockSession('s2', 'Server 2');
    const s3 = createMockSession('s3', 'Server 3');
    
    app1.panels.get('panel-0').tabs.appendChild(s1.tab);
    app1.panels.get('panel-0').tabs.appendChild(s2.tab);
    app1.panels.get('panel-0').tabs.appendChild(s3.tab);
    app1.panels.get('panel-0').terminals.appendChild(s1.wrapper);
    app1.panels.get('panel-0').terminals.appendChild(s2.wrapper);
    app1.panels.get('panel-0').terminals.appendChild(s3.wrapper);
    
    app1.switchTab('s1', 'panel-0');
    
    // Move s1 to panel-1
    app1.moveTabToPanel('s1', 'panel-1');
    
    assertEqual(app1.activeSessionsByPanel.get('panel-1'), 's1', 'Moved tab (s1) is active in target panel');
    assertEqual(app1.activeSessionsByPanel.get('panel-0'), 's2', 'Source panel activated first remaining tab');
    
    // Test 2: Drag when source panel has only one tab
    console.log('\n--- Test 2: Drag when source panel has only one tab ---');
    const app2 = new MockApp();
    
    const t1 = createMockSession('t1', 'Terminal 1');
    app2.panels.get('panel-0').tabs.appendChild(t1.tab);
    app2.panels.get('panel-0').terminals.appendChild(t1.wrapper);
    app2.switchTab('t1', 'panel-0');
    
    // Move the only tab
    app2.moveTabToPanel('t1', 'panel-1');
    
    assertEqual(app2.activeSessionsByPanel.get('panel-1'), 't1', 'Moved tab is active in target panel');
    assertEqual(app2.activeSessionsByPanel.get('panel-0'), undefined, 'Source panel has no active session (empty)');
    
    // Test 3: Drag to empty panel
    console.log('\n--- Test 3: Drag to empty panel ---');
    const app3 = new MockApp();
    
    const u1 = createMockSession('u1', 'User 1');
    const u2 = createMockSession('u2', 'User 2');
    app3.panels.get('panel-0').tabs.appendChild(u1.tab);
    app3.panels.get('panel-0').tabs.appendChild(u2.tab);
    app3.panels.get('panel-0').terminals.appendChild(u1.wrapper);
    app3.panels.get('panel-0').terminals.appendChild(u2.wrapper);
    app3.switchTab('u1', 'panel-0');
    
    // Move to empty panel-1
    app3.moveTabToPanel('u1', 'panel-1');
    
    assertEqual(app3.activeSessionsByPanel.get('panel-1'), 'u1', 'Moved tab is active in empty target panel');
    assertEqual(app3.activeSessionsByPanel.get('panel-0'), 'u2', 'Source panel activated remaining tab');
    
    // Test 4: Multiple consecutive drags
    console.log('\n--- Test 4: Multiple consecutive drags ---');
    const app4 = new MockApp();
    
    const m1 = createMockSession('m1', 'Machine 1');
    const m2 = createMockSession('m2', 'Machine 2');
    const m3 = createMockSession('m3', 'Machine 3');
    const m4 = createMockSession('m4', 'Machine 4');
    
    app4.panels.get('panel-0').tabs.appendChild(m1.tab);
    app4.panels.get('panel-0').tabs.appendChild(m2.tab);
    app4.panels.get('panel-0').tabs.appendChild(m3.tab);
    app4.panels.get('panel-0').tabs.appendChild(m4.tab);
    app4.panels.get('panel-0').terminals.appendChild(m1.wrapper);
    app4.panels.get('panel-0').terminals.appendChild(m2.wrapper);
    app4.panels.get('panel-0').terminals.appendChild(m3.wrapper);
    app4.panels.get('panel-0').terminals.appendChild(m4.wrapper);
    app4.switchTab('m1', 'panel-0');
    
    // Move m1 to panel-1
    app4.moveTabToPanel('m1', 'panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-1'), 'm1', 'First move: m1 active in panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-0'), 'm2', 'First move: m2 active in panel-0');
    
    // Move m2 to panel-1
    app4.moveTabToPanel('m2', 'panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-1'), 'm2', 'Second move: m2 active in panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-0'), 'm3', 'Second move: m3 active in panel-0');
    
    // Move m3 to panel-1
    app4.moveTabToPanel('m3', 'panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-1'), 'm3', 'Third move: m3 active in panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-0'), 'm4', 'Third move: m4 active in panel-0');
    
    // Move m4 to panel-1
    app4.moveTabToPanel('m4', 'panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-1'), 'm4', 'Fourth move: m4 active in panel-1');
    assertEqual(app4.activeSessionsByPanel.get('panel-0'), undefined, 'Fourth move: panel-0 empty');
    
    // Test 5: Drag between three panels
    console.log('\n--- Test 5: Drag between three panels ---');
    const app5 = new MockApp();
    
    const p1 = createMockSession('p1', 'Panel 1');
    const p2 = createMockSession('p2', 'Panel 2');
    const p3 = createMockSession('p3', 'Panel 3');
    
    app5.panels.get('panel-0').tabs.appendChild(p1.tab);
    app5.panels.get('panel-0').tabs.appendChild(p2.tab);
    app5.panels.get('panel-0').tabs.appendChild(p3.tab);
    app5.panels.get('panel-0').terminals.appendChild(p1.wrapper);
    app5.panels.get('panel-0').terminals.appendChild(p2.wrapper);
    app5.panels.get('panel-0').terminals.appendChild(p3.wrapper);
    app5.switchTab('p1', 'panel-0');
    
    // Distribute across panels
    app5.moveTabToPanel('p1', 'panel-1');
    app5.moveTabToPanel('p2', 'panel-2');
    
    assertEqual(app5.activeSessionsByPanel.get('panel-0'), 'p3', 'Panel-0 has p3 active');
    assertEqual(app5.activeSessionsByPanel.get('panel-1'), 'p1', 'Panel-1 has p1 active');
    assertEqual(app5.activeSessionsByPanel.get('panel-2'), 'p2', 'Panel-2 has p2 active');
    
    // Move p3 from panel-0 to panel-1
    app5.moveTabToPanel('p3', 'panel-1');
    
    assertEqual(app5.activeSessionsByPanel.get('panel-0'), undefined, 'Panel-0 is now empty');
    assertEqual(app5.activeSessionsByPanel.get('panel-1'), 'p3', 'Panel-1 has p3 active (newly moved)');
    assertEqual(app5.activeSessionsByPanel.get('panel-2'), 'p2', 'Panel-2 still has p2 active');
    
    // Test 6: Verify DOM state (active classes)
    console.log('\n--- Test 6: Verify DOM state (active classes) ---');
    const app6 = new MockApp();
    
    const d1 = createMockSession('d1', 'Device 1');
    const d2 = createMockSession('d2', 'Device 2');
    
    app6.panels.get('panel-0').tabs.appendChild(d1.tab);
    app6.panels.get('panel-0').tabs.appendChild(d2.tab);
    app6.panels.get('panel-0').terminals.appendChild(d1.wrapper);
    app6.panels.get('panel-0').terminals.appendChild(d2.wrapper);
    app6.switchTab('d1', 'panel-0');
    
    // Move d1 to panel-1
    app6.moveTabToPanel('d1', 'panel-1');
    
    // Check active classes
    const activeTabsP0 = app6.panels.get('panel-0').tabs.querySelectorAll('.tab.active');
    const activeTabsP1 = app6.panels.get('panel-1').tabs.querySelectorAll('.tab.active');
    const activeTerminalsP0 = app6.panels.get('panel-0').terminals.querySelectorAll('.terminal-wrapper.active');
    const activeTerminalsP1 = app6.panels.get('panel-1').terminals.querySelectorAll('.terminal-wrapper.active');
    
    assertEqual(activeTabsP0.length, 1, 'Panel-0 has exactly 1 active tab');
    assertEqual(activeTabsP1.length, 1, 'Panel-1 has exactly 1 active tab');
    assertEqual(activeTerminalsP0.length, 1, 'Panel-0 has exactly 1 active terminal');
    assertEqual(activeTerminalsP1.length, 1, 'Panel-1 has exactly 1 active terminal');
    
    assertEqual(activeTabsP0[0].dataset.sessionId, 'd2', 'Panel-0 active tab is d2');
    assertEqual(activeTabsP1[0].dataset.sessionId, 'd1', 'Panel-1 active tab is d1');
    
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