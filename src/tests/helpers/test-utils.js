/**
 * Test helper utilities for Jest tests
 */

const io = require('socket.io-client');

/**
 * Get server URL from environment or default
 * @returns {string} Server URL
 */
function getServerUrl() {
  return process.env.SERVER_URL || 'http://localhost:3000';
}

/**
 * Get test configuration from environment
 * @returns {object} Test configuration
 */
function getTestConfig() {
  return {
    host: process.env.TEST_HOST || 'localhost',
    port: parseInt(process.env.TEST_PORT) || 22,
    username: process.env.TEST_USER || '',
    password: process.env.TEST_PASS || ''
  };
}

/**
 * Create a Socket.IO client for testing
 * @param {string} serverUrl - Server URL to connect to
 * @param {object} options - Socket.IO client options
 * @returns {object} Socket.IO client
 */
function createSocketClient(serverUrl = getServerUrl(), options = {}) {
  return io(serverUrl, {
    transports: ['websocket', 'polling'],
    reconnection: false,
    ...options
  });
}

/**
 * Wait for a socket event
 * @param {object} socket - Socket.IO client
 * @param {string} event - Event name
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} Promise that resolves with event data
 */
function waitForEvent(socket, event, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);
    
    socket.on(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/**
 * Wait for socket to connect
 * @param {object} socket - Socket.IO client
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise} Promise that resolves when connected
 */
function waitForConnect(socket, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Timeout waiting for connection'));
    }, timeout);
    
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * Disconnect socket and cleanup
 * @param {object} socket - Socket.IO client
 */
function disconnectSocket(socket) {
  if (socket && socket.connected) {
    socket.disconnect();
  }
}

/**
 * Create SSH connection parameters
 * @param {object} overrides - Override parameters
 * @returns {object} SSH connection parameters
 */
function createSSHParams(overrides = {}) {
  const config = getTestConfig();
  return {
    sessionId: `test-ssh-${Date.now()}`,
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    cols: 80,
    rows: 24,
    ...overrides
  };
}

/**
 * Create SFTP connection parameters
 * @param {object} overrides - Override parameters
 * @returns {object} SFTP connection parameters
 */
function createSFTPParams(overrides = {}) {
  const config = getTestConfig();
  return {
    sessionId: `test-sftp-${Date.now()}`,
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    ...overrides
  };
}

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise} Promise that resolves after sleep
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Make HTTP request
 * @param {string} url - URL to request
 * @param {object} options - Fetch options
 * @returns {Promise} Promise that resolves with response
 */
async function httpRequest(url, options = {}) {
  const http = require('http');
  const https = require('https');
  
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Puppeteer helper for browser tests
 */
class PuppeteerHelper {
  constructor(page) {
    this.page = page;
  }
  
  async waitForSelector(selector, timeout = 5000) {
    return this.page.waitForSelector(selector, { timeout });
  }
  
  async clickElement(selector) {
    await this.page.waitForSelector(selector);
    return this.page.click(selector);
  }
  
  async typeIntoElement(selector, text) {
    await this.page.waitForSelector(selector);
    return this.page.type(selector, text);
  }
  
  async getElementText(selector) {
    await this.page.waitForSelector(selector);
    return this.page.$eval(selector, el => el.textContent);
  }
  
  async getElementValue(selector) {
    await this.page.waitForSelector(selector);
    return this.page.$eval(selector, el => el.value);
  }
  
  async isElementVisible(selector) {
    const element = await this.page.$(selector);
    if (!element) return false;
    const style = await element.evaluate(el => window.getComputedStyle(el));
    return style.display !== 'none' && style.visibility !== 'hidden';
  }
  
  async takeScreenshot(filename) {
    return this.page.screenshot({ path: filename, fullPage: true });
  }
  
  async evaluateInPage(fn, ...args) {
    return this.page.evaluate(fn, ...args);
  }
}

module.exports = {
  getServerUrl,
  getTestConfig,
  createSocketClient,
  waitForEvent,
  waitForConnect,
  disconnectSocket,
  createSSHParams,
  createSFTPParams,
  sleep,
  httpRequest,
  PuppeteerHelper
};