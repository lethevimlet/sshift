/**
 * Integration tests for SSHIFT Server
 * Tests HTTP endpoints and static file serving
 */

const http = require('http');

const BASE_URL = process.env.SERVER_URL || 'http://localhost:3000';

/**
 * Helper function to make HTTP requests
 */
function fetch(path) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${path}`, (res) => {
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