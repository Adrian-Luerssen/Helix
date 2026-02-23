/**
 * Helix Configuration Loader
 * Loads config.json and provides defaults for all settings.
 */
(function(window) {
  'use strict';

  // Default configuration
  const defaults = {
    gatewayWsUrl: null,
    gatewayHttpUrl: null,
    
    // PM agent configuration
    pm: {
      agentId: 'main',
      sessionSuffix: 'main'
    },
    
    // Agent role mappings (role -> agentId)
    agentRoles: {
      pm: 'main',
      frontend: 'frontend',
      backend: 'backend',
      designer: 'designer',
      tester: 'tester'
    },
    
    // Agent label customizations (agentId -> { emoji, name })
    agentLabels: {},
    
    // Feature flags
    features: {
      formatUserMessages: false,
      allowExternalMedia: false
    }
  };

  let loadedConfig = null;

  /**
   * Deep merge two objects
   */
  function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = deepMerge(result[key] || {}, source[key]);
      } else if (source[key] !== null && source[key] !== undefined) {
        result[key] = source[key];
      }
    }
    return result;
  }

  /**
   * Load configuration synchronously (for initial page load)
   */
  function loadConfigSync() {
    if (loadedConfig) return loadedConfig;
    
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', '/config.json', false); // Synchronous
      xhr.send();
      
      if (xhr.status === 200) {
        const json = JSON.parse(xhr.responseText);
        // Filter out _note and _example keys
        const filtered = {};
        for (const key in json) {
          if (!key.startsWith('_')) {
            filtered[key] = json[key];
          }
        }
        loadedConfig = deepMerge(defaults, filtered);
      } else {
        console.warn('[Config] Failed to load config.json, using defaults');
        loadedConfig = defaults;
      }
    } catch (e) {
      console.warn('[Config] Error loading config.json:', e);
      loadedConfig = defaults;
    }
    
    return loadedConfig;
  }

  /**
   * Get current configuration
   */
  function getConfig() {
    return loadedConfig || loadConfigSync();
  }

  /**
   * Get PM session key
   * @returns {string} PM session key (e.g., "agent:main:main")
   */
  function getPmSessionKey() {
    const cfg = getConfig();
    const agentId = cfg.pm?.agentId || cfg.agentRoles?.pm || 'main';
    const suffix = cfg.pm?.sessionSuffix || 'main';
    return `agent:${agentId}:${suffix}`;
  }

  /**
   * Get agent ID for a role
   * @param {string} role - Role name (e.g., "frontend", "pm")
   * @returns {string} Agent ID
   */
  function getAgentForRole(role) {
    const cfg = getConfig();
    return cfg.agentRoles?.[role] || role;
  }

  /**
   * Get custom label for an agent
   * @param {string} agentId - Agent ID
   * @returns {{ emoji: string, name: string } | null}
   */
  function getAgentLabel(agentId) {
    if (!agentId) return null;
    const cfg = getConfig();
    const normalized = String(agentId).toLowerCase().trim();
    
    // Check custom labels from config first
    const customLabels = cfg.agentLabels || {};
    if (customLabels[normalized]) {
      return customLabels[normalized];
    }
    
    // Default labels for common roles
    const defaultLabels = {
      'main': { emoji: '🤖', name: 'Main' },
      'pm': { emoji: '📋', name: 'PM' }
    };
    
    if (defaultLabels[normalized]) {
      return defaultLabels[normalized];
    }
    
    return null;
  }

  // Initialize on load
  loadConfigSync();

  // Export
  window.HelixConfig = {
    getConfig,
    getPmSessionKey,
    getAgentForRole,
    getAgentLabel,
    reload: function() {
      loadedConfig = null;
      return loadConfigSync();
    }
  };

})(window);
