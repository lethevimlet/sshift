/**
 * Test for multi-panel tab synchronization
 * Tests:
 * - Tab distribution across panels
 * - Tab persistence with multi-panel layouts
 * - Drag-and-drop between panels
 * - Mobile dropdown functionality
 * - Cross-tab synchronization
 */

const puppeteer = require('puppeteer');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const TEST_PORT = 3099;
const TEST_HOST = 'localhost';
const TEST_URL = `http://${TEST_HOST}:${TEST_PORT}`;

let serverProcess;
let browser;
let page1, page2;

// Helper function to wait for condition
async function waitFor(condition, timeout = 5000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await condition();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error('Timeout waiting for condition');
}

// Helper function to evaluate in page
async function evalInPage(page, fn, ...args) {
  return await page.evaluate(fn, ...args);
}

// Start server
async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('[TEST] Starting server...');
    
    serverProcess = spawn('node', ['src/server/server.js'], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, PORT: TEST_PORT, NODE_ENV: 'development' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[SERVER]', output);
      if (output.includes('Server started') || output.includes('listening')) {
        setTimeout(resolve, 1000); // Give server time to fully initialize
      }
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[SERVER ERROR]', data.toString());
    });

    serverProcess.on('error', (err) => {
      console.error('[SERVER PROCESS ERROR]', err);
      reject(err);
    });

    // Timeout if server doesn't start
    setTimeout(() => reject(new Error('Server start timeout')), 10000);
  });
}

// Stop server
async function stopServer() {
  if (serverProcess) {
    console.log('[TEST] Stopping server...');
    serverProcess.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

// Setup browser
async function setupBrowser() {
  console.log('[TEST] Setting up browser...');
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security'
    ]
  });
  
  page1 = await browser.newPage();
  page2 = await browser.newPage();
  
  // Set viewport
  await page1.setViewport({ width: 1280, height: 800 });
  await page2.setViewport({ width: 1280, height: 800 });
}

// Close browser
async function closeBrowser() {
  if (browser) {
    console.log('[TEST] Closing browser...');
    await browser.close();
  }
}

// Test: Tab distribution across panels
async function testTabDistribution() {
  console.log('\n[TEST] Testing tab distribution across panels...');
  
  await page1.goto(TEST_URL, { waitUntil: 'networkidle2' });
  
  // Wait for app to initialize
  await waitFor(async () => {
    return await evalInPage(page1, () => {
      return window.app && window.app.layouts !== null;
    });
  });
  
  // Set layout to 2-panel horizontal
  await evalInPage(page1, () => {
    window.app.setLayout('2-panel-horizontal');
  });
  
  await page1.waitForTimeout(500);
  
  // Create SSH connections
  await evalInPage(page1, () => {
    // Mock SSH connection
    window.app.createSSHTab('test-tab-1', { host: 'localhost', port: 22, username: 'user1' }, 'session-1');
    window.app.createSSHTab('test-tab-2', { host: 'localhost', port: 22, username: 'user2' }, 'session-2');
    window.app.createSSHTab('test-tab-3', { host: 'localhost', port: 22, username: 'user3' }, 'session-3');
  });
  
  await page1.waitForTimeout(500);
  
  // Check tab distribution
  const distribution = await evalInPage(page1, () => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const tabsContainer = window.app.getTabsContainer(panelId);
      if (tabsContainer) {
        result[panelId] = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
      }
    });
    
    return result;
  });
  
  console.log('[TEST] Tab distribution:', distribution);
  
  // Verify tabs are distributed
  const totalTabs = Object.values(distribution).reduce((sum, tabs) => sum + tabs.length, 0);
  if (totalTabs !== 3) {
    throw new Error(`Expected 3 tabs, got ${totalTabs}`);
  }
  
  console.log('[TEST] ✓ Tab distribution test passed');
}

// Test: Tab persistence with multi-panel layouts
async function testTabPersistence() {
  console.log('\n[TEST] Testing tab persistence with multi-panel layouts...');
  
  // Get saved tabs
  const savedTabs = await evalInPage(page1, () => {
    const tabsData = JSON.parse(localStorage.getItem('openTabs') || '{}');
    return tabsData;
  });
  
  console.log('[TEST] Saved tabs:', savedTabs);
  
  // Verify tabs have panel assignments
  if (!savedTabs.tabs || !Array.isArray(savedTabs.tabs)) {
    throw new Error('Invalid saved tabs format');
  }
  
  savedTabs.tabs.forEach(tab => {
    if (!tab.panelId) {
      throw new Error(`Tab ${tab.sessionId} missing panelId`);
    }
  });
  
  // Verify layout is saved
  if (!savedTabs.layout) {
    throw new Error('Layout not saved');
  }
  
  console.log('[TEST] ✓ Tab persistence test passed');
}

