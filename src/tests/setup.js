/**
 * Jest setup file
 * Configures environment variables and global test settings
 */

const path = require('path');
const fs = require('fs');

// Load environment variables from .env files
function loadEnvForTests() {
  const envPaths = [
    path.join(__dirname, '..', '..', '.env', '.env.local'),
    path.join(__dirname, '..', '..', '.env.local'),
    path.join(__dirname, '..', '..', '.env', '.env'),
    path.join(__dirname, '..', '..', '.env')
  ];
  
  envPaths.forEach(envPath => {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }
  });
}

// Auto-load environment variables
loadEnvForTests();

// Set default test configuration.
// `npm run dev` runs the dev server on port 3000. The default config
// (example.config.json) enables HTTPS with an HTTP→HTTPS redirect, so
// integration tests must hit the HTTPS endpoint to get 200 responses
// (plain HTTP gets a 301 redirect body). The dev server uses a self-
// signed cert; the integration test helper disables cert verification.
process.env.SERVER_URL = process.env.SERVER_URL || 'https://localhost:3000';

// SSH test target. TEST_HOST and TEST_PORT are either:
//   - set by globalSetup (src/tests/global-setup.js) after booting the
//     Docker fixture (docker/test-ssh) → 127.0.0.1:2222 with testuser/testpass,
//   - set externally by the caller (TEST_HOST=... TEST_PORT=... TEST_USER=... TEST_PASS=...),
//   - or unset, in which case the credential-gated tests fall back to
//     describe.skip (see SKIP_SSH_TESTS in each test file).
// Defaults here only apply if neither globalSetup nor the caller set them.
if (!process.env.TEST_HOST) {
  process.env.TEST_HOST = 'localhost';
}
if (!process.env.TEST_PORT) {
  process.env.TEST_PORT = '22';
}
// Do NOT default TEST_USER/TEST_PASS — let tests skip when absent.

// Global test timeout
jest.setTimeout(30000);

// Increase timeout for integration tests
if (process.env.JEST_INTEGRATION === 'true') {
  jest.setTimeout(60000);
}

// Console spy for capturing console output in tests
global.consoleSpy = {
  log: jest.spyOn(console, 'log').mockImplementation(() => {}),
  error: jest.spyOn(console, 'error').mockImplementation(() => {}),
  warn: jest.spyOn(console, 'warn').mockImplementation(() => {}),
  info: jest.spyOn(console, 'info').mockImplementation(() => {})
};

// Restore console after each test
afterEach(() => {
  jest.restoreAllMocks();
});

// Helper to get test configuration
global.getTestConfig = () => ({
  host: process.env.TEST_HOST || 'localhost',
  port: parseInt(process.env.TEST_PORT) || 22,
  username: process.env.TEST_USER || '',
  password: process.env.TEST_PASS || ''
});

// Helper to get SSH configuration
global.getSSHConfig = () => ({
  host: process.env.SSH_HOST || process.env.TEST_HOST || 'localhost',
  port: parseInt(process.env.SSH_PORT || process.env.TEST_PORT) || 22,
  username: process.env.SSH_USER || process.env.TEST_USER || '',
  password: process.env.SSH_PASS || process.env.TEST_PASS || ''
});

// Helper to get server URL
global.getServerUrl = () => process.env.SERVER_URL || 'https://localhost:3000';