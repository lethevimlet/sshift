/**
 * Browser tests for Settings Modal functionality
 * Tests the settings modal UI interactions
 */

const puppeteer = require('puppeteer');
const { sleep } = require('../helpers/test-utils');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

describe('Settings Modal Tests', () => {
  // Increase timeout for browser tests
  jest.setTimeout(60000);

  let browser;
  let page;

  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      timeout: 30000
    });
  }, 30000);

  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });

  beforeEach(async () => {
    page = await browser.newPage();
    
    // Enable console logging for debugging
    page.on('console', msg => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Filter out expected errors (favicon, missing resources, etc.)
        if (!text.includes('Failed to load resource') && 
            !text.includes('404') &&
            !text.includes('favicon.ico')) {
          console.error('Browser console error:', text);
        }
      }
    });
    
    // Navigate to the app
    await page.goto(SERVER_URL, { waitUntil: 'networkidle2' });
    await sleep(1000);
  });

  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });

  describe('Settings Button', () => {
    test('should have settings button visible', async () => {
      const settingsBtn = await page.$('#settingsBtn');
      expect(settingsBtn).not.toBeNull();
    });

    test('should open settings modal on click', async () => {
      await page.click('#settingsBtn');
      await sleep(500);
      
      const modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return modal && modal.classList.contains('active');
      });
      
      expect(modalVisible).toBe(true);
    });
  });

  describe('Modal Controls', () => {
    test('should close modal with close button (X)', async () => {
      // Open modal
      await page.click('#settingsBtn');
      await sleep(500);
      
      // Verify modal is open
      let modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return modal && modal.classList.contains('active');
      });
      expect(modalVisible).toBe(true);
      
      // Click close button
      const closeBtn = await page.$('#closeSettingsModal');
      expect(closeBtn).not.toBeNull();
      await closeBtn.click();
      await sleep(500);
      
      // Verify modal is closed
      modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return modal && modal.classList.contains('active');
      });
      expect(modalVisible).toBe(false);
    });

    test('should close modal with cancel button', async () => {
      // Open modal
      await page.click('#settingsBtn');
      await sleep(500);
      
      // Click cancel button
      const cancelBtn = await page.$('#cancelSettings');
      expect(cancelBtn).not.toBeNull();
      await cancelBtn.click();
      await sleep(500);
      
      // Verify modal is closed
      const modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return modal && modal.classList.contains('active');
      });
      expect(modalVisible).toBe(false);
    });
  });

  describe('Settings Persistence', () => {
    test('should save sticky setting', async () => {
      // Open modal
      await page.click('#settingsBtn');
      await sleep(500);
      
      // Get current sticky state
      const initialSticky = await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        return toggle ? toggle.checked : null;
      });
      
      // Toggle the checkbox
      await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        if (toggle) toggle.checked = !toggle.checked;
      });
      
      const toggledSticky = await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        return toggle ? toggle.checked : null;
      });
      
      // Click save
      const saveBtn = await page.$('#saveSettings');
      expect(saveBtn).not.toBeNull();
      await saveBtn.click();
      await sleep(1000);
      
      // Verify modal closed
      let modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('settingsModal');
        return modal && modal.classList.contains('active');
      });
      expect(modalVisible).toBe(false);
      
      // Reopen and verify setting was saved
      await page.click('#settingsBtn');
      await sleep(500);
      
      const savedSticky = await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        return toggle ? toggle.checked : null;
      });
      
      expect(savedSticky).toBe(toggledSticky);
      
      // Restore original state
      await page.evaluate((originalState) => {
        const toggle = document.getElementById('stickyToggle');
        if (toggle) toggle.checked = originalState;
      }, initialSticky);
      
      await saveBtn.click();
      await sleep(500);
    });

    test('should persist setting via API', async () => {
      // Open modal
      await page.click('#settingsBtn');
      await sleep(500);
      
      // Get current sticky state
      const initialSticky = await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        return toggle ? toggle.checked : null;
      });
      
      // Toggle and save
      await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        if (toggle) toggle.checked = !toggle.checked;
      });
      
      const toggledSticky = await page.evaluate(() => {
        const toggle = document.getElementById('stickyToggle');
        return toggle ? toggle.checked : null;
      });
      
      const saveBtn = await page.$('#saveSettings');
      await saveBtn.click();
      await sleep(1000);
      
      // Verify via API
      const configResponse = await page.evaluate(async () => {
        const response = await fetch('/api/config');
        return await response.json();
      });
      
      expect(configResponse.sticky).toBe(toggledSticky);
      
      // Restore original state via API
      await page.evaluate(async (originalState) => {
        await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sticky: originalState })
        });
      }, initialSticky);
    });
  });

  describe('Settings Form Elements', () => {
    test('should have all required form elements', async () => {
      await page.click('#settingsBtn');
      await sleep(500);
      
      // Check for sticky toggle
      const stickyToggle = await page.$('#stickyToggle');
      expect(stickyToggle).not.toBeNull();
      
      // Check for save button
      const saveBtn = await page.$('#saveSettings');
      expect(saveBtn).not.toBeNull();
      
      // Check for cancel button
      const cancelBtn = await page.$('#cancelSettings');
      expect(cancelBtn).not.toBeNull();
      
      // Check for close button
      const closeBtn = await page.$('#closeSettingsModal');
      expect(closeBtn).not.toBeNull();
    });
  });
});