// Test: Cross-tab synchronization
async function testCrossTabSync() {
  console.log('\n[TEST] Testing cross-tab synchronization...');
  
  // Open second page
  await page2.goto(TEST_URL, { waitUntil: 'networkidle2' });
  
  // Wait for app to initialize
  await waitFor(async () => {
    return await evalInPage(page2, () => {
      return window.app && window.app.layouts !== null;
    });
  });
  
  await page2.waitForTimeout(1000);
  
  // Check if layout synced
  const layout2 = await evalInPage(page2, () => {
    return window.app.currentLayout?.id;
  });
  
  console.log('[TEST] Page 2 layout:', layout2);
  
  // Check if tabs synced
  const tabs2 = await evalInPage(page2, () => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const tabsContainer = window.app.getTabsContainer(panelId);
      if (tabsContainer) {
        result[panelId] = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
      }
    });
    
    return result;
  });
  
  console.log('[TEST] Page 2 tabs:', tabs2);
  
  // Verify tabs synced
  const totalTabs2 = Object.values(tabs2).reduce((sum, tabs) => sum + tabs.length, 0);
  if (totalTabs2 !== 3) {
    throw new Error(`Expected 3 tabs in page 2, got ${totalTabs2}`);
  }
  
  console.log('[TEST] ✓ Cross-tab sync test passed');
}

// Test: Mobile dropdown functionality
async function testMobileDropdown() {
  console.log('\n[TEST] Testing mobile dropdown functionality...');
  
  // Set mobile viewport
  await page1.setViewport({ width: 375, height: 667 });
  
  await page1.waitForTimeout(500);
  
  // Check mobile dropdown exists
  const mobileDropdown = await evalInPage(page1, () => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const toggle = document.getElementById(panelId === 'panel-0' ? 'mobileTabsToggle' : `${panelId}-mobileTabsToggle`);
      const menu = document.getElementById(panelId === 'panel-0' ? 'mobileTabsMenu' : `${panelId}-mobileTabsMenu`);
      
      result[panelId] = {
        hasToggle: !!toggle,
        hasMenu: !!menu
      };
    });
    
    return result;
  });
  
  console.log('[TEST] Mobile dropdown:', mobileDropdown);
  
  // Verify mobile dropdown exists for all panels
  Object.entries(mobileDropdown).forEach(([panelId, { hasToggle, hasMenu }]) => {
    if (!hasToggle || !hasMenu) {
      throw new Error(`Mobile dropdown missing for panel ${panelId}`);
    }
  });
  
  console.log('[TEST] ✓ Mobile dropdown test passed');
}

// Test: Drag and drop between panels
async function testDragAndDrop() {
  console.log('\n[TEST] Testing drag and drop between panels...');
  
  // Reset viewport
  await page1.setViewport({ width: 1280, height: 800 });
  
  await page1.waitForTimeout(500);
  
  // Get initial tab positions
  const initialPositions = await evalInPage(page1, () => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const tabsContainer = window.app.getTabsContainer(panelId);
      if (tabsContainer) {
        result[panelId] = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
      }
    });
    
    return result;
  });
  
  console.log('[TEST] Initial positions:', initialPositions);
  
  // Move a tab to another panel
  await evalInPage(page1, () => {
    // Move session-1 to panel-1
    window.app.moveTabToPanel('session-1', 'panel-1');
  });
  
  await page1.waitForTimeout(500);
  
  // Get new tab positions
  const newPositions = await evalInPage(page1, () => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const tabsContainer = window.app.getTabsContainer(panelId);
      if (tabsContainer) {
        result[panelId] = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
      }
    });
    
    return result;
  });
  
  console.log('[TEST] New positions:', newPositions);
  
  // Verify tab moved
  if (!newPositions['panel-1'] || !newPositions['panel-1'].includes('session-1')) {
    throw new Error('Tab not moved to panel-1');
  }
  
  console.log('[TEST] ✓ Drag and drop test passed');
}

// Main test runner
async function runTests() {
  try {
    console.log('[TEST] Starting multi-panel tab synchronization tests...\n');
    
    await startServer();
    await setupBrowser();
    
    await testTabDistribution();
    await testTabPersistence();
    await testCrossTabSync();
    await testMobileDropdown();
    await testDragAndDrop();
    
    console.log('\n[TEST] ✓ All tests passed!');
    return true;
  } catch (error) {
    console.error('\n[TEST] ✗ Test failed:', error.message);
    console.error(error.stack);
    return false;
  } finally {
    await closeBrowser();
    await stopServer();
  }
}

// Run tests
runTests().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('[TEST] Fatal error:', error);
  process.exit(1);
});