/**
 * Integration tests for SSHIFT Server
 * Tests HTTP endpoints and static file serving
 *
 * Expects the dev server to be running: `npm run dev` (port 3000,
 * HTTPS by default with HTTP→HTTPS redirect per example.config.json).
 * Set SERVER_URL to override (must match the protocol the server is
 * actually serving — `https://localhost:3000` for the default config).
 */

const http = require('http');
const https = require('https');

// Default to the dev server's HTTPS endpoint. The dev server uses
// self-signed certificates so we MUST disable cert verification.
const BASE_URL = process.env.SERVER_URL || 'https://localhost:3000';

/**
 * Helper function to make HTTP(S) requests against the running dev server.
 * Picks `http` or `https` based on the BASE_URL scheme and accepts
 * self-signed certs (rejectUnauthorized: false).
 */
function fetch(path) {
  const url = `${BASE_URL}${path}`;
  const lib = url.startsWith('https://') ? https : http;
  return new Promise((resolve, reject) => {
    lib.get(url, { rejectUnauthorized: false }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });
}

describe('SSHIFT Server Tests', () => {
  // Increase timeout for integration tests
  jest.setTimeout(30000);

  describe('Main Page', () => {
    test('should serve main page with status 200', async () => {
      const result = await fetch('/');
      expect(result.status).toBe(200);
    });

    test('should contain SSHIFT branding', async () => {
      const result = await fetch('/');
      expect(result.data).toContain('SSHIFT');
    });
  });

  describe('Static Files', () => {
    test('should serve xterm.js', async () => {
      const result = await fetch('/libs/xterm/xterm.js');
      expect(result.status).toBe(200);
    });

    test('should serve xterm-addon-fit.js', async () => {
      const result = await fetch('/libs/xterm/xterm-addon-fit.js');
      expect(result.status).toBe(200);
      expect(result.data).toContain('FitAddon');
    });

    test('should serve xterm.css', async () => {
      const result = await fetch('/libs/xterm/xterm.css');
      expect(result.status).toBe(200);
    });

    test('should serve app.js', async () => {
      const result = await fetch('/js/app.js');
      expect(result.status).toBe(200);
    });

    test('should serve Socket.IO client', async () => {
      const result = await fetch('/socket.io/socket.io.js');
      expect(result.status).toBe(200);
    });
  });

  describe('Test Pages', () => {
    test('should serve test-xterm.html', async () => {
      const result = await fetch('/tests/test-xterm.html');
      expect(result.status).toBe(200);
    });

    test('should serve test-connection.html', async () => {
      const result = await fetch('/tests/test-connection.html');
      expect(result.status).toBe(200);
    });
  });

  describe('Error Handling', () => {
    test('should return 404 for non-existent files', async () => {
      const result = await fetch('/non-existent-file.js');
      expect(result.status).toBe(404);
    });
  });
});