/**
 * Integration tests for frontend resources
 * Tests HTTP endpoints for static files
 */

const http = require('http');
const https = require('https');

const BASE_URL = process.env.SERVER_URL || 'https://localhost:3000';

/**
 * Helper function to make HTTP(S) requests against the dev server.
 * Picks `http` or `https` from the URL scheme and accepts the dev
 * server's self-signed certificate.
 */
function fetch(url) {
  const lib = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { rejectUnauthorized: false }, (res) => {
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

    // Local xterm packages (vendored under src/webapp/libs/xterm/).
    // These replace a previous block of CDN-reachability tests that
    // (1) targeted the wrong xterm version (5.3.0 vs 6.0.0 shipped),
    // (2) only verified unpkg.com was reachable — not sshift behavior,
    // (3) and would flake in offline/sandboxed CI.
    test('should serve vendored xterm.js', async () => {
      const result = await fetch(`${BASE_URL}/libs/xterm/xterm.js`);
      expect(result.status).toBe(200);
      expect(result.data).toContain('Terminal');
    });

    test('should serve vendored xterm-addon-fit.js', async () => {
      const result = await fetch(`${BASE_URL}/libs/xterm/xterm-addon-fit.js`);
      expect(result.status).toBe(200);
      expect(result.data).toContain('FitAddon');
    });

    test('should serve vendored xterm.css', async () => {
      const result = await fetch(`${BASE_URL}/libs/xterm/xterm.css`);
      expect(result.status).toBe(200);
      expect(result.data.length).toBeGreaterThan(0);
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