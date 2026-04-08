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

// Set default test configuration
// Development server runs on port 3000 (npm run dev)
process.env.SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';

// Only set SSH test config if explicitly provided
// This allows tests to properly skip when no SSH server is available
if (!process.env.TEST_HOST) {
  process.env.TEST_HOST = 'localhost';
}
if (!process.env.TEST_PORT) {
  process.env.TEST_PORT = '22';
}
// Do NOT set default TEST_USER and TEST_PASS - let tests skip if not provided

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
global.getServerUrl = () => process.env.SERVER_URL || 'http://localhost:3000';