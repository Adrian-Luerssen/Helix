import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../plugins/helix-goals/lib/goals-store.js';
import {
  AUTONOMY_MODES,
  DEFAULT_AUTONOMY_MODE,
  resolveAutonomyMode,
  buildAutonomyDirective,
  setTaskAutonomy,
  setStrandAutonomy,
  getTaskAutonomyInfo,
  createAutonomyHandlers,
} from '../plugins/helix-goals/lib/autonomy.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'autonomy-test');

describe('Autonomy Manager', () => {
  let store;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('constants', () => {
    it('exports valid autonomy modes', () => {
      expect(AUTONOMY_MODES).toContain('full');
      expect(AUTONOMY_MODES).toContain('plan');
      expect(AUTONOMY_MODES).toContain('step');
      expect(AUTONOMY_MODES).toContain('supervised');
    });

    it('has plan as default mode', () => {
      expect(DEFAULT_AUTONOMY_MODE).toBe('plan');
    });
  });

  describe('resolveAutonomyMode', () => {
    it('returns default for null task and strand', () => {
      expect(resolveAutonomyMode(null, null)).toBe('plan');
    });

    it('returns task autonomyMode when set', () => {
      const task = { autonomyMode: 'full' };
      expect(resolveAutonomyMode(task, null)).toBe('full');
    });

    it('returns strand autonomyMode when task has none', () => {
      const task = {};
      const strand = { autonomyMode: 'supervised' };
      expect(resolveAutonomyMode(task, strand)).toBe('supervised');
    });

    it('task mode overrides strand mode', () => {
      const task = { autonomyMode: 'full' };
      const strand = { autonomyMode: 'supervised' };
      expect(resolveAutonomyMode(task, strand)).toBe('full');
    });

    it('ignores invalid autonomy modes', () => {
      const task = { autonomyMode: 'invalid' };
      expect(resolveAutonomyMode(task, null)).toBe('plan');
    });
  });

  describe('buildAutonomyDirective', () => {
    it('returns directive for full mode', () => {
      const directive = buildAutonomyDirective('full');
      expect(directive).toContain('Full');
      expect(directive).toContain('autonomy');
    });

    it('returns directive for plan mode', () => {
      const directive = buildAutonomyDirective('plan');
      expect(directive).toContain('Plan Approval Required');
      expect(directive).toContain('PLAN.md');
    });

    it('returns directive for step mode', () => {
      const directive = buildAutonomyDirective('step');
      expect(directive).toContain('Step-by-Step');
    });

    it('returns directive for supervised mode', () => {
      const directive = buildAutonomyDirective('supervised');
      expect(directive).toContain('Supervised');
      expect(directive).toContain('supervision');
    });

    it('returns default directive for unknown mode', () => {
      const directive = buildAutonomyDirective('unknown');
      expect(directive).toContain('Plan Approval Required');
    });
  });

  describe('setTaskAutonomy', () => {
    function seedGoalWithTask() {
      const data = store.load();
      const goal = {
        id: 'goal_test',
        title: 'Test Goal',
        tasks: [{ id: 'task_test', text: 'Test task' }],
        sessions: [],
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.goals.push(goal);
      store.save(data);
      return goal;
    }

    it('sets autonomy mode on task', () => {
      seedGoalWithTask();
      
      const result = setTaskAutonomy(store, 'goal_test', 'task_test', 'full');
      expect(result.success).toBe(true);
      expect(result.task.autonomyMode).toBe('full');
    });

    it('persists autonomy mode', () => {
      seedGoalWithTask();
      setTaskAutonomy(store, 'goal_test', 'task_test', 'supervised');
      
      const data = store.load();
      expect(data.goals[0].tasks[0].autonomyMode).toBe('supervised');
    });

    it('rejects invalid mode', () => {
      seedGoalWithTask();
      
      const result = setTaskAutonomy(store, 'goal_test', 'task_test', 'invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mode');
    });

    it('returns error for unknown goal', () => {
      const result = setTaskAutonomy(store, 'goal_unknown', 'task_test', 'full');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('returns error for unknown task', () => {
      seedGoalWithTask();
      
      const result = setTaskAutonomy(store, 'goal_test', 'task_unknown', 'full');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('setStrandAutonomy', () => {
    function seedStrand() {
      const data = store.load();
      const strand = {
        id: 'strand_test',
        name: 'Test Strand',
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.strands.push(strand);
      store.save(data);
      return strand;
    }

    it('sets autonomy mode on strand', () => {
      seedStrand();
      
      const result = setStrandAutonomy(store, 'strand_test', 'step');
      expect(result.success).toBe(true);
      expect(result.strand.autonomyMode).toBe('step');
    });

    it('persists autonomy mode', () => {
      seedStrand();
      setStrandAutonomy(store, 'strand_test', 'supervised');
      
      const data = store.load();
      expect(data.strands[0].autonomyMode).toBe('supervised');
    });

    it('rejects invalid mode', () => {
      seedStrand();
      
      const result = setStrandAutonomy(store, 'strand_test', 'invalid');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid mode');
    });

    it('returns error for unknown strand', () => {
      const result = setStrandAutonomy(store, 'strand_unknown', 'full');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('getTaskAutonomyInfo', () => {
    function seedGoalWithTaskAndStrand() {
      const data = store.load();
      const strand = {
        id: 'strand_test',
        name: 'Test Strand',
        autonomyMode: 'step',
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      const goal = {
        id: 'goal_test',
        title: 'Test Goal',
        strandId: 'strand_test',
        tasks: [{ id: 'task_test', text: 'Test task' }],
        sessions: [],
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.strands.push(strand);
      data.goals.push(goal);
      store.save(data);
      return { goal, strand };
    }

    it('returns autonomy info for a task', () => {
      seedGoalWithTaskAndStrand();
      
      const result = getTaskAutonomyInfo(store, 'goal_test', 'task_test');
      expect(result.success).toBe(true);
      expect(result.mode).toBe('step'); // From strand
      expect(result.directive).toContain('Step-by-Step');
      expect(result.strandMode).toBe('step');
      expect(result.taskMode).toBeNull();
    });

    it('task mode overrides strand mode', () => {
      seedGoalWithTaskAndStrand();
      setTaskAutonomy(store, 'goal_test', 'task_test', 'full');
      
      const result = getTaskAutonomyInfo(store, 'goal_test', 'task_test');
      expect(result.mode).toBe('full');
      expect(result.taskMode).toBe('full');
      expect(result.strandMode).toBe('step');
    });

    it('returns error for unknown goal', () => {
      const result = getTaskAutonomyInfo(store, 'goal_unknown', 'task_test');
      expect(result.success).toBe(false);
    });
  });

  describe('RPC handlers', () => {
    function seedGoalWithTask() {
      const data = store.load();
      const goal = {
        id: 'goal_test',
        title: 'Test Goal',
        tasks: [{ id: 'task_test', text: 'Test task' }],
        sessions: [],
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      };
      data.goals.push(goal);
      store.save(data);
    }

    function seedStrand() {
      const data = store.load();
      data.strands.push({
        id: 'strand_test',
        name: 'Test Strand',
        createdAtMs: Date.now(),
        updatedAtMs: Date.now(),
      });
      store.save(data);
    }

    it('autonomy.modes returns available modes', () => {
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.modes']({
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.modes).toEqual(AUTONOMY_MODES);
      expect(result.payload.default).toBe('plan');
      expect(result.payload.descriptions).toHaveProperty('full');
    });

    it('autonomy.setTask sets task autonomy', () => {
      seedGoalWithTask();
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.setTask']({
        params: { goalId: 'goal_test', taskId: 'task_test', mode: 'full' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.mode).toBe('full');
    });

    it('autonomy.setStrand sets strand autonomy', () => {
      seedStrand();
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.setStrand']({
        params: { strandId: 'strand_test', mode: 'supervised' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.mode).toBe('supervised');
    });

    it('autonomy.getTaskInfo returns autonomy info', () => {
      seedGoalWithTask();
      const handlers = createAutonomyHandlers(store);
      let result;
      handlers['autonomy.getTaskInfo']({
        params: { goalId: 'goal_test', taskId: 'task_test' },
        respond: (ok, payload) => { result = { ok, payload }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.mode).toBe('plan'); // Default
      expect(result.payload.directive).toBeTruthy();
    });
  });
});
