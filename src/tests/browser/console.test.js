/**
 * Browser tests for console errors
 * Tests for browser console errors and warnings
 */

const puppeteer = require('puppeteer');
const { sleep } = require('../helpers/test-utils');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const TEST_CONFIG = {
  host: process.env.TEST_HOST || 'localhost',
  port: process.env.TEST_PORT || '22',
  username: process.env.TEST_USER || '',
  password: process.env.TEST_PASS || ''
};

// Check if SSH tests should be skipped
const SKIP_SSH_TESTS = process.env.SKIP_SSH_TESTS === 'true' || !process.env.TEST_USER;

// Skip SSH tests if no SSH server is available - must be at module level
const describeSSH = SKIP_SSH_TESTS ? describe.skip : describe;

describe('Browser Console Tests', () => {
  // Increase timeout for browser tests
  jest.setTimeout(60000);

  let browser;
  let page;
  let consoleMessages = [];
  let errors = [];

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

  beforeEach(() => {
    consoleMessages = [];
    errors = [];
  });

  describe('Page Load Console Errors', () => {
    beforeEach(async () => {
      page = await browser.newPage();
      
      // Collect console messages
      page.on('console', msg => {
        consoleMessages.push({
          type: msg.type(),
          text: msg.text()
        });
      });
      
      // Collect errors
      page.on('pageerror', error => {
        errors.push(error.toString());
      });
    });

    afterEach(async () => {
      if (page) {
        await page.close();
      }
    });

    test('should not have console errors on page load', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(2000);
      
      const consoleErrors = consoleMessages.filter(msg => msg.type === 'error');
      // Filter out expected warnings/info that might be logged as errors
      const unexpectedErrors = consoleErrors.filter(msg => {
        const text = msg.text || '';
        // Allow certain expected messages (e.g., missing favicon, missing resources)
        return !text.includes('Expected warning') && 
               !text.includes('dotenv') &&
               !text.includes('injecting env') &&
               !text.includes('Failed to load resource') &&
               !text.includes('404');
      });
      expect(unexpectedErrors.length).toBe(0);
    });

    test('should not have page errors on load', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(2000);
      
      expect(errors.length).toBe(0);
    });

    test('should load xterm.js libraries', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(2000);
      
      const xtermLoaded = await page.evaluate(() => {
        return {
          hasTerminal: typeof window.Terminal !== 'undefined',
          hasFitAddon: typeof window.FitAddon !== 'undefined',
          hasWebLinks: typeof window.WebLinksAddon !== 'undefined',
          hasSearch: typeof window.SearchAddon !== 'undefined'
        };
      });
      
      expect(xtermLoaded.hasTerminal).toBe(true);
    });
  });

  describeSSH('SSH Connection Console Errors', () => {
    beforeEach(async () => {
      page = await browser.newPage();
      
      page.on('console', msg => {
        consoleMessages.push({
          type: msg.type(),
          text: msg.text()
        });
      });
      
      page.on('pageerror', error => {
        errors.push(error.toString());
      });
    });

    afterEach(async () => {
      if (page) {
        await page.close();
      }
    });

    test('should not have console errors during SSH connection', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(1000);
      
      // Open connection modal
      await page.click('#newSshBtn');
      await sleep(500);
      
      // Fill in connection form
      await page.type('#connHost', TEST_CONFIG.host);
      await page.type('#connUsername', TEST_CONFIG.username);
      await page.type('#connPassword', TEST_CONFIG.password);
      
      // Click connect
      await page.click('#connectBtn');
      await sleep(3000);
      
      // Filter out expected warnings
      const unexpectedErrors = consoleMessages.filter(msg => 
        msg.type === 'error' && 
        !msg.text.includes('Expected warning') &&
        !msg.text.includes('dotenv') &&
        !msg.text.includes('injecting env')
      );
      
      expect(unexpectedErrors.length).toBe(0);
    });
  });

  describeSSH('Terminal State', () => {
    beforeEach(async () => {
      page = await browser.newPage();
    });

    afterEach(async () => {
      if (page) {
        await page.close();
      }
    });

    test('should create terminal after connection', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(1000);
      
      // Open connection modal
      await page.click('#newSshBtn');
      await sleep(500);
      
      // Fill in connection form
      await page.type('#connHost', TEST_CONFIG.host);
      await page.type('#connUsername', TEST_CONFIG.username);
      await page.type('#connPassword', TEST_CONFIG.password);
      
      // Click connect
      await page.click('#connectBtn');
      await sleep(3000);
      
      // Check terminal state
      const terminalState = await page.evaluate(() => {
        const terminalWrappers = document.querySelectorAll('.terminal-wrapper');
        const terminals = document.querySelectorAll('.xterm');
        const activeTerminal = document.querySelector('.terminal-wrapper.active');
        
        return {
          wrapperCount: terminalWrappers.length,
          xtermCount: terminals.length,
          hasActiveTerminal: !!activeTerminal
        };
      });
      
      expect(terminalState.wrapperCount).toBeGreaterThan(0);
      expect(terminalState.xtermCount).toBeGreaterThan(0);
    });
  });
});