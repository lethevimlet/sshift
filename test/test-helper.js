/**
 * Test helper module
 * Loads environment variables from .env files for tests
 */

const path = require('path');
const fs = require('fs');

// Load environment variables from .env files
// Priority: .env/.env.local > .env.local > .env/.env > .env
function loadEnvForTests() {
  const envPaths = [
    path.join(__dirname, '..', '.env', '.env.local'),
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env', '.env'),
    path.join(__dirname, '..', '.env')
  ];
  
  // Load .env files in priority order (highest priority first)
  envPaths.forEach(envPath => {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }
  });
}

// Auto-load when this module is required
loadEnvForTests();

// Export helper functions
module.exports = {
  loadEnvForTests,
  
  // Get test configuration with defaults
  getTestConfig: () => ({
    host: process.env.TEST_HOST || 'localhost',
    port: parseInt(process.env.TEST_PORT) || 22,
    username: process.env.TEST_USER || 'testuser',
    password: process.env.TEST_PASS || 'testpassword'
  }),
  
  // Get SSH configuration with defaults
  getSSHConfig: () => ({
    host: process.env.SSH_HOST || 'localhost',
    port: parseInt(process.env.SSH_PORT) || 22,
    username: process.env.SSH_USER || 'testuser',
    password: process.env.SSH_PASS || 'testpassword'
  })
};