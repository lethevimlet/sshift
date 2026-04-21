/**
 * Environment variable loader
 * Loads .env files in priority order (highest priority first)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * Load .env files in priority order
 * Priority: .env/.env.local > .env.local > .env/.env > .env
 */
function loadEnvFiles() {
  // Get user's home directory
  const HOME_DIR = os.homedir();
  
  const USER_INSTALL_DIR = path.join(HOME_DIR, '.local', 'share', 'sshift');
  const PACKAGE_DIR = path.join(__dirname, '..', '..', '..');
  
  const envPaths = [
    path.join(PACKAGE_DIR, '.env', '.env.local'),
    path.join(PACKAGE_DIR, '.env.local'),
    path.join(PACKAGE_DIR, '.env', '.env'),
    path.join(PACKAGE_DIR, '.env'),
    path.join(USER_INSTALL_DIR, '.env', '.env.local'),
    path.join(USER_INSTALL_DIR, '.env.local'),
    path.join(USER_INSTALL_DIR, '.env', '.env'),
    path.join(USER_INSTALL_DIR, '.env')
  ];

  envPaths.forEach(envPath => {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }
  });
}

module.exports = { loadEnvFiles };