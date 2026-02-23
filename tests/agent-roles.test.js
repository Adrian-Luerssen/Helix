import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getAgentForRole, getDefaultRoles, resolveAgent, getPmSession, buildSessionKey, getOrCreatePmSessionForGoal, getOrCreatePmSessionForStrand, isPmSession } from '../plugins/helix-goals/lib/agent-roles.js';

describe('agent-roles', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDefaultRoles', () => {
    it('returns default role mappings', () => {
      const roles = getDefaultRoles();
      expect(roles).toHaveProperty('pm', 'main');
      expect(roles).toHaveProperty('frontend', 'frontend');
      expect(roles).toHaveProperty('backend', 'backend');
      expect(roles).toHaveProperty('designer', 'designer');
      expect(roles).toHaveProperty('tester', 'tester');
    });

    it('respects environment variables for defaults', () => {
      process.env.HELIX_PM_AGENT = 'custom-pm';
      process.env.HELIX_FRONTEND_AGENT = 'custom-frontend';
      
      const roles = getDefaultRoles();
      expect(roles.pm).toBe('custom-pm');
      expect(roles.frontend).toBe('custom-frontend');
    });
  });

  describe('getAgentForRole', () => {
    it('returns configured agent from store.config.agentRoles', () => {
      const data = {
        config: {
          agentRoles: {
            backend: 'blake',
            frontend: 'felix',
          },
        },
      };
      
      expect(getAgentForRole(data, 'backend')).toBe('blake');
      expect(getAgentForRole(data, 'frontend')).toBe('felix');
    });

    it('falls back to environment variable', () => {
      process.env.HELIX_BACKEND_AGENT = 'env-backend';
      const data = { config: {} };
      
      expect(getAgentForRole(data, 'backend')).toBe('env-backend');
    });

    it('falls back to role name as agent ID', () => {
      const data = { config: {} };
      expect(getAgentForRole(data, 'designer')).toBe('designer');
    });

    it('works with store instance (load function)', () => {
      const store = {
        load: () => ({
          config: {
            agentRoles: { pm: 'claudia' },
          },
        }),
      };
      
      expect(getAgentForRole(store, 'pm')).toBe('claudia');
    });
  });

  describe('resolveAgent', () => {
    it('resolves known roles to agent IDs', () => {
      const store = {
        load: () => ({
          config: {
            agentRoles: { frontend: 'felix' },
          },
        }),
      };
      
      expect(resolveAgent(store, 'frontend')).toBe('felix');
    });

    it('passes through direct agent IDs', () => {
      const store = { load: () => ({ config: {} }) };
      expect(resolveAgent(store, 'my-custom-agent')).toBe('my-custom-agent');
    });

    it('returns null for null/undefined input', () => {
      const store = { load: () => ({ config: {} }) };
      expect(resolveAgent(store, null)).toBeNull();
      expect(resolveAgent(store, undefined)).toBeNull();
    });
  });

  describe('getPmSession', () => {
    it('returns strand-specific pmSession if set', () => {
      const store = {
        load: () => ({
          strands: [{ id: 'strand_1', pmSession: 'agent:custom-pm:main' }],
          config: { pmSession: 'agent:global-pm:main' },
        }),
      };
      
      expect(getPmSession(store, 'strand_1')).toBe('agent:custom-pm:main');
    });

    it('falls back to global config pmSession', () => {
      const store = {
        load: () => ({
          strands: [{ id: 'strand_1' }],
          config: { pmSession: 'agent:global-pm:main' },
        }),
      };
      
      expect(getPmSession(store, 'strand_1')).toBe('agent:global-pm:main');
    });

    it('falls back to environment variable', () => {
      process.env.HELIX_PM_SESSION = 'agent:env-pm:main';
      const store = {
        load: () => ({
          strands: [],
          config: {},
        }),
      };
      
      expect(getPmSession(store, null)).toBe('agent:env-pm:main');
    });

    it('falls back to system default', () => {
      delete process.env.HELIX_PM_SESSION;
      const store = {
        load: () => ({
          strands: [],
          config: {},
        }),
      };
      
      expect(getPmSession(store, null)).toBe('agent:main:main');
    });
  });

  describe('buildSessionKey', () => {
    it('builds basic session key', () => {
      expect(buildSessionKey('backend', 'main')).toBe('agent:backend:main');
    });

    it('includes subId when provided', () => {
      expect(buildSessionKey('backend', 'subagent', 'task_123')).toBe('agent:backend:subagent:task_123');
    });

    it('defaults to main session type', () => {
      expect(buildSessionKey('frontend')).toBe('agent:frontend:main');
    });
  });

  describe('getOrCreatePmSessionForGoal', () => {
    it('creates a PM session on first call with webchat key format', () => {
      let savedData = null;
      const data = {
        goals: [{ id: 'goal_1', strandId: 'strand_1', tasks: [] }],
        strands: [{ id: 'strand_1' }],
        config: { agentRoles: { pm: 'claudia' } },
        sessionIndex: {},
      };
      const store = {
        load: () => data,
        save: (d) => { savedData = d; },
      };

      const result = getOrCreatePmSessionForGoal(store, 'goal_1');

      expect(result.pmSessionKey).toBe('agent:claudia:webchat:pm-goal_1');
      expect(result.created).toBe(true);
      expect(data.goals[0].pmSessionKey).toBe('agent:claudia:webchat:pm-goal_1');
      expect(data.sessionIndex['agent:claudia:webchat:pm-goal_1']).toEqual({ goalId: 'goal_1' });
      expect(savedData).toBe(data);
    });

    it('returns existing webchat session on subsequent calls (created: false)', () => {
      const data = {
        goals: [{ id: 'goal_1', strandId: 'strand_1', pmSessionKey: 'agent:claudia:webchat:pm-goal_1', tasks: [] }],
        strands: [{ id: 'strand_1' }],
        config: { agentRoles: { pm: 'claudia' } },
        sessionIndex: { 'agent:claudia:webchat:pm-goal_1': { goalId: 'goal_1' } },
      };
      const store = {
        load: () => data,
        save: vi.fn(),
      };

      const result = getOrCreatePmSessionForGoal(store, 'goal_1');

      expect(result.pmSessionKey).toBe('agent:claudia:webchat:pm-goal_1');
      expect(result.created).toBe(false);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('migrates old subagent key to webchat format', () => {
      const data = {
        goals: [{ id: 'goal_1', strandId: 'strand_1', pmSessionKey: 'agent:claudia:subagent:pm-goal_1', tasks: [] }],
        strands: [{ id: 'strand_1' }],
        config: { agentRoles: { pm: 'claudia' } },
        sessionIndex: { 'agent:claudia:subagent:pm-goal_1': { goalId: 'goal_1' } },
      };
      const store = {
        load: () => data,
        save: vi.fn(),
      };

      const result = getOrCreatePmSessionForGoal(store, 'goal_1');

      // Should create a new webchat key and clean up old subagent key
      expect(result.pmSessionKey).toBe('agent:claudia:webchat:pm-goal_1');
      expect(result.created).toBe(true);
      expect(data.sessionIndex['agent:claudia:subagent:pm-goal_1']).toBeUndefined();
      expect(data.sessionIndex['agent:claudia:webchat:pm-goal_1']).toEqual({ goalId: 'goal_1' });
    });

    it('uses configured PM agent ID from config.agentRoles.pm', () => {
      const data = {
        goals: [{ id: 'goal_2', strandId: 'strand_1', tasks: [] }],
        strands: [{ id: 'strand_1' }],
        config: { agentRoles: { pm: 'my-pm-agent' } },
        sessionIndex: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      const result = getOrCreatePmSessionForGoal(store, 'goal_2');
      expect(result.pmSessionKey).toBe('agent:my-pm-agent:webchat:pm-goal_2');
    });

    it('falls back to default PM agent (main) when no config', () => {
      const data = {
        goals: [{ id: 'goal_3', strandId: 'strand_1', tasks: [] }],
        strands: [{ id: 'strand_1' }],
        config: {},
        sessionIndex: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      const result = getOrCreatePmSessionForGoal(store, 'goal_3');
      expect(result.pmSessionKey).toBe('agent:main:webchat:pm-goal_3');
    });

    it('throws for unknown goal', () => {
      const data = {
        goals: [],
        strands: [],
        config: {},
        sessionIndex: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      expect(() => getOrCreatePmSessionForGoal(store, 'nonexistent')).toThrow('Goal nonexistent not found');
    });

    it('initializes sessionIndex if missing', () => {
      const data = {
        goals: [{ id: 'goal_4', strandId: 'strand_1', tasks: [] }],
        strands: [{ id: 'strand_1' }],
        config: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      const result = getOrCreatePmSessionForGoal(store, 'goal_4');
      expect(data.sessionIndex).toBeDefined();
      expect(data.sessionIndex[result.pmSessionKey]).toEqual({ goalId: 'goal_4' });
    });
  });

  describe('isPmSession', () => {
    it('recognizes webchat PM session keys (new format)', () => {
      expect(isPmSession('agent:main:webchat:pm-goal_1')).toBe(true);
      expect(isPmSession('agent:claudia:webchat:pm-goal_abc')).toBe(true);
      expect(isPmSession('agent:main:webchat:pm-strand-strand_1')).toBe(true);
      expect(isPmSession('agent:claudia:webchat:pm-strand-abc')).toBe(true);
    });

    it('recognizes legacy subagent PM session keys (backward compat)', () => {
      expect(isPmSession('agent:main:subagent:pm-goal_1')).toBe(true);
      expect(isPmSession('agent:claudia:subagent:pm-goal_abc')).toBe(true);
      expect(isPmSession('agent:main:subagent:pm-strand-strand_1')).toBe(true);
    });

    it('rejects worker/task subagent keys', () => {
      expect(isPmSession('agent:backend:subagent:task_123')).toBe(false);
      expect(isPmSession('agent:main:subagent:abc123')).toBe(false);
    });

    it('rejects main session keys', () => {
      expect(isPmSession('agent:main:main')).toBe(false);
    });

    it('rejects non-string values', () => {
      expect(isPmSession(null)).toBe(false);
      expect(isPmSession(undefined)).toBe(false);
      expect(isPmSession(123)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isPmSession('')).toBe(false);
    });

    it('rejects webchat sessions that are not PM sessions', () => {
      expect(isPmSession('agent:main:webchat:12345')).toBe(false);
      expect(isPmSession('agent:claudia:webchat:chat-abc')).toBe(false);
    });
  });

  describe('getOrCreatePmSessionForStrand', () => {
    it('creates a strand PM session on first call with webchat key format', () => {
      let savedData = null;
      const data = {
        goals: [],
        strands: [{ id: 'strand_1', name: 'Test Strand' }],
        config: { agentRoles: { pm: 'claudia' } },
        sessionStrandIndex: {},
      };
      const store = {
        load: () => data,
        save: (d) => { savedData = d; },
      };

      const result = getOrCreatePmSessionForStrand(store, 'strand_1');

      expect(result.pmSessionKey).toBe('agent:claudia:webchat:pm-strand-strand_1');
      expect(result.created).toBe(true);
      expect(data.strands[0].pmStrandSessionKey).toBe('agent:claudia:webchat:pm-strand-strand_1');
      expect(data.sessionStrandIndex['agent:claudia:webchat:pm-strand-strand_1']).toBe('strand_1');
      expect(savedData).toBe(data);
    });

    it('returns existing webchat session on subsequent calls (created: false)', () => {
      const data = {
        goals: [],
        strands: [{ id: 'strand_1', name: 'Test Strand', pmStrandSessionKey: 'agent:claudia:webchat:pm-strand-strand_1' }],
        config: { agentRoles: { pm: 'claudia' } },
        sessionStrandIndex: { 'agent:claudia:webchat:pm-strand-strand_1': 'strand_1' },
      };
      const store = {
        load: () => data,
        save: vi.fn(),
      };

      const result = getOrCreatePmSessionForStrand(store, 'strand_1');

      expect(result.pmSessionKey).toBe('agent:claudia:webchat:pm-strand-strand_1');
      expect(result.created).toBe(false);
      expect(store.save).not.toHaveBeenCalled();
    });

    it('migrates old subagent key to webchat format', () => {
      const data = {
        goals: [],
        strands: [{ id: 'strand_1', name: 'Test Strand', pmStrandSessionKey: 'agent:claudia:subagent:pm-strand-strand_1' }],
        config: { agentRoles: { pm: 'claudia' } },
        sessionStrandIndex: { 'agent:claudia:subagent:pm-strand-strand_1': 'strand_1' },
      };
      const store = {
        load: () => data,
        save: vi.fn(),
      };

      const result = getOrCreatePmSessionForStrand(store, 'strand_1');

      // Should create new webchat key and clean up old subagent key
      expect(result.pmSessionKey).toBe('agent:claudia:webchat:pm-strand-strand_1');
      expect(result.created).toBe(true);
      expect(data.sessionStrandIndex['agent:claudia:subagent:pm-strand-strand_1']).toBeUndefined();
      expect(data.sessionStrandIndex['agent:claudia:webchat:pm-strand-strand_1']).toBe('strand_1');
    });

    it('uses configured PM agent ID from config.agentRoles.pm', () => {
      const data = {
        goals: [],
        strands: [{ id: 'strand_2', name: 'Another Strand' }],
        config: { agentRoles: { pm: 'my-pm-agent' } },
        sessionStrandIndex: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      const result = getOrCreatePmSessionForStrand(store, 'strand_2');
      expect(result.pmSessionKey).toBe('agent:my-pm-agent:webchat:pm-strand-strand_2');
    });

    it('falls back to default PM agent (main) when no config', () => {
      const data = {
        goals: [],
        strands: [{ id: 'strand_3', name: 'Third Strand' }],
        config: {},
        sessionStrandIndex: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      const result = getOrCreatePmSessionForStrand(store, 'strand_3');
      expect(result.pmSessionKey).toBe('agent:main:webchat:pm-strand-strand_3');
    });

    it('throws for unknown strand', () => {
      const data = {
        goals: [],
        strands: [],
        config: {},
        sessionStrandIndex: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      expect(() => getOrCreatePmSessionForStrand(store, 'nonexistent')).toThrow('Strand nonexistent not found');
    });

    it('initializes sessionStrandIndex if missing', () => {
      const data = {
        goals: [],
        strands: [{ id: 'strand_4', name: 'Fourth Strand' }],
        config: {},
      };
      const store = {
        load: () => data,
        save: () => {},
      };

      const result = getOrCreatePmSessionForStrand(store, 'strand_4');
      expect(data.sessionStrandIndex).toBeDefined();
      expect(data.sessionStrandIndex[result.pmSessionKey]).toBe('strand_4');
    });
  });
});
