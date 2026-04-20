/**
 * Plugin REST endpoints
 */

const path = require('path');
const fs = require('fs');
const { loadConfig, saveConfig } = require('../../utils/config');
const pluginManager = require('../../plugins/plugin-manager');

function registerPluginEndpoints(app, io) {
  app.get('/api/plugins', (req, res) => {
    try {
      const discovered = pluginManager.discoverPlugins();
      const config = loadConfig();
      const configuredPlugins = config.plugins || [];

      const plugins = discovered.map(plugin => {
        const existing = configuredPlugins.find(p => p.name === plugin.name);
        return {
          name: plugin.name,
          description: plugin.description,
          enabled: existing ? existing.enabled !== false : true,
          config: existing ? (existing.config || {}) : {},
        };
      });

      const configuredNames = new Set(configuredPlugins.map(p => p.name));
      const extraPlugins = configuredPlugins
        .filter(p => !discovered.find(d => d.name === p.name))
        .map(p => ({
          name: p.name,
          description: 'Plugin not found in plugins directory',
          enabled: p.enabled !== false,
          config: p.config || {},
          missing: true,
        }));

      res.json([...plugins, ...extraPlugins]);
    } catch (err) {
      console.error('[PLUGINS] Error listing plugins:', err);
      res.status(500).json({ error: 'Failed to list plugins' });
    }
  });

  app.post('/api/plugins', (req, res) => {
    try {
      const { name, enabled } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Plugin name is required' });
      }

      const discovered = pluginManager.discoverPlugins();
      const pluginExists = discovered.some(p => p.name === name);
      if (!pluginExists) {
        return res.status(404).json({ error: 'Plugin not found' });
      }

      const config = loadConfig();
      if (!config.plugins) {
        config.plugins = [];
      }

      const existingIndex = config.plugins.findIndex(p => p.name === name);
      if (existingIndex >= 0) {
        config.plugins[existingIndex].enabled = enabled;
      } else {
        config.plugins.push({ name, enabled, config: {} });
      }

      const saved = saveConfig(config);
      if (!saved) {
        return res.status(500).json({ error: 'Failed to save config' });
      }

      const reloadedConfig = loadConfig();
      pluginManager.reload(reloadedConfig);

      res.json({
        success: true,
        name,
        enabled,
      });
    } catch (err) {
      console.error('[PLUGINS] Error updating plugin:', err);
      res.status(500).json({ error: 'Failed to update plugin' });
    }
  });
}

module.exports = { registerPluginEndpoints };