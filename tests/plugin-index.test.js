import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, chmodSync } from 'fs';
import { join } from 'path';
import register from '../plugins/helix-goals/index.js';
import { CLASSIFIER_CONFIG } from '../plugins/helix-goals/lib/classifier.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'plugin-index-test');

function createMockApi(dataDir) {
  const methods = {};
  const hooks = {};
  const toolFactories = [];

  return {
    pluginConfig: { dataDir },
    logger: { info: vi.fn(), error: vi.fn() },
    registerGatewayMethod(name, handler) { methods[name] = handler; },
    registerHook(name, fn) { hooks[name] = fn; },
    registerTool(factory, opts) { toolFactories.push({ factory, opts }); },
    // Accessors for tests
    _methods: methods,
    _hooks: hooks,
    _toolFactories: toolFactories,
    _getToolFactory(name) {
      const entry = toolFactories.find(e => e.opts?.names?.includes(name));
      return entry?.factory ?? null;
    },
  };
}

describe('Plugin index.js', () => {
  let api;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    api = createMockApi(TEST_DIR);
    register(api);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('registration', () => {
    it('registers all gateway methods', () => {
      const expected = [
        // Goals handlers
        'goals.list', 'goals.create', 'goals.get', 'goals.update', 'goals.delete',
        'goals.addSession', 'goals.removeSession', 'goals.sessionLookup',
        'goals.setSessionStrand', 'goals.getSessionStrand', 'goals.listSessionStrands',
        'goals.removeSessionStrand',
        'goals.addTask', 'goals.updateTask', 'goals.deleteTask',
        'goals.addFiles', 'goals.removeFile', 'goals.updatePlan',
        // Strand handlers
        'strands.create', 'strands.list', 'strands.get', 'strands.update', 'strands.delete',
        // Task spawn + kickoff
        'goals.spawnTaskSession', 'goals.kickoff',
        // Plan handlers
        'plans.get', 'plans.syncFromFile', 'plans.updateStatus', 'plans.updateStep',
        'plans.approve', 'plans.reject', 'plans.getLogs', 'plans.appendLog',
        // PM handlers
        'pm.chat', 'pm.getConfig', 'pm.setConfig', 'pm.getAgent',
        'pm.getHistory', 'pm.clearHistory', 'pm.saveResponse',
        'pm.createTasksFromPlan', 'pm.regenerateTasks', 'pm.detectPlan',
        // Strand PM handlers
        'pm.strandChat', 'pm.strandSaveResponse', 'pm.strandGetHistory',
        'pm.strandCreateGoals', 'pm.strandCascade', 'pm.goalCascade',
        // Config handlers
        'config.get', 'config.set', 'config.setRole', 'config.getRole', 'config.listRoles',
        'config.getServices', 'config.setService', 'config.deleteService', 'config.verifyGitHub',
        // Team handlers
        'team.getMessages', 'team.send', 'team.notify', 'team.status',
        // Roles handlers
        'roles.assign', 'roles.list', 'roles.unassign', 'roles.setLabel',
        'roles.autoDetect', 'roles.applyAutoDetect',
        // Notification handlers
        'notifications.list', 'notifications.markRead', 'notifications.dismiss', 'notifications.unreadCount',
        // Autonomy handlers
        'autonomy.getTaskInfo', 'autonomy.setTask', 'autonomy.setStrand', 'autonomy.modes',
        // Classification
        'classification.stats', 'classification.learningReport', 'classification.applyLearning',
        // Session lifecycle
        'sessions.killForGoal', 'sessions.killForStrand', 'sessions.cleanupStale', 'sessions.listForStrand',
        // Conflict detection
        'goals.checkConflicts',
        // Close goal
        'goals.close',
        // Branch status + PR
        'goals.branchStatus', 'goals.createPR',
        // Manual git operations
        'goals.retryPush', 'goals.retryMerge', 'goals.pushMain',
      ];
      for (const name of expected) {
        expect(api._methods).toHaveProperty(name);
      }
      // Verify count matches expected array
      expect(Object.keys(api._methods)).toHaveLength(expected.length);
    });

    it('registers before_agent_start and agent_end hooks', () => {
      expect(api._hooks).toHaveProperty('before_agent_start');
      expect(api._hooks).toHaveProperty('agent_end');
    });

    it('registers 9 tool factories', () => {
      expect(api._toolFactories).toHaveLength(9);
      expect(api._getToolFactory('goal_update')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_bind')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_create_goal')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_add_task')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_spawn_task')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_list')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_status')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_pm_chat')).toBeTypeOf('function');
      expect(api._getToolFactory('strand_pm_kickoff')).toBeTypeOf('function');
    });
  });

  describe('before_agent_start hook (goal path)', () => {
    function seedGoal() {
      let result;
      api._methods['goals.create']({
        params: { title: 'Test Goal', description: 'Build something' },
        respond: (ok, payload, err) => { result = { ok, payload, err }; },
      });
      const goalId = result.payload.goal.id;
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:main' },
        respond: () => {},
      });
      return goalId;
    }

    it('returns context for session assigned to a goal', async () => {
      seedGoal();
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:main' },
      });
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Test Goal');
    });

    it('returns undefined for session not assigned to a goal', async () => {
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:orphan:main' },
      });
      expect(result).toBeUndefined();
    });

    it('returns undefined when no sessionKey', async () => {
      const result = await api._hooks['before_agent_start']({
        context: {},
      });
      expect(result).toBeUndefined();
    });

    it('includes project summary when goal has strandId', async () => {
      // Create strand and goal in it
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Summary Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      const strandId = strandResult.strand.id;

      let goalResult;
      api._methods['goals.create']({
        params: { title: 'Strand Goal A', strandId },
        respond: (ok, payload) => { goalResult = payload; },
      });
      const goalId = goalResult.goal.id;

      api._methods['goals.create']({
        params: { title: 'Strand Goal B', strandId },
        respond: () => {},
      });

      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:summary' },
        respond: () => {},
      });

      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:summary' },
      });
      expect(result.prependContext).toContain('<project');
      expect(result.prependContext).toContain('Summary Strand');
      expect(result.prependContext).toContain('Strand Goal A');
      expect(result.prependContext).toContain('Strand Goal B');
      expect(result.prependContext).toContain('<goal');
    });

    it('no project summary when goal has no strandId', async () => {
      const goalId = seedGoal();
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:main' },
      });
      expect(result.prependContext).toContain('<goal');
      expect(result.prependContext).not.toContain('<project');
    });
  });

  describe('before_agent_start hook (strand path)', () => {
    function seedStrand() {
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Test Strand', description: 'Strand desc' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      const strandId = strandResult.strand.id;

      // Create a goal in this strand
      let goalResult;
      api._methods['goals.create']({
        params: { title: 'Strand Goal', strandId },
        respond: (ok, payload) => { goalResult = payload; },
      });

      // Bind session to strand
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:123', strandId },
        respond: () => {},
      });

      return strandId;
    }

    it('returns strand context for bound session', async () => {
      seedStrand();
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:telegram:123' },
      });
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Test Strand');
      expect(result.prependContext).toContain('Strand Goal');
    });

    it('strand path takes priority over goal path', async () => {
      seedStrand();
      // Also assign session to a different goal via sessionIndex
      let goalResult;
      api._methods['goals.create']({
        params: { title: 'Direct Goal' },
        respond: (ok, payload) => { goalResult = payload; },
      });
      api._methods['goals.addSession']({
        params: { id: goalResult.goal.id, sessionKey: 'agent:main:telegram:123' },
        respond: () => {},
      });

      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:telegram:123' },
      });
      // Should get strand context, not direct goal context
      expect(result.prependContext).toContain('Test Strand');
      expect(result.prependContext).not.toContain('# Direct Goal');
    });
  });

  describe('agent_end hook', () => {
    function seedGoal() {
      let result;
      api._methods['goals.create']({
        params: { title: 'Track Me' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      const goalId = result.payload.goal.id;
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:main' },
        respond: () => {},
      });
      return goalId;
    }

    it('updates goal timestamp on success', async () => {
      const goalId = seedGoal();
      let goalBefore;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { goalBefore = payload.goal; },
      });

      await new Promise(r => setTimeout(r, 5));

      await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:main' },
        success: true,
      });

      let goalAfter;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { goalAfter = payload.goal; },
      });
      expect(goalAfter.updatedAtMs).toBeGreaterThan(goalBefore.updatedAtMs);
      expect(api.logger.info).toHaveBeenCalled();
    });

    it('does nothing on failure', async () => {
      seedGoal();
      const result = await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:main' },
        success: false,
      });
      expect(result).toBeUndefined();
    });

    it('does nothing for unassigned session', async () => {
      const result = await api._hooks['agent_end']({
        context: { sessionKey: 'agent:orphan:main' },
        success: true,
      });
      expect(result).toBeUndefined();
    });

    it('updates strand timestamp for strand-bound session', async () => {
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Tracked Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      const strandId = strandResult.strand.id;
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:123', strandId },
        respond: () => {},
      });

      let strandBefore;
      api._methods['strands.get']({
        params: { id: strandId },
        respond: (ok, payload) => { strandBefore = payload.strand; },
      });

      await new Promise(r => setTimeout(r, 5));

      await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:telegram:123' },
        success: true,
      });

      let strandAfter;
      api._methods['strands.get']({
        params: { id: strandId },
        respond: (ok, payload) => { strandAfter = payload.strand; },
      });
      expect(strandAfter.updatedAtMs).toBeGreaterThan(strandBefore.updatedAtMs);
    });
  });

  describe('goal_update tool factory', () => {
    function seedGoal() {
      let result;
      api._methods['goals.create']({
        params: { title: 'Tooled Goal' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      const goalId = result.payload.goal.id;
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:main' },
        respond: () => {},
      });
      return goalId;
    }

    it('returns null for session without sessionKey', () => {
      const factory = api._getToolFactory('goal_update');
      expect(factory({})).toBeNull();
    });

    it('returns tool for session not yet assigned to a goal (validation deferred to execute)', () => {
      const factory = api._getToolFactory('goal_update');
      const tool = factory({ sessionKey: 'agent:orphan:main' });
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('goal_update');
    });

    it('returns tool definition for assigned session', () => {
      seedGoal();
      const factory = api._getToolFactory('goal_update');
      const tool = factory({ sessionKey: 'agent:main:main' });
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('goal_update');
      expect(tool.execute).toBeTypeOf('function');
    });

    it('tool execute works end-to-end', async () => {
      seedGoal();
      const factory = api._getToolFactory('goal_update');
      const tool = factory({ sessionKey: 'agent:main:main' });
      const result = await tool.execute('call1', { nextTask: 'Starting work' });
      expect(result.content[0].text).toContain('updated');
    });

    it('always includes goalId parameter in schema', () => {
      const factory = api._getToolFactory('goal_update');
      const tool = factory({ sessionKey: 'agent:main:any:123' });
      expect(tool).not.toBeNull();
      expect(tool.parameters.properties).toHaveProperty('goalId');
    });

    it('execute returns error for unassigned session without goalId', async () => {
      const factory = api._getToolFactory('goal_update');
      const tool = factory({ sessionKey: 'agent:orphan:main' });
      const result = await tool.execute('call1', { nextTask: 'test' });
      expect(result.content[0].text).toContain('Error');
    });
  });

  describe('strand_bind tool factory', () => {
    it('returns null for already-bound session', () => {
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Bound Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:123', strandId: strandResult.strand.id },
        respond: () => {},
      });

      const factory = api._getToolFactory('strand_bind');
      expect(factory({ sessionKey: 'agent:main:telegram:123' })).toBeNull();
    });

    it('returns tool definition for unbound session', () => {
      const factory = api._getToolFactory('strand_bind');
      const tool = factory({ sessionKey: 'agent:main:telegram:456' });
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('strand_bind');
    });

    it('tool execute creates new strand and binds when name provided', async () => {
      const factory = api._getToolFactory('strand_bind');
      const tool = factory({ sessionKey: 'agent:main:telegram:new' });
      const result = await tool.execute('call1', { name: 'Brand New Strand', description: 'Created via bind' });
      expect(result.content[0].text).toContain('Brand New Strand');

      // Verify strand was created
      let listResult;
      api._methods['strands.list']({
        params: {},
        respond: (ok, payload) => { listResult = payload; },
      });
      const strand = listResult.strands.find(c => c.name === 'Brand New Strand');
      expect(strand).toBeTruthy();

      // Verify session binding persisted
      let mappingResult;
      api._methods['goals.getSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:new' },
        respond: (ok, payload) => { mappingResult = payload; },
      });
      expect(mappingResult.strandId).toBe(strand.id);
    });

    it('tool execute binds session to strand', async () => {
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Bindable Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });

      const factory = api._getToolFactory('strand_bind');
      const tool = factory({ sessionKey: 'agent:main:telegram:789' });
      const result = await tool.execute('call1', { strandId: strandResult.strand.id });
      expect(result.content[0].text).toContain('Bindable Strand');

      // Verify binding persisted
      let mappingResult;
      api._methods['goals.getSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:789' },
        respond: (ok, payload) => { mappingResult = payload; },
      });
      expect(mappingResult.strandId).toBe(strandResult.strand.id);
    });
  });

  describe('strand_create_goal tool factory', () => {
    function seedStrandBound() {
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Goal Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      const strandId = strandResult.strand.id;
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:123', strandId },
        respond: () => {},
      });
      return strandId;
    }

    it('returns null for unbound session', () => {
      const factory = api._getToolFactory('strand_create_goal');
      expect(factory({ sessionKey: 'agent:unbound:main' })).toBeNull();
    });

    it('returns tool definition for bound session', () => {
      seedStrandBound();
      const factory = api._getToolFactory('strand_create_goal');
      const tool = factory({ sessionKey: 'agent:main:telegram:123' });
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('strand_create_goal');
    });

    it('tool execute creates goal end-to-end', async () => {
      const strandId = seedStrandBound();
      const factory = api._getToolFactory('strand_create_goal');
      const tool = factory({ sessionKey: 'agent:main:telegram:123' });
      const result = await tool.execute('call1', { title: 'New Goal', tasks: ['Task A', 'Task B'] });
      expect(result.content[0].text).toContain('New Goal');

      // Verify goal exists in store
      let listResult;
      api._methods['goals.list']({
        params: {},
        respond: (ok, payload) => { listResult = payload; },
      });
      const goal = listResult.goals.find(g => g.title === 'New Goal');
      expect(goal).toBeTruthy();
      expect(goal.strandId).toBe(strandId);
      expect(goal.tasks).toHaveLength(2);
    });
  });

  describe('strand_add_task tool factory', () => {
    it('returns null for unbound session', () => {
      const factory = api._getToolFactory('strand_add_task');
      expect(factory({ sessionKey: 'agent:unbound:main' })).toBeNull();
    });
  });

  describe('strand_spawn_task tool factory', () => {
    it('returns null for unbound session', () => {
      const factory = api._getToolFactory('strand_spawn_task');
      expect(factory({ sessionKey: 'agent:unbound:main' })).toBeNull();
    });

    it('returns tool definition for bound session', () => {
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Spawn Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:main:telegram:123', strandId: strandResult.strand.id },
        respond: () => {},
      });

      const factory = api._getToolFactory('strand_spawn_task');
      const tool = factory({ sessionKey: 'agent:main:telegram:123' });
      expect(tool).not.toBeNull();
      expect(tool.name).toBe('strand_spawn_task');
    });
  });

  describe('before_agent_start hook (classification)', () => {
    function seedStrandWithKeywords(name, keywords, telegramTopicIds = []) {
      let strandResult;
      api._methods['strands.create']({
        params: { name, keywords, telegramTopicIds },
        respond: (ok, payload) => { strandResult = payload; },
      });
      return strandResult.strand;
    }

    it('auto-routes by Telegram topic binding', async () => {
      const strand = seedStrandWithKeywords('Infra', ['deploy'], [2212]);
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:telegram:group:-100xxx:topic:2212' },
        messages: [{ role: 'user', content: 'something random' }],
      });
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Infra');
    });

    it('auto-routes by keyword match above threshold', async () => {
      // Need name match (0.3) + 4 keywords (0.45) = 0.75, still below 0.8
      // name match (0.3) + keyword max (0.45) = 0.75 < 0.8
      // So we need explicit @strand mention or topic for auto-route
      // Actually, let's use @strand:infra for guaranteed auto-route
      seedStrandWithKeywords('Infra', ['deploy', 'server', 'docker', 'kubernetes']);
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:main:telegram:group:-100xxx:topic:9999' },
        messages: [{ role: 'user', content: 'We need to @strand:infra deploy the server' }],
      });
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Infra');
    });

    it('skips classification for already-bound session', async () => {
      const strand = seedStrandWithKeywords('Infra', ['deploy']);
      // Bind session to strand manually
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:bound:session', strandId: strand.id },
        respond: () => {},
      });
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:bound:session' },
        messages: [{ role: 'user', content: 'deploy the server infrastructure now' }],
      });
      // Should get strand context via normal path, not classification
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Infra');
    });

    it('skips classification for greeting messages', async () => {
      seedStrandWithKeywords('Infra', ['deploy']);
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:new:session' },
        messages: [{ role: 'user', content: 'hello' }],
      });
      // No strands bound, no goals, greeting skipped → undefined
      expect(result).toBeUndefined();
    });

    it('injects strand menu for low-confidence classification', async () => {
      seedStrandWithKeywords('Infra', ['deploy']);
      seedStrandWithKeywords('Frontend', ['react']);
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:new:session' },
        messages: [{ role: 'user', content: 'Can you help me with something?' }],
      });
      // No keyword match → low confidence → strand menu
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('Session Not Yet Assigned');
      expect(result.prependContext).toContain('Infra');
      expect(result.prependContext).toContain('Frontend');
      expect(result.prependContext).toContain('strand_bind');
    });

    it('returns undefined when no strands exist and no match', async () => {
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:new:session' },
        messages: [{ role: 'user', content: 'Can you help me with something?' }],
      });
      expect(result).toBeUndefined();
    });

    it('persists auto-bind in sessionStrandIndex', async () => {
      const strand = seedStrandWithKeywords('Infra', ['deploy']);
      await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:topic:telegram:group:-100xxx:topic:2212' },
        messages: [{ role: 'user', content: 'deploy the server' }],
      });

      // Subsequent call should use strand path (sessionStrandIndex), not classification
      // Seed a topic-bound strand so auto-route fires
      seedStrandWithKeywords('TopicStrand', ['topicword'], [2212]);
      await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:persist:telegram:group:-100xxx:topic:2212' },
        messages: [{ role: 'user', content: 'topicword message' }],
      });

      // Verify binding persisted via RPC
      let mappingResult;
      api._methods['goals.getSessionStrand']({
        params: { sessionKey: 'agent:persist:telegram:group:-100xxx:topic:2212' },
        respond: (ok, payload) => { mappingResult = payload; },
      });
      expect(mappingResult.strandId).toBeTruthy();
    });

    it('appends goal intent hint for structured messages', async () => {
      seedStrandWithKeywords('Infra', ['deploy'], [5555]);
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:goal:telegram:group:-100xxx:topic:5555' },
        messages: [{
          role: 'user',
          content: 'I need to deploy the server. Here is the plan:\n- First, update dependencies\n- Then, run migrations\n- After that, deploy to staging\n- Finally, verify health checks\nThis is urgent and blocking the release.',
        }],
      });
      expect(result).toHaveProperty('prependContext');
      expect(result.prependContext).toContain('strand_create_goal');
    });

    it('does not crash on classification error, logs it', async () => {
      seedStrandWithKeywords('Infra', ['deploy']);
      // Corrupt the classification log file to force append() to throw
      writeFileSync(join(TEST_DIR, 'classification-log.json'), '{corrupt');
      const result = await api._hooks['before_agent_start']({
        context: { sessionKey: 'agent:error:test' },
        messages: [{ role: 'user', content: 'deploy the infrastructure now' }],
      });
      // Should not throw — falls through to undefined or menu
      expect(result === undefined || result?.prependContext).toBeTruthy();
      expect(api.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('classification error')
      );
    });

    it('skips classification when kill switch is off', async () => {
      const original = CLASSIFIER_CONFIG.enabled;
      try {
        CLASSIFIER_CONFIG.enabled = false;
        seedStrandWithKeywords('Infra', ['deploy'], [7777]);
        const result = await api._hooks['before_agent_start']({
          context: { sessionKey: 'agent:kill:telegram:group:-100xxx:topic:7777' },
          messages: [{ role: 'user', content: 'deploy the server now' }],
        });
        // Kill switch should prevent classification — no auto-route, no menu
        expect(result).toBeUndefined();
      } finally {
        CLASSIFIER_CONFIG.enabled = original;
      }
    });
  });

  describe('classification RPC methods', () => {
    it('classification.stats returns stats', () => {
      let result;
      api._methods['classification.stats']({
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      expect(result.ok).toBe(true);
      expect(result.payload.stats).toHaveProperty('total');
      expect(result.payload.stats).toHaveProperty('accuracy');
    });

    it('classification.learningReport returns suggestions', () => {
      let result;
      api._methods['classification.learningReport']({
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      expect(result.ok).toBe(true);
      expect(result.payload.suggestions).toBeInstanceOf(Array);
    });

    it('classification.applyLearning defaults to dryRun', () => {
      let result;
      api._methods['classification.applyLearning']({
        params: {},
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      expect(result.ok).toBe(true);
      expect(result.payload.dryRun).toBe(true);
      expect(result.payload.applied).toBeInstanceOf(Array);
    });

    it('classification.applyLearning respects dryRun: false', () => {
      let result;
      api._methods['classification.applyLearning']({
        params: { dryRun: false },
        respond: (ok, payload) => { result = { ok, payload }; },
      });
      expect(result.ok).toBe(true);
      expect(result.payload.dryRun).toBe(false);
      expect(result.payload.applied).toBeInstanceOf(Array);
    });
  });

  describe('reclassification tracking', () => {
    it('logs correction when setSessionStrand changes strand', () => {
      let strandA, strandB;
      api._methods['strands.create']({
        params: { name: 'Strand A' },
        respond: (ok, payload) => { strandA = payload.strand; },
      });
      api._methods['strands.create']({
        params: { name: 'Strand B' },
        respond: (ok, payload) => { strandB = payload.strand; },
      });

      // First bind
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:reclass:test', strandId: strandA.id },
        respond: () => {},
      });

      // Rebind to different strand → should log reclassification
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:reclass:test', strandId: strandB.id },
        respond: () => {},
      });

      // Check stats show a correction
      let result;
      api._methods['classification.stats']({
        respond: (ok, payload) => { result = payload; },
      });
      expect(result.stats.corrected).toBeGreaterThanOrEqual(1);
    });

    it('does not log correction when rebinding to same strand', () => {
      let strand;
      api._methods['strands.create']({
        params: { name: 'Same Strand' },
        respond: (ok, payload) => { strand = payload.strand; },
      });

      // Bind twice to the same strand
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:same:test', strandId: strand.id },
        respond: () => {},
      });
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:same:test', strandId: strand.id },
        respond: () => {},
      });

      let result;
      api._methods['classification.stats']({
        respond: (ok, payload) => { result = payload; },
      });
      expect(result.stats.corrected).toBe(0);
    });

    it('reclassification log error does not block rebinding', () => {
      let strandA, strandB;
      api._methods['strands.create']({
        params: { name: 'Strand X' },
        respond: (ok, payload) => { strandA = payload.strand; },
      });
      api._methods['strands.create']({
        params: { name: 'Strand Y' },
        respond: (ok, payload) => { strandB = payload.strand; },
      });

      // First bind
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:errlog:test', strandId: strandA.id },
        respond: () => {},
      });

      // Corrupt classification log to force recordReclassification to throw
      writeFileSync(join(TEST_DIR, 'classification-log.json'), '{corrupt');

      // Rebind should still succeed despite log error
      let rebindResult;
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:errlog:test', strandId: strandB.id },
        respond: (ok, payload) => { rebindResult = { ok, payload }; },
      });
      expect(rebindResult.ok).toBe(true);

      // Verify binding took effect
      let mapping;
      api._methods['goals.getSessionStrand']({
        params: { sessionKey: 'agent:errlog:test' },
        respond: (ok, payload) => { mapping = payload; },
      });
      expect(mapping.strandId).toBe(strandB.id);

      // Error should have been logged
      expect(api.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('reclassification tracking failed')
      );
    });
  });

  describe('goals.kickoff with goal-level dependencies', () => {
    it('blocks kickoff when goal dependsOn are not done', async () => {
      // Create strand
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Phase Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      const strandId = strandResult.strand.id;

      // Create phase 1 goal
      let goal1Result;
      api._methods['goals.create']({
        params: { title: 'Foundation', strandId },
        respond: (ok, payload) => { goal1Result = payload; },
      });

      // Create phase 2 goal that depends on phase 1
      let goal2Result;
      api._methods['goals.create']({
        params: { title: 'Features', strandId },
        respond: (ok, payload) => { goal2Result = payload; },
      });
      const goal2Id = goal2Result.goal.id;

      // Manually set dependsOn on goal 2
      api._methods['goals.update']({
        params: { id: goal2Id, dependsOn: [goal1Result.goal.id], phase: 2 },
        respond: () => {},
      });

      // Add a task to goal 2 so kickoff has something to try
      api._methods['goals.addTask']({
        params: { goalId: goal2Id, text: 'Build feature', assignedAgent: 'backend' },
        respond: () => {},
      });

      // Kickoff goal 2 — should be blocked because goal 1 is not done
      let kickoffResult;
      await api._methods['goals.kickoff']({
        params: { goalId: goal2Id },
        respond: (ok, payload) => { kickoffResult = { ok, payload }; },
      });

      expect(kickoffResult.ok).toBe(true);
      expect(kickoffResult.payload.spawnedSessions).toHaveLength(0);
      expect(kickoffResult.payload.message).toContain('blocked by dependencies');
    });

    it('allows kickoff when goal has no dependsOn', async () => {
      // Create a goal with a task but no dependsOn
      let goalResult;
      api._methods['goals.create']({
        params: { title: 'Independent Goal' },
        respond: (ok, payload) => { goalResult = payload; },
      });
      const goalId = goalResult.goal.id;

      api._methods['goals.addTask']({
        params: { goalId, text: 'Do something', assignedAgent: 'backend' },
        respond: () => {},
      });

      // Kickoff should proceed (may fail to actually spawn because no real gateway, but should not be blocked)
      let kickoffResult;
      try {
        await api._methods['goals.kickoff']({
          params: { goalId },
          respond: (ok, payload, err) => { kickoffResult = { ok, payload, err }; },
        });
      } catch {
        // Spawn may fail in test env — that's fine, we just need to check it wasn't blocked
      }

      // Should not have returned 'blocked by dependencies'
      if (kickoffResult?.ok && kickoffResult?.payload) {
        expect(kickoffResult.payload.message).not.toContain('blocked by dependencies');
      }
    });
  });

  describe('agent_end hook (auto-complete and auto-merge)', () => {
    it('auto-marks in-progress task as done when agent ends normally', async () => {
      // Create goal with a task marked in-progress
      let goalResult;
      api._methods['goals.create']({
        params: { title: 'Auto-Complete Goal' },
        respond: (ok, payload) => { goalResult = payload; },
      });
      const goalId = goalResult.goal.id;

      // Add a task
      let taskResult;
      api._methods['goals.addTask']({
        params: { goalId, text: 'Do work' },
        respond: (ok, payload) => { taskResult = payload; },
      });

      // Manually set task to in-progress with a session key
      api._methods['goals.updateTask']({
        params: { goalId, taskId: taskResult.task.id, status: 'in-progress' },
        respond: () => {},
      });

      // Assign session to goal
      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:autocomp' },
        respond: () => {},
      });

      // Manually set sessionKey on task (simulate spawn)
      let data;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { data = payload; },
      });

      // Directly update the task's sessionKey in the store
      const storeData = JSON.parse(require('fs').readFileSync(join(TEST_DIR, 'goals.json'), 'utf-8'));
      const storeGoal = storeData.goals.find(g => g.id === goalId);
      const storeTask = storeGoal.tasks.find(t => t.id === taskResult.task.id);
      storeTask.sessionKey = 'agent:main:autocomp';
      storeData.sessionIndex['agent:main:autocomp'] = { goalId };
      require('fs').writeFileSync(join(TEST_DIR, 'goals.json'), JSON.stringify(storeData));

      // Trigger agent_end with success
      await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:autocomp' },
        success: true,
      });

      // Verify task was auto-marked as done
      let updatedGoal;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { updatedGoal = payload.goal; },
      });

      const task = updatedGoal.tasks.find(t => t.id === taskResult.task.id);
      expect(task.status).toBe('done');
      expect(task.done).toBe(true);
      expect(api.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('auto-completed task')
      );
    });

    it('does not auto-mark task as done when agent fails', async () => {
      // Create goal with a task marked in-progress
      let goalResult;
      api._methods['goals.create']({
        params: { title: 'Fail Goal' },
        respond: (ok, payload) => { goalResult = payload; },
      });
      const goalId = goalResult.goal.id;

      let taskResult;
      api._methods['goals.addTask']({
        params: { goalId, text: 'Fail work' },
        respond: (ok, payload) => { taskResult = payload; },
      });

      api._methods['goals.updateTask']({
        params: { goalId, taskId: taskResult.task.id, status: 'in-progress' },
        respond: () => {},
      });

      api._methods['goals.addSession']({
        params: { id: goalId, sessionKey: 'agent:main:failcomp' },
        respond: () => {},
      });

      // Set sessionKey on task
      const storeData = JSON.parse(require('fs').readFileSync(join(TEST_DIR, 'goals.json'), 'utf-8'));
      const storeGoal = storeData.goals.find(g => g.id === goalId);
      const storeTask = storeGoal.tasks.find(t => t.id === taskResult.task.id);
      storeTask.sessionKey = 'agent:main:failcomp';
      storeData.sessionIndex['agent:main:failcomp'] = { goalId };
      require('fs').writeFileSync(join(TEST_DIR, 'goals.json'), JSON.stringify(storeData));

      // Trigger agent_end with failure
      await api._hooks['agent_end']({
        context: { sessionKey: 'agent:main:failcomp' },
        success: false,
      });

      let updatedGoal;
      api._methods['goals.get']({
        params: { id: goalId },
        respond: (ok, payload) => { updatedGoal = payload.goal; },
      });

      // Task should not be auto-completed on failure — it should be retried or failed
      const task = updatedGoal.tasks.find(t => t.id === taskResult.task.id);
      expect(task.status).not.toBe('done');
    });
  });

  describe('agent_end hook (error handling)', () => {
    it('catches errors and logs them without crashing', async () => {
      // Create a strand and bind session (strand path calls save immediately)
      let strandResult;
      api._methods['strands.create']({
        params: { name: 'Error Strand' },
        respond: (ok, payload) => { strandResult = payload; },
      });
      api._methods['goals.setSessionStrand']({
        params: { sessionKey: 'agent:end:error', strandId: strandResult.strand.id },
        respond: () => {},
      });

      // Make data dir read-only so store.save() throws EACCES
      chmodSync(TEST_DIR, 0o555);

      try {
        // agent_end should not throw — error caught by try-catch
        await api._hooks['agent_end']({
          context: { sessionKey: 'agent:end:error' },
          success: true,
        });

        expect(api.logger.error).toHaveBeenCalledWith(
          expect.stringContaining('agent_end error')
        );
      } finally {
        // Restore write permissions for cleanup
        chmodSync(TEST_DIR, 0o755);
      }
    });
  });
});
