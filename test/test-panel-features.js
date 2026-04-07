/**
 * Test for panel layout features
 * Tests:
 * - Bookmark opening on first panel in all layouts
 * - Tab dragging between panels
 * - Empty panel drop support
 * - Active tab selection during layout changes
 */

const puppeteer = require('puppeteer');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const TEST_PORT = 3097;
const TEST_HOST = 'localhost';
const TEST_URL = `http://${TEST_HOST}:${TEST_PORT}`;

let serverProcess;
let browser;
let page;

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

// Start server
async function startServer() {
  return new Promise((resolve, reject) => {
    console.log('[TEST] Starting server...');
    
    serverProcess = spawn('node', ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: TEST_PORT, NODE_ENV: 'development' },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log('[SERVER]', output);
      if (output.includes('Web SSH/SFTP Client running') || output.includes('listening')) {
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
  
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  
  console.log('[TEST] Browser setup complete');
}

// Close browser
async function closeBrowser() {
  if (browser) {
    console.log('[TEST] Closing browser...');
    await browser.close();
  }
}

// Test: Bookmark opening on first panel
async function testBookmarkOpening() {
  console.log('\n[TEST] Testing bookmark opening on first panel...');
  
  await page.goto(TEST_URL);
  await page.waitForSelector('.app-container', { timeout: 5000 });
  
  // Create a test bookmark
  await page.evaluate(() => {
    window.app.bookmarks = [{
      id: 'test-ssh-1',
      name: 'Test SSH',
      type: 'ssh',
      host: 'localhost',
      port: 22,
      username: 'testuser'
    }];
    window.app.renderBookmarks();
  });
  
  // Test in single panel layout
  console.log('[TEST] Testing in single panel layout...');
  await page.click('[data-bookmark-id="test-ssh-1"]');
  await page.waitForSelector('.tab.active', { timeout: 3000 });
  
  const singlePanelTab = await page.evaluate(() => {
    const activeTab = document.querySelector('.tab.active');
    const panelId = activeTab ? activeTab.closest('.panel')?.id : null;
    return { activeTab: !!activeTab, panelId };
  });
  
  console.log('[TEST] Single panel result:', singlePanelTab);
  
  if (!singlePanelTab.activeTab) {
    throw new Error('No active tab found in single panel layout');
  }
  
  // Close the tab
  await page.click('.tab-close');
  await page.waitForTimeout(500);
  
  // Switch to 2-column layout
  console.log('[TEST] Testing in 2-column layout...');
  await page.evaluate(() => {
    window.app.setLayout('2-columns');
  });
  await page.waitForTimeout(500);
  
  // Open bookmark again
  await page.click('[data-bookmark-id="test-ssh-1"]');
  await page.waitForSelector('.tab.active', { timeout: 3000 });
  
  const twoColumnTab = await page.evaluate(() => {
    const activeTab = document.querySelector('.tab.active');
    const panelId = activeTab ? activeTab.closest('.panel')?.id : null;
    const tabsContainer = activeTab ? activeTab.closest('.tabs') : null;
    const panelTabs = tabsContainer ? tabsContainer.id : null;
    return { activeTab: !!activeTab, panelId, panelTabs };
  });
  
  console.log('[TEST] 2-column result:', twoColumnTab);
  
  // Verify tab is in first panel
  if (twoColumnTab.panelId !== 'panel-0') {
    throw new Error(`Expected tab in panel-0, got ${twoColumnTab.panelId}`);
  }
  
  console.log('[TEST] ✓ Bookmark opening test passed');
}

// Test: Tab dragging between panels
async function testTabDragging() {
  console.log('\n[TEST] Testing tab dragging between panels...');
  
  await page.goto(TEST_URL);
  await page.waitForSelector('.app-container', { timeout: 5000 });
  
  // Switch to 2-column layout
  await page.evaluate(() => {
    window.app.setLayout('2-columns');
  });
  await page.waitForTimeout(500);
  
  // Create two tabs in first panel
  await page.evaluate(() => {
    window.app.createSSHTab('Tab1', { host: 'host1', username: 'user1' });
    window.app.createSSHTab('Tab2', { host: 'host2', username: 'user2' });
  });
  await page.waitForTimeout(500);
  
  // Verify both tabs are in first panel
  const beforeDrag = await page.evaluate(() => {
    const panel0Tabs = document.querySelectorAll('#panel-0 .tab');
    const panel1Tabs = document.querySelectorAll('#panel-1 .tab');
    return {
      panel0Count: panel0Tabs.length,
      panel1Count: panel1Tabs.length
    };
  });
  
  console.log('[TEST] Before drag:', beforeDrag);
  
  if (beforeDrag.panel0Count !== 2) {
    throw new Error(`Expected 2 tabs in panel-0, got ${beforeDrag.panel0Count}`);
  }
  
  // Drag first tab to second panel
  const dragResult = await page.evaluate(() => {
    const tab1 = document.querySelector('[data-session-id^="ssh-"]');
    const panel1TabsContainer = document.querySelector('#panel-1-tabs');
    
    if (!tab1 || !panel1TabsContainer) {
      return { success: false, error: 'Elements not found' };
    }
    
    // Simulate drag and drop
    const sessionId = tab1.dataset.sessionId;
    window.app.draggedTab = sessionId;
    
    // Move tab to panel-1
    window.app.moveTabToPanel(sessionId, 'panel-1');
    
    return { success: true, sessionId };
  });
  
  console.log('[TEST] Drag result:', dragResult);
  
  await page.waitForTimeout(500);
  
  // Verify tabs are distributed
  const afterDrag = await page.evaluate(() => {
    const panel0Tabs = document.querySelectorAll('#panel-0 .tab');
    const panel1Tabs = document.querySelectorAll('#panel-1 .tab');
    return {
      panel0Count: panel0Tabs.length,
      panel1Count: panel1Tabs.length
    };
  });
  
  console.log('[TEST] After drag:', afterDrag);
  
  if (afterDrag.panel0Count !== 1 || afterDrag.panel1Count !== 1) {
    throw new Error(`Expected 1 tab in each panel, got panel-0: ${afterDrag.panel0Count}, panel-1: ${afterDrag.panel1Count}`);
  }
  
  console.log('[TEST] ✓ Tab dragging test passed');
}

// Test: Empty panel drop support
async function testEmptyPanelDrop() {
  console.log('\n[TEST] Testing empty panel drop support...');
  
  await page.goto(TEST_URL);
  await page.waitForSelector('.app-container', { timeout: 5000 });
  
  // Switch to 2-column layout
  await page.evaluate(() => {
    window.app.setLayout('2-columns');
  });
  await page.waitForTimeout(500);
  
  // Create one tab in first panel
  await page.evaluate(() => {
    window.app.createSSHTab('Tab1', { host: 'host1', username: 'user1' });
  });
  await page.waitForTimeout(500);
  
  // Verify second panel is empty
  const beforeDrop = await page.evaluate(() => {
    const panel1Tabs = document.querySelectorAll('#panel-1 .tab');
    const panel1EmptyState = document.querySelector('#panel-1-emptyState');
    return {
      panel1Count: panel1Tabs.length,
      hasEmptyState: !!panel1EmptyState && panel1EmptyState.style.display !== 'none'
    };
  });
  
  console.log('[TEST] Before drop:', beforeDrop);
  
  // Drag tab to empty panel
  await page.evaluate(() => {
    const tab = document.querySelector('[data-session-id^="ssh-"]');
    const sessionId = tab.dataset.sessionId;
    
    // Simulate drag and drop on empty panel
    window.app.draggedTab = sessionId;
    window.app.moveTabToPanel(sessionId, 'panel-1');
  });
  
  await page.waitForTimeout(500);
  
  // Verify tab moved to second panel
  const afterDrop = await page.evaluate(() => {
    const panel0Tabs = document.querySelectorAll('#panel-0 .tab');
    const panel1Tabs = document.querySelectorAll('#panel-1 .tab');
    const panel1EmptyState = document.querySelector('#panel-1-emptyState');
    return {
      panel0Count: panel0Tabs.length,
      panel1Count: panel1Tabs.length,
      emptyStateHidden: panel1EmptyState ? panel1EmptyState.style.display === 'none' : true
    };
  });
  
  console.log('[TEST] After drop:', afterDrop);
  
  if (afterDrop.panel1Count !== 1) {
    throw new Error(`Expected 1 tab in panel-1, got ${afterDrop.panel1Count}`);
  }
  
  if (!afterDrop.emptyStateHidden) {
    throw new Error('Empty state should be hidden after dropping tab');
  }
  
  console.log('[TEST] ✓ Empty panel drop test passed');
}

// Test: Active tab selection during layout changes
async function testActiveTabSelection() {
  console.log('\n[TEST] Testing active tab selection during layout changes...');
  
  await page.goto(TEST_URL);
  await page.waitForSelector('.app-container', { timeout: 5000 });
  
  // Create two tabs in single panel
  await page.evaluate(() => {
    window.app.createSSHTab('Tab1', { host: 'host1', username: 'user1' });
    window.app.createSSHTab('Tab2', { host: 'host2', username: 'user2' });
  });
  await page.waitForTimeout(500);
  
  // Activate second tab
  const tabs = await page.$$('.tab');
  if (tabs.length >= 2) {
    await tabs[1].click();
    await page.waitForTimeout(300);
  }
  
  // Verify second tab is active
  const beforeChange = await page.evaluate(() => {
    const activeTab = document.querySelector('.tab.active');
    return {
      activeTabName: activeTab ? activeTab.querySelector('.tab-name').textContent : null
    };
  });
  
  console.log('[TEST] Before layout change:', beforeChange);
  
  // Switch to 2-column layout
  await page.evaluate(() => {
    window.app.setLayout('2-columns');
  });
  await page.waitForTimeout(500);
  
  // Verify active tab is still the same
  const afterChange = await page.evaluate(() => {
    const activeTab = document.querySelector('.tab.active');
    return {
      activeTabName: activeTab ? activeTab.querySelector('.tab-name').textContent : null
    };
  });
  
  console.log('[TEST] After layout change:', afterChange);
  
  if (beforeChange.activeTabName !== afterChange.activeTabName) {
    throw new Error(`Active tab changed from "${beforeChange.activeTabName}" to "${afterChange.activeTabName}"`);
  }
  
  // Switch back to single panel
  await page.evaluate(() => {
    window.app.setLayout('single');
  });
  await page.waitForTimeout(500);
  
  // Verify active tab is still the same
  const afterSingle = await page.evaluate(() => {
    const activeTab = document.querySelector('.tab.active');
    return {
      activeTabName: activeTab ? activeTab.querySelector('.tab-name').textContent : null
    };
  });
  
  console.log('[TEST] After single panel:', afterSingle);
  
  if (beforeChange.activeTabName !== afterSingle.activeTabName) {
    throw new Error(`Active tab changed from "${beforeChange.activeTabName}" to "${afterSingle.activeTabName}" after returning to single panel`);
  }
  
  console.log('[TEST] ✓ Active tab selection test passed');
}

// Main test runner
async function runTests() {
  try {
    await startServer();
    await setupBrowser();
    
    // Run all tests
    await testBookmarkOpening();
    await testTabDragging();
    await testEmptyPanelDrop();
    await testActiveTabSelection();
    
    console.log('\n[TEST] ✓ All tests passed!');
  } catch (error) {
    console.error('\n[TEST] ✗ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await closeBrowser();
    await stopServer();
  }
}

// Run tests
runTests();