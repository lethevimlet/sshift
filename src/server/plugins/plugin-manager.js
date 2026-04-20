/**
 * Plugin System - Core Plugin Manager
 *
 * Provides a hook-based architecture for plugins to observe and react to
 * SSH session data, terminal output, and other events.
 *
 * Plugin API available to plugins:
 *   - onSessionConnect(sessionId, sessionInfo)  - SSH session established
 *   - onSessionDisconnect(sessionId)             - SSH session closed
 *   - onData(sessionId, data)                    - Raw terminal output data
 *   - onTerminalLine(sessionId, line)            - Individual terminal lines
 *
 * Plugin actions (via context object):
 *   - ctx.flashTab(sessionId, options)           - Flash a tab to get attention
 *   - ctx.stopFlashTab(sessionId)                - Stop flashing a tab
 *   - ctx.emitToSession(sessionId, event, data)  - Send WS event to session clients
 *   - ctx.emitToAll(event, data)                 - Broadcast WS event to all clients
 *   - ctx.writeToSession(sessionId, data)         - Write data to SSH session stdin
 *   - ctx.getTerminalState(sessionId)             - Get current terminal state
 *   - ctx.getActiveSessions()                     - Get list of active session IDs
 *   - ctx.getConfig()                             - Get current server config
 */

const path = require('path');
const fs = require('fs');

class PluginManager {
  constructor() {
    this.plugins = new Map();
    this.hooks = {
      onSessionConnect: [],
      onSessionDisconnect: [],
      onData: [],
      onTerminalLine: [],
    };
    this.io = null;
    this.sshManager = null;
    this.tabManager = null;
    this.config = null;
    this._lineBuffers = new Map();
    this.flashingSessions = new Map(); // sessionId -> options
  }

  discoverPlugins() {
    const builtinDir = path.join(__dirname, '..', '..', '..', 'plugins');
    const discovered = [];

    if (fs.existsSync(builtinDir)) {
      const entries = fs.readdirSync(builtinDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pluginDir = path.join(builtinDir, entry.name);
        const indexFile = path.join(pluginDir, 'index.js');
        const pkgFile = path.join(pluginDir, 'package.json');

        if (!fs.existsSync(indexFile)) continue;

        let description = '';
        if (fs.existsSync(pkgFile)) {
          try {
            const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
            description = pkg.description || '';
          } catch (e) { /* ignore */ }
        }

        discovered.push({
          name: entry.name,
          description,
        });
      }
    }

    return discovered;
  }

  reload(config) {
    this.config = config;

    for (const hookFns of Object.values(this.hooks)) {
      hookFns.length = 0;
    }

    for (const [name, pluginEntry] of this.plugins.entries()) {
      const instance = pluginEntry.instance;
      if (instance && typeof instance.onSessionDisconnect === 'function') {
        for (const sessionId of this._lineBuffers.keys()) {
          try { instance.onSessionDisconnect(sessionId); } catch (e) { /* ignore */ }
        }
      }
    }

    this.plugins.clear();
    this._lineBuffers.clear();
    this.flashingSessions.clear();

    this._loadPlugins();

    if (this.io) {
      for (const [, socket] of this.io.sockets.sockets) {
        this.syncFlashState(socket);
      }
    }

    if (this.sshManager) {
      for (const sessionId of this.sshManager.sessions.keys()) {
        this.emit('onSessionConnect', sessionId, {});
      }
    }
  }

  init({ io, sshManager, tabManager, config }) {
    this.io = io;
    this.sshManager = sshManager;
    this.tabManager = tabManager;
    this.config = config;
    this._loadPlugins();
  }

  _loadPlugins() {
    const pluginConfigs = this.config.plugins || [];

    for (const pluginConfig of pluginConfigs) {
      if (pluginConfig.enabled === false) {
        console.log(`[PLUGINS] Skipping disabled plugin: ${pluginConfig.name}`);
        continue;
      }
      this._loadPlugin(pluginConfig);
    }
  }

  getPluginDir(name) {
    const localDir = path.join(__dirname, name);
    const builtinDir = path.join(__dirname, '..', '..', '..', 'plugins', name);
    if (fs.existsSync(path.join(localDir, 'index.js'))) return localDir;
    if (fs.existsSync(path.join(builtinDir, 'index.js'))) return builtinDir;
    return null;
  }

