/**
 * Integration tests for MobileTerminalHandler
 * Tests the mobile terminal handler in a browser environment
 */

const puppeteer = require('puppeteer');

describe('MobileTerminalHandler Integration Tests', () => {
  jest.setTimeout(30000);
  
  let browser;
  let page;
  
  beforeAll(async () => {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
      timeout: 10000
    });
  }, 15000);
  
  afterAll(async () => {
    if (browser) {
      await browser.close();
    }
  });
  
  beforeEach(async () => {
    page = await browser.newPage();
    // Emulate mobile device
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
  });
  
  afterEach(async () => {
    if (page) {
      await page.close();
    }
  });
  
  test('should load mobile-terminal.js script', async () => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 10000 });
    
    // Check that MobileTerminalHandler is defined
    const handlerExists = await page.evaluate(() => {
      return typeof window.MobileTerminalHandler !== 'undefined';
    });
    
    expect(handlerExists).toBe(true);
  });
  
  test('should detect mobile device', async () => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 10000 });
    
    const isMobile = await page.evaluate(() => {
      return window.app && window.app.isMobile;
    });
    
    expect(isMobile).toBe(true);
  });
  
  test('should create mobile handler instance when terminal is created', async () => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 10000 });
    
    // Wait for page to load
    await page.waitForSelector('#newSessionBtn', { timeout: 5000 });
    
    // Click new session button
    await page.click('#newSessionBtn');
    
    // Wait for connection modal
    await page.waitForSelector('#connectionModal', { visible: true, timeout: 5000 });
    
    // The test would continue with filling in connection details
    // but we can't actually connect without a real SSH server
    // This is a placeholder for integration testing
  });
  
  test('should have mobile CSS styles loaded', async () => {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2', timeout: 10000 });
    
    // Check that mobile CSS classes exist
    const hasMobileStyles = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      for (const sheet of styleSheets) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          const hasMobileClass = rules.some(rule => 
            rule.selectorText && rule.selectorText.includes('mobile-')
          );
          if (hasMobileClass) return true;
        } catch (e) {
          // Cross-origin stylesheets may throw
        }
      }
      return false;
    });
    
    expect(hasMobileStyles).toBe(true);
  });
});