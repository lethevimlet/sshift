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
  
  // Default install directories for config (platform-specific)
  const DEFAULT_INSTALL_DIRS = [
    // Linux/macOS
    path.join(HOME_DIR, '.local', 'share', 'sshift'),
    // Windows
    path.join(HOME_DIR, '.local', 'share', 'sshift'),
    // Alternative locations
    path.join(HOME_DIR, '.local', 'share', 'bin'),
  ];
  
  // Package directory (for development)
  const PACKAGE_DIR = path.join(__dirname, '..', '..', '..');
  
  // Build env paths - prioritize user install directory, then package directory
  const envPaths = [
    ...DEFAULT_INSTALL_DIRS.map(dir => path.join(dir, '.env', '.env.local')),
    ...DEFAULT_INSTALL_DIRS.map(dir => path.join(dir, '.env.local')),
    ...DEFAULT_INSTALL_DIRS.map(dir => path.join(dir, '.env', '.env')),
    ...DEFAULT_INSTALL_DIRS.map(dir => path.join(dir, '.env')),
    path.join(PACKAGE_DIR, '.env', '.env.local'),
    path.join(PACKAGE_DIR, '.env.local'),
    path.join(PACKAGE_DIR, '.env', '.env'),
    path.join(PACKAGE_DIR, '.env')
  ];

  envPaths.forEach(envPath => {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }
  });
}

module.exports = { loadEnvFiles };