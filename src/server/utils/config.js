/**
 * Configuration management utility
 * Handles loading, saving, and accessing configuration
 */

const path = require('path');
const fs = require('fs');

// Config paths - try .env/config.json first, then fall back to root config.json
const ENV_CONFIG_PATH = path.join(__dirname, '..', '..', '..', '.env', 'config.json');
const ROOT_CONFIG_PATH = path.join(__dirname, '..', '..', '..', 'config.json');

// Default config structure
const defaultConfig = {
  port: 8022,
  devPort: 3000,
  bind: '0.0.0.0',
  sticky: true,
  sshKeepaliveInterval: 10000,
  sshKeepaliveCountMax: 1000,
  bookmarks: [],
  folders: []
};

/**
 * Get config path (prioritize .env/config.json)
 * @returns {string} Path to config file
 */
function getConfigPath() {
  if (fs.existsSync(ENV_CONFIG_PATH)) {
    console.log('[CONFIG] Using .env/config.json');
    return ENV_CONFIG_PATH;
  }
  console.log('[CONFIG] Using root config.json');
  return ROOT_CONFIG_PATH;
}

/**
 * Load configuration from file
 * @returns {Object} Configuration object
 */
function loadConfig() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Error loading config:', err);
  }
  return { ...defaultConfig };
}

/**
 * Save configuration to file
 * @param {Object} config - Configuration object to save
 * @returns {boolean} Success status
 */
function saveConfig(config) {
  try {
    const configPath = getConfigPath();
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (err) {
    console.error('Error saving config:', err);
    return false;
  }
}

/**
 * Determine port with priority: PORT env var > config > defaults
 * @returns {number} Port number
 */
function getPort() {
  // Priority 1: PORT environment variable (highest priority)
  if (process.env.PORT) {
    return parseInt(process.env.PORT, 10);
  }
  
  // Priority 2: Check if running in dev mode
  const isDev = process.env.NODE_ENV === 'development' || process.argv.includes('dev');
  
  // Priority 3: Load from config
  const config = loadConfig();
  
  if (isDev) {
    return config.devPort || 3000;
  }
  
  return config.port || 8022;
}

/**
 * Determine bind address with priority: BIND env var > config > defaults
 * @returns {string} Bind address
 */
function getBindAddress() {
  // Priority 1: BIND environment variable (highest priority)
  if (process.env.BIND) {
    return process.env.BIND;
  }
  
  // Priority 2: Load from config
  const config = loadConfig();
  
  // Priority 3: Default
  return config.bind || '0.0.0.0';
}

/**
 * Get SSH keepalive settings from config
 * @returns {Object} Keepalive settings
 */
function getSSHKeepaliveSettings() {
  const config = loadConfig();
  return {
    sshKeepaliveInterval: config.sshKeepaliveInterval || 10000,
    sshKeepaliveCountMax: config.sshKeepaliveCountMax || 1000
  };
}

/**
 * Get sticky sessions setting from config
 * @returns {boolean} Sticky setting
 */
function getStickySetting() {
  const config = loadConfig();
  return config.sticky !== false; // Default to true
}

/**
 * Get take control default setting from config
 * @returns {boolean} Take control default setting
 */
function getTakeControlDefault() {
  const config = loadConfig();
  return config.takeControlDefault !== false; // Default to true
}

/**
 * Get mobile keys bar setting from config
 * @returns {boolean} Mobile keys bar setting
 */
function getMobileKeysBarEnabled() {
  const config = loadConfig();
  return config.mobileKeysBarEnabled !== false; // Default to true
}

/**
 * Get layouts from config
 * @returns {Object|null} Layouts object or null
 */
function getLayouts() {
  const config = loadConfig();
  return config.layouts || null;
}

module.exports = {
  defaultConfig,
  getConfigPath,
  loadConfig,
  saveConfig,
  getPort,
  getBindAddress,
  getSSHKeepaliveSettings,
  getStickySetting,
  getTakeControlDefault,
  getMobileKeysBarEnabled,
  getLayouts
};