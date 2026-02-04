/**
 * Tests for ClawCondos Configuration Module
 * 
 * Run with: npx vitest run tests/config.test.js
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test data
const DEFAULT_CONFIG = {
  gatewayWsUrl: null,
  gatewayHttpUrl: null,
  appsUrl: '/api/apps',
  branding: {
    name: 'ClawCondos',
    logo: '🚀',
    tagline: 'Multi-Agent Dashboard'
  },
  sessions: {
    pollInterval: 30000,
    defaultLimit: 50
  },
  features: {
    showApps: true,
    showSubagents: true,
    showAgents: true
  }
};

// Pure function implementations for testing
function buildDefaults(hostname = 'localhost', protocol = 'https:') {
  const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
  return {
    gatewayWsUrl: `${wsProtocol}//${hostname}/`,
    gatewayHttpUrl: `${protocol}//${hostname}`
  };
}

function mergeConfig(base, override) {
  const result = { ...base };
  
  for (const key of Object.keys(override)) {
    if (override[key] !== null && typeof override[key] === 'object' && !Array.isArray(override[key])) {
      result[key] = mergeConfig(result[key] || {}, override[key]);
    } else if (override[key] !== null && override[key] !== undefined) {
      result[key] = override[key];
    }
  }
  
  return result;
}

describe('Config Module', () => {
  describe('buildDefaults()', () => {
    it('should build wss:// URL for https: protocol', () => {
      const defaults = buildDefaults('example.com', 'https:');
      
      expect(defaults.gatewayWsUrl).toBe('wss://example.com/');
      expect(defaults.gatewayHttpUrl).toBe('https://example.com');
    });

    it('should build ws:// URL for http: protocol', () => {
      const defaults = buildDefaults('localhost', 'http:');
      
      expect(defaults.gatewayWsUrl).toBe('ws://localhost/');
      expect(defaults.gatewayHttpUrl).toBe('http://localhost');
    });

    it('should handle custom hostnames', () => {
      const defaults = buildDefaults('192.168.1.100:8080', 'http:');
      
      expect(defaults.gatewayWsUrl).toBe('ws://192.168.1.100:8080/');
      expect(defaults.gatewayHttpUrl).toBe('http://192.168.1.100:8080');
    });
  });

  describe('mergeConfig()', () => {
    it('should merge flat properties', () => {
      const base = { a: 1, b: 2 };
      const override = { b: 3, c: 4 };
      
      const result = mergeConfig(base, override);
      
      expect(result).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('should deep merge nested objects', () => {
      const base = {
        branding: { name: 'ClawCondos', logo: '🚀' },
        features: { showApps: true }
      };
      const override = {
        branding: { name: 'Custom' },
        features: { showAgents: false }
      };
      
      const result = mergeConfig(base, override);
      
      expect(result.branding).toEqual({ name: 'Custom', logo: '🚀' });
      expect(result.features).toEqual({ showApps: true, showAgents: false });
    });

    it('should NOT overwrite with null values', () => {
      const base = { gatewayWsUrl: 'wss://example.com/' };
      const override = { gatewayWsUrl: null };
      
      const result = mergeConfig(base, override);
      
      expect(result.gatewayWsUrl).toBe('wss://example.com/');
    });

    it('should NOT overwrite with undefined values', () => {
      const base = { appsUrl: '/api/apps' };
      const override = { appsUrl: undefined };
      
      const result = mergeConfig(base, override);
      
      expect(result.appsUrl).toBe('/api/apps');
    });

    it('should handle arrays as atomic values (not merge)', () => {
      const base = { items: [1, 2, 3] };
      const override = { items: [4, 5] };
      
      const result = mergeConfig(base, override);
      
      expect(result.items).toEqual([4, 5]);
    });

    it('should handle deeply nested objects', () => {
      const base = {
        level1: {
          level2: {
            level3: { a: 1, b: 2 }
          }
        }
      };
      const override = {
        level1: {
          level2: {
            level3: { b: 99, c: 3 }
          }
        }
      };
      
      const result = mergeConfig(base, override);
      
      expect(result.level1.level2.level3).toEqual({ a: 1, b: 99, c: 3 });
    });
  });

  describe('Config Precedence', () => {
    it('should apply correct precedence: defaults < buildDefaults < userConfig', () => {
      // 1. Start with defaults
      let config = { ...DEFAULT_CONFIG };
      
      // 2. Apply location-based defaults
      const locationDefaults = buildDefaults('myhost.com', 'https:');
      config = mergeConfig(config, locationDefaults);
      
      // 3. Apply user config (highest priority)
      const userConfig = {
        gatewayWsUrl: 'wss://custom.gateway.com/',
        branding: { name: 'MyApp' }
      };
      config = mergeConfig(config, userConfig);
      
      // User config wins
      expect(config.gatewayWsUrl).toBe('wss://custom.gateway.com/');
      expect(config.branding.name).toBe('MyApp');
      
      // Location defaults applied where not overridden
      expect(config.gatewayHttpUrl).toBe('https://myhost.com');
      
      // Base defaults preserved
      expect(config.appsUrl).toBe('/api/apps');
      expect(config.branding.logo).toBe('🚀');
    });
  });

  describe('Config Validation', () => {
    it('should have required default values', () => {
      expect(DEFAULT_CONFIG).toHaveProperty('appsUrl');
      expect(DEFAULT_CONFIG).toHaveProperty('branding');
      expect(DEFAULT_CONFIG).toHaveProperty('sessions');
      expect(DEFAULT_CONFIG).toHaveProperty('features');
    });

    it('should have valid session defaults', () => {
      expect(DEFAULT_CONFIG.sessions.pollInterval).toBeGreaterThan(0);
      expect(DEFAULT_CONFIG.sessions.defaultLimit).toBeGreaterThan(0);
    });

    it('should have boolean feature flags', () => {
      expect(typeof DEFAULT_CONFIG.features.showApps).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.features.showSubagents).toBe('boolean');
      expect(typeof DEFAULT_CONFIG.features.showAgents).toBe('boolean');
    });
  });
});

describe('Config Integration', () => {
  describe('Full Config Flow', () => {
    it('should produce valid final config for production', () => {
      const defaults = buildDefaults('sharp.example.com', 'https:');
      let config = mergeConfig(DEFAULT_CONFIG, defaults);
      
      // Production overrides
      const prodConfig = {
        sessions: { pollInterval: 60000 },
        features: { showSubagents: false }
      };
      config = mergeConfig(config, prodConfig);
      
      expect(config).toMatchObject({
        gatewayWsUrl: 'wss://sharp.example.com/',
        gatewayHttpUrl: 'https://sharp.example.com',
        appsUrl: '/api/apps',
        sessions: {
          pollInterval: 60000,
          defaultLimit: 50
        },
        features: {
          showApps: true,
          showSubagents: false,
          showAgents: true
        }
      });
    });

    it('should produce valid final config for development', () => {
      const defaults = buildDefaults('localhost:3000', 'http:');
      let config = mergeConfig(DEFAULT_CONFIG, defaults);
      
      // Dev overrides - custom gateway
      const devConfig = {
        gatewayWsUrl: 'ws://localhost:18789/',
        gatewayHttpUrl: 'http://localhost:18789'
      };
      config = mergeConfig(config, devConfig);
      
      expect(config.gatewayWsUrl).toBe('ws://localhost:18789/');
      expect(config.gatewayHttpUrl).toBe('http://localhost:18789');
    });
  });
});
