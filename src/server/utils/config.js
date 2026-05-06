/**
 * Configuration management utility
 * Handles loading, saving, and accessing configuration
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

// Get user's home directory
const HOME_DIR = os.homedir();

// User install directory for config
const USER_INSTALL_DIR = path.join(HOME_DIR, '.local', 'share', 'sshift');

// Config paths - prioritize package directory, then user install directory
const PACKAGE_DIR = path.join(__dirname, '..', '..', '..');
const ENV_CONFIG_PATHS = [
  path.join(PACKAGE_DIR, '.env', 'config.json'),
  path.join(PACKAGE_DIR, 'config.json'),
  path.join(USER_INSTALL_DIR, '.env', 'config.json'),
  path.join(USER_INSTALL_DIR, 'config.json'),
];

// Default config structure
const defaultConfig = {
  port: 8022,
  devPort: 3000,
  bind: '0.0.0.0',
  enableHttps: true,
  httpRedirect: true,
  sticky: true,
  sshKeepaliveInterval: 15000,
  sshKeepaliveCountMax: 500,
  certPath: null,
  keyPath: null,
  plugins: [],
  bookmarks: [],
  folders: [],
  passwordHash: null,
  webglRenderer: true,
  imageAddonEnabled: true
};

/**
 * Ensure a config file exists. If no config is found in any search path,
 * create config.json in the package root using env var overrides or defaults.
 * This mirrors the installer create_config behavior.
 */
function ensureConfig() {
  for (const configPath of ENV_CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      return;
    }
  }

  const configPath = path.join(PACKAGE_DIR, 'config.json');
  const config = { ...defaultConfig };

  if (process.env.PORT) {
    const port = parseInt(process.env.PORT, 10);
    if (!isNaN(port)) {
      config.port = port;
    }
  }

  if (process.env.BIND) {
    config.bind = process.env.BIND;
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('[CONFIG] Created default config at', configPath);
}

/**
 * Get config path (prioritize user install directory)
 * @returns {string} Path to config file
 */
function getConfigPath() {
  for (const configPath of ENV_CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      console.log('[CONFIG] Using', configPath);
      return configPath;
    }
  }
  
  // Return default path (first user install directory)
  const defaultPath = ENV_CONFIG_PATHS[0];
  console.log('[CONFIG] Using default path:', defaultPath);
  return defaultPath;
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
    return config.devPort || defaultConfig.devPort;
  }
  
  return config.port || defaultConfig.port;
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
  return config.bind || defaultConfig.bind;
}

/**
 * Get SSH keepalive settings from config
 * @returns {Object} Keepalive settings
 */
function getSSHKeepaliveSettings() {
  const config = loadConfig();
  return {
    sshKeepaliveInterval: config.sshKeepaliveInterval || defaultConfig.sshKeepaliveInterval,
    sshKeepaliveCountMax: config.sshKeepaliveCountMax || defaultConfig.sshKeepaliveCountMax
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
 * Get WebGL renderer setting from config
 * @returns {boolean} WebGL renderer setting
 */
function getWebglRenderer() {
  const config = loadConfig();
  return config.webglRenderer !== false; // Default to true
}

/**
 * Get image addon setting from config
 * @returns {boolean} Image addon setting
 */
function getImageAddonEnabled() {
  const config = loadConfig();
  return config.imageAddonEnabled !== false; // Default to true
}

/**
 * Get layouts from config
 * @returns {Object|null} Layouts object or null
 */
function getLayouts() {
  const config = loadConfig();
  return config.layouts || null;
}

/**
 * Get HTTPS setting from config
 * @returns {boolean} Enable HTTPS setting
 */
function getEnableHttps() {
  const config = loadConfig();
  return config.enableHttps !== false; // Default to true
}

/**
 * Get HTTP redirect setting from config
 * Only meaningful when HTTPS is enabled - redirects HTTP requests to HTTPS
 * @returns {boolean} Enable HTTP redirect setting
 */
function getHttpRedirect() {
  const config = loadConfig();
  return config.httpRedirect !== false; // Default to true
}

/**
 * Get custom certificate path from config
 * @returns {string|null} Path to custom certificate file, or null
 */
function getCertPath() {
  const config = loadConfig();
  return config.certPath || null;
}

/**
 * Get custom private key path from config
 * @returns {string|null} Path to custom private key file, or null
 */
function getKeyPath() {
  const config = loadConfig();
  return config.keyPath || null;
}

/**
 * Get the data directory for persistent storage (SSL certs, etc.)
 * Searches the same paths as config to find a writable data directory.
 * @returns {string} Path to data directory
 */
function getDataDir() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  
  // If config is in a .env subdirectory, use parent
  if (path.basename(configDir) === '.env') {
    return path.dirname(configDir);
  }
  
  return configDir;
}

function hashPassword(password) {
  return crypto.createHash('sha3-256').update(password).digest('hex');
}

function isPasswordSet() {
  const config = loadConfig();
  return !!config.passwordHash;
}

function verifyPassword(password) {
  const config = loadConfig();
  if (!config.passwordHash) return true;
  return hashPassword(password) === config.passwordHash;
}

function setPassword(password) {
  const config = loadConfig();
  config.passwordHash = hashPassword(password);
  return saveConfig(config);
}

function removePassword() {
  const config = loadConfig();
  config.passwordHash = null;
  return saveConfig(config);
}

module.exports = {
  defaultConfig,
  ensureConfig,
  getConfigPath,
  loadConfig,
  saveConfig,
  getPort,
  getBindAddress,
  getSSHKeepaliveSettings,
  getStickySetting,
  getTakeControlDefault,
  getMobileKeysBarEnabled,
  getWebglRenderer,
  getImageAddonEnabled,
  getLayouts,
  getEnableHttps,
  getHttpRedirect,
  getCertPath,
  getKeyPath,
  getDataDir,
  hashPassword,
  isPasswordSet,
  verifyPassword,
  setPassword,
  removePassword
};