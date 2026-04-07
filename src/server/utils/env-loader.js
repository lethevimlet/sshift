/**
 * Environment variable loader
 * Loads .env files in priority order (highest priority first)
 */

const path = require('path');
const fs = require('fs');

/**
 * Load .env files in priority order
 * Priority: .env/.env.local > .env.local > .env/.env > .env
 */
function loadEnvFiles() {
  // Paths are relative to project root (parent of src/server)
  const envPaths = [
    path.join(__dirname, '..', '..', '..', '.env', '.env.local'),
    path.join(__dirname, '..', '..', '..', '.env.local'),
    path.join(__dirname, '..', '..', '..', '.env', '.env'),
    path.join(__dirname, '..', '..', '..', '.env')
  ];

  envPaths.forEach(envPath => {
    if (fs.existsSync(envPath)) {
      require('dotenv').config({ path: envPath });
    }
  });
}

module.exports = { loadEnvFiles };