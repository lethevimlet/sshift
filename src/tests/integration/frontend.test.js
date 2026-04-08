/**
 * Integration tests for frontend resources
 * Tests HTTP endpoints for static files
 */

const http = require('http');

const BASE_URL = process.env.SERVER_URL || 'http://localhost:3000';

/**
 * Helper function to make HTTP requests
 */
function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

describe('Frontend Resource Tests', () => {
  // Increase timeout for network requests
  jest.setTimeout(30000);

  describe('Local Resources', () => {
    test('should serve main page', async () => {
      const result = await fetch(`${BASE_URL}/`);
      expect(result.status).toBe(200);
      expect(result.data.length).toBeGreaterThan(0);
    });

    test('should serve app.js', async () => {
      const result = await fetch(`${BASE_URL}/js/app.js`);
      expect(result.status).toBe(200);
      expect(result.data).toContain('SSHIFTClient');
    });

    test('should serve style.css', async () => {
      const result = await fetch(`${BASE_URL}/css/style.css`);
      expect(result.status).toBe(200);
      expect(result.data.length).toBeGreaterThan(0);
    });

    test('should serve Socket.IO client', async () => {
      const result = await fetch(`${BASE_URL}/socket.io/socket.io.js`);
      expect(result.status).toBe(200);
      expect(result.data.length).toBeGreaterThan(0);
    });
  });

  describe('External Resources (CDN)', () => {
    // These tests check if external CDN resources are accessible
    // They may fail if network is unavailable
    test.skip('should access xterm.js from CDN', async () => {
      const result = await fetch('https://unpkg.com/xterm@5.3.0/lib/xterm.js');
      expect(result.status).toBe(200);
      expect(result.data).toContain('Terminal');
    });

    test.skip('should access xterm-addon-fit from CDN', async () => {
      const result = await fetch('https://unpkg.com/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js');
      expect(result.status).toBe(200);
      expect(result.data).toContain('FitAddon');
    });

    test.skip('should access xterm-addon-web-links from CDN', async () => {
      const result = await fetch('https://unpkg.com/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js');
      expect(result.status).toBe(200);
    });

    test.skip('should access xterm-addon-search from CDN', async () => {
      const result = await fetch('https://unpkg.com/xterm-addon-search@0.13.0/lib/xterm-addon-search.js');
      expect(result.status).toBe(200);
    });

    test.skip('should access xterm CSS from CDN', async () => {
      const result = await fetch('https://unpkg.com/xterm@5.3.0/css/xterm.css');
      expect(result.status).toBe(200);
    });
  });

  describe('Resource Content Validation', () => {
    test('should have valid JavaScript in app.js', async () => {
      const result = await fetch(`${BASE_URL}/js/app.js`);
      expect(result.status).toBe(200);
      
      // Check for common JavaScript patterns (class or arrow functions)
      expect(result.data).toMatch(/class\s+\w+/);
      // Modern JS uses arrow functions, so check for either function declarations or arrow functions
      expect(result.data.length).toBeGreaterThan(1000);
      expect(result.data).toMatch(/(function\s*\(|=>\s*{|async\s+)/);
    });

    test('should have valid CSS in style.css', async () => {
      const result = await fetch(`${BASE_URL}/css/style.css`);
      expect(result.status).toBe(200);
      
      // Check for CSS patterns
      expect(result.data).toMatch(/\{[\s\S]*\}/);
    });
  });
});