  _loadPlugin(pluginConfig) {
    const { name } = pluginConfig;

    const pluginDir = path.join(__dirname, name);
    const builtinDir = path.join(__dirname, '..', '..', '..', 'plugins', name);

    let pluginPath;
    if (fs.existsSync(path.join(pluginDir, 'index.js'))) {
      pluginPath = path.join(pluginDir, 'index.js');
    } else if (fs.existsSync(path.join(builtinDir, 'index.js'))) {
      pluginPath = path.join(builtinDir, 'index.js');
    } else {
      try {
        pluginPath = require.resolve(name, { paths: [path.join(__dirname, '..', '..', '..')] });
      } catch (e) {
        console.error(`[PLUGINS] Plugin "${name}" not found in builtin or external paths`);
        return;
      }
    }

    try {
      const PluginClass = require(pluginPath);
      const ctx = this._createContext(pluginConfig);
      const instance = typeof PluginClass === 'function'
        ? new PluginClass(ctx, pluginConfig.config || {})
        : PluginClass;

      this.plugins.set(name, {
        instance,
        config: pluginConfig,
        path: pluginPath,
      });

      for (const [hookName, hookFn] of Object.entries(this.hooks)) {
        if (typeof instance[hookName] === 'function') {
          hookFn.push({ pluginName: name, fn: instance[hookName].bind(instance) });
          console.log(`[PLUGINS] Registered hook ${hookName} for plugin "${name}"`);
        }
      }

      if (typeof instance.init === 'function') {
        instance.init(ctx, pluginConfig.config || {});
      }

      console.log(`[PLUGINS] Loaded plugin: ${name} from ${pluginPath}`);
    } catch (err) {
      console.error(`[PLUGINS] Failed to load plugin "${name}":`, err.message);
    }
  }

  _createContext(pluginConfig) {
    const self = this;
    return {
      flashTab(sessionId, options = {}) {
        if (!self.io) return;
        self.flashingSessions.set(sessionId, options);
        self.io.to(`session-${sessionId}`).emit('tab-flash', {
          sessionId,
          ...options,
        });
        self.io.emit('tab-flash', { sessionId, ...options });
      },

      stopFlashTab(sessionId) {
        if (!self.io) return;
        self.flashingSessions.delete(sessionId);
        self.io.to(`session-${sessionId}`).emit('tab-flash-stop', { sessionId });
        self.io.emit('tab-flash-stop', { sessionId });
      },

      emitToSession(sessionId, event, data) {
        if (!self.io) return;
        self.io.to(`session-${sessionId}`).emit(event, data);
      },

      emitToAll(event, data) {
        if (!self.io) return;
        self.io.emit(event, data);
      },

      writeToSession(sessionId, data) {
        if (self.sshManager) {
          self.sshManager.write(sessionId, data);
        }
      },

      getTerminalState(sessionId) {
        if (self.sshManager) {
          return self.sshManager.getTerminalState(sessionId);
        }
        return null;
      },

      getActiveSessions() {
        if (self.sshManager) {
          return Array.from(self.sshManager.sessions.keys());
        }
        return [];
      },

      getConfig() {
        return self.config;
      },

      getPluginConfig() {
        return pluginConfig.config || {};
      },
    };
  }

  _processLineBuffer(sessionId, dataStr) {
    if (!this._lineBuffers.has(sessionId)) {
      this._lineBuffers.set(sessionId, '');
    }
    let buffer = this._lineBuffers.get(sessionId) + dataStr;

    const lines = [];
    let lastNewline = buffer.lastIndexOf('\n');
    if (lastNewline !== -1) {
      const rawLines = buffer.substring(0, lastNewline);
      buffer = buffer.substring(lastNewline + 1);
      const split = rawLines.split('\n');
      lines.push(...split);
    }
    this._lineBuffers.set(sessionId, buffer);

    for (const line of lines) {
      const stripped = this._stripAnsi(line);
      for (const hook of this.hooks.onTerminalLine) {
        try {
          hook.fn(sessionId, stripped, line);
        } catch (err) {
          console.error(`[PLUGINS] Error in onTerminalLine hook (${hook.pluginName}):`, err.message);
        }
      }
    }
  }

_stripAnsi(str) {
    return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
              .replace(/\x1b\][^\x07]*\x07/g, '')
              .replace(/\x1b\[\?[0-9]+[hl]/g, '')
              .replace(/\x1b[\(\)]B/g, '')
              .replace(/\x1b[0-9;]*[a-zA-Z]/g, '')
              .replace(/\x1b[^[\]()?P]/g, '')
              .replace(/[\x00-\x08\x0b\x0c\x0d\x0e-\x1f\x7f]/g, '')
              .trim();
  }

  emit(hookName, ...args) {
    const hooks = this.hooks[hookName];
    if (!hooks) return;
    for (const hook of hooks) {
      try {
        hook.fn(...args);
      } catch (err) {
        console.error(`[PLUGINS] Error in ${hookName} hook (${hook.pluginName}):`, err.message);
      }
    }
  }

  onData(sessionId, data) {
    this.emit('onData', sessionId, data);
    this._processLineBuffer(sessionId, data);
  }

  onSessionConnect(sessionId, sessionInfo) {
    this.emit('onSessionConnect', sessionId, sessionInfo);
  }

  onSessionDisconnect(sessionId) {
    this._lineBuffers.delete(sessionId);
    this.flashingSessions.delete(sessionId);
    this.emit('onSessionDisconnect', sessionId);
  }

  getFlashingSessions() {
    return Array.from(this.flashingSessions.entries()).map(([sessionId, options]) => ({
      sessionId,
      ...options,
    }));
  }

  syncFlashState(socket) {
    if (!this.io) return;
    const flashing = this.getFlashingSessions();
    for (const flash of flashing) {
      socket.emit('tab-flash', flash);
    }
  }
}

module.exports = new PluginManager();