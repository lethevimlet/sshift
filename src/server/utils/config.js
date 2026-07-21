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
  scrollback: 10000,
  webglRenderer: true,
  imageAddonEnabled: true,
  // Speech & AI settings. Auth keys live in config.json (gitignored) and are
  // never sent back to the browser on GET — only a "set" flag is exposed.
  sttEndpoint: '',
  sttAuthKey: '',
  sttLanguage: '',
  llmEndpoint: 'https://api.deepinfra.com/v1/openai/chat/completions',
  llmAuthKey: '',
  llmModel: 'meta-llama/Llama-3.3-70B-Instruct',
  wandSystemPrompt: ''
};

/**
 * Ensure a config file exists. If no config is found in any search path,
 * create config.json at the user install directory (~/.local/share/sshift/.env/config.json)
 * so it survives npm updates (which replace the package directory).
 * This mirrors the installer create_config behavior.
 */
function ensureConfig() {
  for (const configPath of ENV_CONFIG_PATHS) {
    if (fs.existsSync(configPath)) {
      return;
    }
  }

  const configDir = path.join(USER_INSTALL_DIR, '.env');
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  const configPath = path.join(configDir, 'config.json');
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
  
  // Return default path (user install directory, survives npm updates)
  const defaultPath = path.join(USER_INSTALL_DIR, '.env', 'config.json');
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
function getScrollback() {
  const config = loadConfig();
  return config.scrollback || defaultConfig.scrollback;
}

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
 * Always returns the user-space directory so certs survive npm updates.
 * @returns {string} Path to data directory
 */
function getDataDir() {
  return USER_INSTALL_DIR;
}

/**
 * Get the legacy data directory (package directory) used before
 * certs were moved to user space. Used for migration only.
 * @returns {string|null} Path to legacy data directory, or null if N/A
 */
function getLegacyDataDir() {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (path.basename(configDir) === '.env') {
    const pkgDataDir = path.dirname(configDir);
    if (pkgDataDir !== USER_INSTALL_DIR) {
      return pkgDataDir;
    }
  } else if (configDir !== USER_INSTALL_DIR) {
    return configDir;
  }

  return null;
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

// Speech & AI default system prompt for the Wand button.
const DEFAULT_WAND_SYSTEM_PROMPT =
  "You are an assistant that cleans up transcribed speech for terminal input. " +
  "Rewrite the user's speech as a clear, well-punctuated, ready-to-send command or text. " +
  "Fix typos, remove filler words, hesitations, stutters and false starts, and preserve " +
  "the user's intent exactly. Do not add quotes, explanations, or markdown. " +
  "Output only the corrected text.";

/**
 * Public speech-ai config — auth keys redacted to boolean flags.
 * Used by GET /api/speech-ai/config so the browser can populate the
 * settings modal without ever seeing the raw secrets.
 */
function getSpeechAiPublicConfig() {
  const config = loadConfig();
  return {
    sttEndpoint: config.sttEndpoint || '',
    sttLanguage: config.sttLanguage || '',
    llmEndpoint: config.llmEndpoint || defaultConfig.llmEndpoint,
    llmModel: config.llmModel || defaultConfig.llmModel,
    wandSystemPrompt: config.wandSystemPrompt || '',
    sttAuthKeySet: !!config.sttAuthKey,
    llmAuthKeySet: !!config.llmAuthKey
  };
}

/**
 * Internal speech-ai config — includes raw auth keys. Server-side only.
 */
function getSpeechAiConfig() {
  const config = loadConfig();
  return {
    sttEndpoint: config.sttEndpoint || '',
    sttAuthKey: config.sttAuthKey || '',
    sttLanguage: config.sttLanguage || '',
    llmEndpoint: config.llmEndpoint || defaultConfig.llmEndpoint,
    llmAuthKey: config.llmAuthKey || '',
    llmModel: config.llmModel || defaultConfig.llmModel,
    wandSystemPrompt: config.wandSystemPrompt || ''
  };
}

function getDefaultWandSystemPrompt() {
  return DEFAULT_WAND_SYSTEM_PROMPT;
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
  getScrollback,
  getLayouts,
  getEnableHttps,
  getHttpRedirect,
  getCertPath,
  getKeyPath,
  getDataDir,
  getLegacyDataDir,
  hashPassword,
  isPasswordSet,
  verifyPassword,
  setPassword,
  removePassword,
  getSpeechAiPublicConfig,
  getSpeechAiConfig,
  getDefaultWandSystemPrompt,
  USER_INSTALL_DIR
};