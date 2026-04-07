/**
 * Test for bookmark opening in first panel and tab dragging between panels
 */

const puppeteer = require('puppeteer');
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');

// Test configuration
const TEST_PORT = 3100;
const TEST_HOST = 'localhost';
const TEST_URL = `http://${TEST_HOST}:${TEST_PORT}`;

let serverProcess;
let browser;
let page;

// Helper function to wait for condition
async function waitFor(condition, timeout = 10000, interval = 100) {
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
      console.log('[SERVER]', output.trim());
    });

    serverProcess.stderr.on('data', (data) => {
      console.error('[SERVER ERROR]', data.toString().trim());
    });

    serverProcess.on('error', (err) => {
      console.error('[SERVER PROCESS ERROR]', err);
      reject(err);
    });

    // Wait for server to be ready
    setTimeout(resolve, 2000);
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
}

// Close browser
async function closeBrowser() {
  if (browser) {
    console.log('[TEST] Closing browser...');
    await browser.close();
  }
}

// Test: Bookmark opens in first panel
async function testBookmarkOpensInFirstPanel() {
  console.log('\n[TEST] Testing bookmark opens in first panel...');
  
  await page.goto(TEST_URL, { waitUntil: 'networkidle2' });
  
  // Wait for app to initialize
  await waitFor(async () => {
    return await page.evaluate(() => {
      return window.app && window.app.layouts !== null;
    });
  });
  
  // Set layout to 2-panel horizontal
  await page.evaluate(() => {
    window.app.setLayout('2-panel-horizontal');
  });
  
  await page.waitForTimeout(500);
  
  // Get all panels
  const panels = await page.evaluate(() => {
    return window.app.getAllPanels();
  });
  
  console.log('[TEST] Panels:', panels);
  
  // Create a mock bookmark connection
  await page.evaluate(() => {
    // Mock bookmark connection
    const bookmarkData = {
      host: 'localhost',
      port: 22,
      username: 'testuser',
      name: 'Test Bookmark'
    };
    window.app.createSSHTab('Test Bookmark', bookmarkData, 'bookmark-session-1');
  });
  
  await page.waitForTimeout(500);
  
  // Check which panel the tab was added to
  const tabLocation = await page.evaluate(() => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const tabsContainer = window.app.getTabsContainer(panelId);
      if (tabsContainer) {
        const tabs = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
        if (tabs.length > 0) {
          result[panelId] = tabs;
        }
      }
    });
    
    return result;
  });
  
  console.log('[TEST] Tab locations:', tabLocation);
  
  // Verify tab is in the first panel
  const firstPanelId = panels[0];
  if (!tabLocation[firstPanelId] || !tabLocation[firstPanelId].includes('bookmark-session-1')) {
    throw new Error(`Tab not in first panel (${firstPanelId}). Found in: ${JSON.stringify(tabLocation)}`);
  }
  
  console.log('[TEST] ✓ Bookmark opens in first panel test passed');
}

// Test: Tab dragging between panels
async function testTabDraggingBetweenPanels() {
  console.log('\n[TEST] Testing tab dragging between panels...');
  
  // Create another tab in the first panel
  await page.evaluate(() => {
    window.app.createSSHTab('Test Tab 2', { host: 'localhost', port: 22, username: 'user2' }, 'session-2');
  });
  
  await page.waitForTimeout(500);
  
  // Get initial positions
  const initialPositions = await page.evaluate(() => {
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
  
  // Move tab to second panel using moveTabToPanel
  await page.evaluate(() => {
    window.app.moveTabToPanel('session-2', 'panel-0-1');
  });
  
  await page.waitForTimeout(500);
  
  // Get new positions
  const newPositions = await page.evaluate(() => {
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
  
  // Verify tab moved to second panel
  if (!newPositions['panel-0-1'] || !newPositions['panel-0-1'].includes('session-2')) {
    throw new Error('Tab not moved to panel-0-1');
  }
  
  console.log('[TEST] ✓ Tab dragging between panels test passed');
}

// Test: SFTP tab opens in first panel
async function testSFTPTabOpensInFirstPanel() {
  console.log('\n[TEST] Testing SFTP tab opens in first panel...');
  
  // Create SFTP tab
  await page.evaluate(() => {
    window.app.createSFTPTab('Test SFTP', { host: 'localhost', port: 22, username: 'sftpuser' }, 'sftp-session-1');
  });
  
  await page.waitForTimeout(500);
  
  // Check which panel the SFTP tab was added to
  const tabLocation = await page.evaluate(() => {
    const panels = window.app.getAllPanels();
    const result = {};
    
    panels.forEach(panelId => {
      const tabsContainer = window.app.getTabsContainer(panelId);
      if (tabsContainer) {
        const tabs = Array.from(tabsContainer.children).map(tab => tab.dataset.sessionId);
        if (tabs.includes('sftp-session-1')) {
          result[panelId] = tabs;
        }
      }
    });
    
    return result;
  });
  
  console.log('[TEST] SFTP Tab location:', tabLocation);
  
  // Verify SFTP tab is in the first panel
  const panels = await page.evaluate(() => window.app.getAllPanels());
  const firstPanelId = panels[0];
  
  if (!tabLocation[firstPanelId]) {
    throw new Error(`SFTP Tab not in first panel (${firstPanelId}). Found in: ${JSON.stringify(tabLocation)}`);
  }
  
  console.log('[TEST] ✓ SFTP tab opens in first panel test passed');
}

// Main test runner
async function runTests() {
  try {
    console.log('[TEST] Starting bookmark and tab drag tests...\n');
    
    await startServer();
    await setupBrowser();
    
    await testBookmarkOpensInFirstPanel();
    await testTabDraggingBetweenPanels();
    await testSFTPTabOpensInFirstPanel();
    
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