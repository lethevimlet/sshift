/**
 * Test for duplicate ghost tabs issue on page reload
 * 
 * This test reproduces the issue where:
 * 1. Open a bookmarked SSH connection
 * 2. Reload the page
 * 3. Expected: Only one tab should be visible
 * 4. Actual: Tab gets duplicated, "take control" overlay is shown and can't click
 */

const puppeteer = require('puppeteer');
const path = require('path');

// Test configuration
const TEST_CONFIG = {
  serverPort: 8022,
  testHost: process.env.TEST_SSH_HOST || 'localhost',
  testPort: process.env.TEST_SSH_PORT || 22,
  testUsername: process.env.TEST_SSH_USER || 'testuser',
  testPassword: process.env.TEST_SSH_PASS || 'testpass',
  headless: process.env.HEADLESS === 'true',
  slowMo: parseInt(process.env.SLOW_MO || '0'),
  timeout: 30000
};

class TestHelper {
  constructor(page) {
    this.page = page;
  }

  async waitFor(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getTabCount() {
    return await this.page.evaluate(() => {
      const tabs = document.querySelectorAll('.tab');
      const panelTabs = document.querySelectorAll('.panel-tab');
      return {
        mainTabs: tabs.length,
        panelTabs: panelTabs.length,
        total: tabs.length + panelTabs.length
      };
    });
  }

  async getSessionCount() {
    return await this.page.evaluate(() => {
      // Access the app instance from window
      if (window.app && window.app.sessions) {
        return window.app.sessions.size;
      }
      return 0;
    });
  }

  async getVisibleOverlays() {
    return await this.page.evaluate(() => {
      const overlays = document.querySelectorAll('.terminal-control-overlay');
      const visible = [];
      overlays.forEach(overlay => {
        const style = window.getComputedStyle(overlay);
        if (style.display !== 'none' && style.visibility !== 'hidden') {
          visible.push(overlay.id);
        }
      });
      return visible;
    });
  }

  async clickTakeControlButton(sessionId) {
    const button = await this.page.$(`#take-control-btn-${sessionId}`);
    if (button) {
      await button.click();
      await this.waitFor(500);
      return true;
    }
    return false;
  }

  async reloadAndWait() {
    await this.page.reload({ waitUntil: 'networkidle2' });
    await this.waitFor(2000); // Wait for restoration to complete
  }

  async createBookmark(name, host, port, username) {
    await this.page.evaluate(({ name, host, port, username }) => {
      if (window.app) {
        window.app.addBookmark({
          name,
          host,
          port: parseInt(port),
          username,
          type: 'ssh'
        });
      }
    }, { name, host, port, username });
    await this.waitFor(500);
  }

  async connectToBookmark(bookmarkName) {
    // Click on the bookmark in the sidebar
    const bookmark = await this.page.$(`.bookmark-item[data-name="${bookmarkName}"]`);
    if (bookmark) {
      await bookmark.click();
      await this.waitFor(1000);
      return true;
    }
    return false;
  }

  async closeAllTabs() {
    await this.page.evaluate(() => {
      if (window.app) {
        const sessions = Array.from(window.app.sessions.keys());
        sessions.forEach(sessionId => {
          window.app.closeTab(sessionId);
        });
      }
    });
    await this.waitFor(500);
  }
}

async function runTest() {
  console.log('🚀 Starting duplicate tabs test...');
  console.log('Configuration:', TEST_CONFIG);

  let browser;
  let page;
  let helper;

  try {
    // Launch browser
    browser = await puppeteer.launch({
      headless: TEST_CONFIG.headless,
      slowMo: TEST_CONFIG.sLOW_MO,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    page = await browser.newPage();
    helper = new TestHelper(page);

    // Set viewport
    await page.setViewport({ width: 1280, height: 800 });

    // Navigate to the application
    console.log('📱 Navigating to application...');
    await page.goto(`http://localhost:${TEST_CONFIG.serverPort}`, {
      waitUntil: 'networkidle2'
    });

    // Wait for app to initialize
    await helper.waitFor(2000);

    // Test 1: Check initial state
    console.log('\n📋 Test 1: Initial state');
    const initialTabs = await helper.getTabCount();
    const initialSessions = await helper.getSessionCount();
    console.log(`  Initial tabs: ${JSON.stringify(initialTabs)}`);
    console.log(`  Initial sessions: ${initialSessions}`);

    // Test 2: Create a bookmark and connect
    console.log('\n📋 Test 2: Create bookmark and connect');
    await helper.createBookmark(
      'test-server',
      TEST_CONFIG.testHost,
      TEST_CONFIG.testPort,
      TEST_CONFIG.testUsername
    );

    // Open connection modal
    await page.click('#quickSshBtn');
    await helper.waitFor(500);

    // Fill connection details
    await page.type('#connHost', TEST_CONFIG.testHost);
    await page.type('#connPort', TEST_CONFIG.testPort.toString());
    await page.type('#connUsername', TEST_CONFIG.testUsername);
    if (TEST_CONFIG.testPassword) {
      await page.type('#connPassword', TEST_CONFIG.testPassword);
    }

    // Connect
    await page.click('#connectBtn');
    await helper.waitFor(2000);

    // Check tabs after connection
    const afterConnectTabs = await helper.getTabCount();
    const afterConnectSessions = await helper.getSessionCount();
    console.log(`  Tabs after connect: ${JSON.stringify(afterConnectTabs)}`);
    console.log(`  Sessions after connect: ${afterConnectSessions}`);

    if (afterConnectTabs.total !== 1) {
      console.error(`❌ FAIL: Expected 1 tab after connect, got ${afterConnectTabs.total}`);
      return false;
    }

    console.log('✅ Tab created successfully');

    // Test 3: Reload page and check for duplicates
    console.log('\n📋 Test 3: Reload page and check for duplicates');
    await helper.reloadAndWait();

    // Check tabs after reload
    const afterReloadTabs = await helper.getTabCount();
    const afterReloadSessions = await helper.getSessionCount();
    console.log(`  Tabs after reload: ${JSON.stringify(afterReloadTabs)}`);
    console.log(`  Sessions after reload: ${afterReloadSessions}`);

    if (afterReloadTabs.total !== 1) {
      console.error(`❌ FAIL: Expected 1 tab after reload, got ${afterReloadTabs.total}`);
      console.error('  This indicates duplicate tabs issue!');
      
      // Check for visible overlays
      const visibleOverlays = await helper.getVisibleOverlays();
      console.log(`  Visible overlays: ${JSON.stringify(visibleOverlays)}`);
      
      return false;
    }

    console.log('✅ No duplicate tabs after reload');

    // Test 4: Check for "take control" overlay
    console.log('\n📋 Test 4: Check for "take control" overlay');
    const visibleOverlays = await helper.getVisibleOverlays();
    console.log(`  Visible overlays: ${JSON.stringify(visibleOverlays)}`);

    if (visibleOverlays.length > 0) {
      console.error('❌ FAIL: "Take control" overlay is visible when it should not be');
      
      // Try to click the take control button
      const sessionId = afterReloadSessions > 0 ? Array.from(await page.evaluate(() => {
        return Array.from(window.app.sessions.keys());
      }))[0] : null;
      
      if (sessionId) {
        console.log(`  Attempting to click take control button for session: ${sessionId}`);
        const clicked = await helper.clickTakeControlButton(sessionId);
        if (clicked) {
          console.log('  ✅ Take control button clicked successfully');
          await helper.waitFor(1000);
          
          // Check if overlay is now hidden
          const overlaysAfterClick = await helper.getVisibleOverlays();
          console.log(`  Overlays after click: ${JSON.stringify(overlaysAfterClick)}`);
        } else {
          console.error('  ❌ Could not click take control button');
        }
      }
      
      return false;
    }

    console.log('✅ No unwanted "take control" overlay');

    // Test 5: Multiple reloads
    console.log('\n📋 Test 5: Multiple reloads');
    for (let i = 0; i < 3; i++) {
      console.log(`  Reload ${i + 1}...`);
      await helper.reloadAndWait();
      
      const tabs = await helper.getTabCount();
      const sessions = await helper.getSessionCount();
      console.log(`    Tabs: ${JSON.stringify(tabs)}, Sessions: ${sessions}`);
      
      if (tabs.total !== 1) {
        console.error(`❌ FAIL: Duplicate tabs on reload ${i + 1}`);
        return false;
      }
    }

    console.log('✅ No duplicate tabs after multiple reloads');

    // Clean up
    console.log('\n🧹 Cleaning up...');
    await helper.closeAllTabs();

    console.log('\n✅ All tests passed!');
    return true;

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the test
runTest().then(success => {
  process.exit(success ? 0 : 1);
}).catch(error => {
  console.error('Test execution failed:', error);
  process.exit(1);
});