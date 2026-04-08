/**
 * Browser UI tests using Puppeteer
 * Tests the web interface functionality
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

describe('Browser UI Tests', () => {
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

  describe('Page Loading', () => {
    beforeEach(async () => {
      page = await browser.newPage();
      
      // Collect console messages
      page.on('console', msg => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      });
      
      // Collect errors
      page.on('pageerror', error => {
        errors.push(error.message);
      });
      
      page.on('error', error => {
        errors.push(error.message);
      });
      
      // Collect network errors
      page.on('requestfailed', request => {
        errors.push(`Request failed: ${request.url()} - ${request.failure().errorText}`);
      });
    });

    afterEach(async () => {
      if (page) {
        await page.close();
      }
    });

    test('should load main page without errors', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      
      // Wait for JS to execute
      await sleep(2000);
      
      // Check for page errors
      expect(errors.length).toBe(0);
    });

    test('should initialize app correctly', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(2000);
      
      // Check if app loaded
      const appExists = await page.evaluate(() => {
        return typeof window.app !== 'undefined';
      });
      
      expect(appExists).toBe(true);
    });

    test('should establish socket connection', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(2000);
      
      // Check socket connection
      const socketConnected = await page.evaluate(() => {
        if (window.app && window.app.socket) {
          return window.app.socket.connected;
        }
        return false;
      });
      
      expect(socketConnected).toBe(true);
    });

    test('should load xterm.js', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(2000);
      
      // Check xterm loaded
      const xtermLoaded = await page.evaluate(() => {
        return typeof Terminal !== 'undefined';
      });
      
      expect(xtermLoaded).toBe(true);
    });
  });

  describeSSH('SSH Connection UI', () => {
    beforeEach(async () => {
      page = await browser.newPage();
      
      page.on('console', msg => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      });
      
      page.on('pageerror', error => {
        errors.push(error.message);
      });
    });

    afterEach(async () => {
      if (page) {
        await page.close();
      }
    });

    test('should open SSH connection modal', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(1000);
      
      // Click new SSH button
      await page.click('#newSshBtn');
      await sleep(500);
      
      // Check if modal is visible
      const modalVisible = await page.evaluate(() => {
        const modal = document.getElementById('connectionModal');
        return modal && modal.classList.contains('active');
      });
      
      expect(modalVisible).toBe(true);
    });

    test('should fill connection form', async () => {
      await page.goto(SERVER_URL, { waitUntil: 'networkidle2', timeout: 10000 });
      await sleep(1000);
      
      // Open connection modal
      await page.click('#newSshBtn');
      await sleep(500);
      
      // Fill in connection form
      await page.type('#connHost', TEST_CONFIG.host);
      await page.type('#connUsername', TEST_CONFIG.username);
      await page.type('#connPassword', TEST_CONFIG.password);
      
      // Verify form values
      const hostValue = await page.$eval('#connHost', el => el.value);
      const usernameValue = await page.$eval('#connUsername', el => el.value);
      
      expect(hostValue).toBe(TEST_CONFIG.host);
      expect(usernameValue).toBe(TEST_CONFIG.username);
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
      
      // Wait for connection attempt
      await sleep(5000);
      
      // Check for terminal
      const terminalCount = await page.evaluate(() => {
        const terminals = document.querySelectorAll('.terminal-wrapper');
        return terminals.length;
      });
      
      expect(terminalCount).toBeGreaterThan(0);
    });
  });

  describeSSH('Session Management', () => {
    beforeEach(async () => {
      page = await browser.newPage();
      
      page.on('console', msg => {
        consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
      });
      
      page.on('pageerror', error => {
        errors.push(error.message);
      });
    });

    afterEach(async () => {
      if (page) {
        await page.close();
      }
    });

    test('should track sessions correctly', async () => {
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
      await sleep(5000);
      
      // Check sessions
      const sessions = await page.evaluate(() => {
        if (window.app && window.app.sessions) {
          return Array.from(window.app.sessions.entries()).map(([id, s]) => ({
            id,
            name: s.name,
            type: s.type,
            connected: s.connected,
            connecting: s.connecting
          }));
        }
        return [];
      });
      
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions[0].type).toBe('ssh');
    });
  });
});