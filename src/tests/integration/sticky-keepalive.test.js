/**
 * Integration tests for sticky sessions and keepalive settings
 * Tests API endpoints for configuration management
 */

const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config.json');

/**
 * Helper function to make HTTP requests
 */
async function httpRequest(url, options = {}) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('Sticky Property and Keepalive Tests', () => {
  // Increase timeout for API tests
  jest.setTimeout(30000);

  describe('Sticky Property in Config', () => {
    test('should have sticky property in config', async () => {
      const response = await httpRequest(`${SERVER_URL}/api/config`);
      
      expect(response.status).toBe(200);
      expect(response.data).toBeDefined();
      expect('sticky' in response.data).toBe(true);
    });

    test('should have sticky as boolean type', async () => {
      const response = await httpRequest(`${SERVER_URL}/api/config`);
      
      expect(typeof response.data.sticky).toBe('boolean');
    });

    test('should not have old properties (stickyTabs, stickySessions)', async () => {
      const response = await httpRequest(`${SERVER_URL}/api/config`);
      
      expect('stickyTabs' in response.data).toBe(false);
      expect('stickySessions' in response.data).toBe(false);
    });
  });

  describe('Sticky Toggle in Settings', () => {
    let originalSticky;

    beforeAll(() => {
      // Read original config
      if (fs.existsSync(CONFIG_PATH)) {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        originalSticky = config.sticky;
      }
    });

    afterAll(async () => {
      // Restore original config
      if (originalSticky !== undefined) {
        await httpRequest(`${SERVER_URL}/api/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sticky: originalSticky })
        });
      }
    });

    test('should toggle sticky value', async () => {
      // Get current config
      const getResponse = await httpRequest(`${SERVER_URL}/api/config`);
      const currentSticky = getResponse.data.sticky;
      
      // Toggle sticky value
      const newSticky = !currentSticky;
      
      const saveResponse = await httpRequest(`${SERVER_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sticky: newSticky })
      });
      
      expect(saveResponse.status).toBe(200);
      
      // Verify the change
      const verifyResponse = await httpRequest(`${SERVER_URL}/api/config`);
      expect(verifyResponse.data.sticky).toBe(newSticky);
    });
  });

  describe('Keepalive Settings with Sticky', () => {
    let originalConfig;

    beforeAll(() => {
      // Read original config
      if (fs.existsSync(CONFIG_PATH)) {
        originalConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      }
    });

    afterAll(async () => {
      // Restore original config
      if (originalConfig) {
        await httpRequest(`${SERVER_URL}/api/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(originalConfig)
        });
      }
    });

    test('should save both sticky and keepalive settings', async () => {
      const testConfig = {
        sticky: false,
        sshKeepaliveInterval: 15000,
        sshKeepaliveCountMax: 500
      };
      
      const saveResponse = await httpRequest(`${SERVER_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig)
      });
      
      expect(saveResponse.status).toBe(200);
      
      // Verify all settings
      const getResponse = await httpRequest(`${SERVER_URL}/api/config`);
      
      expect(getResponse.data.sticky).toBe(testConfig.sticky);
      expect(getResponse.data.sshKeepaliveInterval).toBe(testConfig.sshKeepaliveInterval);
      expect(getResponse.data.sshKeepaliveCountMax).toBe(testConfig.sshKeepaliveCountMax);
    });

    test('should persist keepalive interval', async () => {
      const testConfig = {
        sshKeepaliveInterval: 30000
      };
      
      const saveResponse = await httpRequest(`${SERVER_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig)
      });
      
      expect(saveResponse.status).toBe(200);
      
      const getResponse = await httpRequest(`${SERVER_URL}/api/config`);
      expect(getResponse.data.sshKeepaliveInterval).toBe(30000);
    });

    test('should persist keepalive count max', async () => {
      const testConfig = {
        sshKeepaliveCountMax: 1000
      };
      
      const saveResponse = await httpRequest(`${SERVER_URL}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(testConfig)
      });
      
      expect(saveResponse.status).toBe(200);
      
      const getResponse = await httpRequest(`${SERVER_URL}/api/config`);
      expect(getResponse.data.sshKeepaliveCountMax).toBe(1000);
    });
  });
});