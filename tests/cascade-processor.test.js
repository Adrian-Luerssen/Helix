import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processPmCascadeResponse } from '../plugins/helix-goals/lib/cascade-processor.js';

function createMockStore() {
  let idCounter = 0;
  return {
    newId: (prefix = 'item') => `${prefix}_test_${++idCounter}`,
  };
}

function createGoal(overrides = {}) {
  return {
    id: 'goal_1',
    title: 'Build auth',
    description: 'Authentication system',
    strandId: 'strand_1',
    status: 'active',
    completed: false,
    tasks: [],
    sessions: [],
    files: [],
    pmChatHistory: [],
    cascadeState: 'awaiting_plan',
    cascadeMode: 'full',
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    ...overrides,
  };
}

const PLAN_WITH_TASKS = `## Implementation Plan

| # | Task | Agent | Time |
|---|------|-------|------|
| 1 | Set up JWT middleware | backend | 2h |
| 2 | Create login form | frontend | 3h |
| 3 | Write auth tests | tester | 1h |

**Status:** Awaiting Approval`;

const PLAN_NO_TASKS = `## Analysis

I've reviewed the requirements. Here are some thoughts about the authentication system.

The best approach would be to use JWT tokens with refresh token rotation.`;

const PLAN_DETECTED_NO_PARSEABLE = `## Plan

This is the overall plan for the project. We should focus on quality.

**Status:** Awaiting Approval`;

describe('processPmCascadeResponse', () => {
  let store;

  beforeEach(() => {
    store = createMockStore();
  });

  describe('full mode with plan containing tasks', () => {
    it('saves response, detects plan, creates tasks, and sets cascadeState to tasks_created', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      const result = processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      expect(result.hasPlan).toBe(true);
      expect(result.tasksCreated).toBe(3);
      expect(result.cascadeState).toBe('tasks_created');
      expect(result.createdTasks).toHaveLength(3);

      // Verify tasks created on goal
      expect(goal.tasks).toHaveLength(3);
      expect(goal.tasks[0].text).toContain('JWT middleware');
      expect(goal.tasks[0].assignedAgent).toBe('backend');
      expect(goal.tasks[1].text).toContain('login form');
      expect(goal.tasks[2].text).toContain('auth tests');

      // Verify sequential dependencies
      expect(goal.tasks[0].dependsOn).toEqual([]);
      expect(goal.tasks[1].dependsOn).toEqual([goal.tasks[0].id]);
      expect(goal.tasks[2].dependsOn).toEqual([goal.tasks[1].id]);

      // Verify state
      expect(goal.cascadeState).toBe('tasks_created');
      expect(goal.pmPlanContent).toBe(PLAN_WITH_TASKS);
    });

    it('saves response to pmChatHistory', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      expect(goal.pmChatHistory).toHaveLength(1);
      expect(goal.pmChatHistory[0].role).toBe('assistant');
      expect(goal.pmChatHistory[0].content).toBe(PLAN_WITH_TASKS);
      expect(goal.pmChatHistory[0].timestamp).toBeTypeOf('number');
    });

    it('each created task has required fields', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      const result = processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      for (const task of result.createdTasks) {
        expect(task.id).toBeTruthy();
        expect(task.text).toBeTruthy();
        expect(task.status).toBe('pending');
        expect(task.done).toBe(false);
        expect(task.sessionKey).toBeNull();
        expect(task.createdAtMs).toBeTypeOf('number');
      }
    });
  });

  describe('plan mode', () => {
    it('saves response and sets cascadeState to plan_ready when plan detected', () => {
      const goal = createGoal({ cascadeMode: 'plan' });
      const result = processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      expect(result.hasPlan).toBe(true);
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('plan_ready');
      expect(result.createdTasks).toHaveLength(0);
      expect(goal.tasks).toHaveLength(0);
      expect(goal.cascadeState).toBe('plan_ready');
    });

    it('sets cascadeState to response_saved when no plan detected', () => {
      const goal = createGoal({ cascadeMode: 'plan' });
      const result = processPmCascadeResponse(store, goal, PLAN_NO_TASKS);

      expect(result.hasPlan).toBe(false);
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('response_saved');
    });
  });

  describe('full mode without plan', () => {
    it('saves response and sets cascadeState to response_saved', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      const result = processPmCascadeResponse(store, goal, PLAN_NO_TASKS);

      expect(result.hasPlan).toBe(false);
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('response_saved');
      expect(goal.tasks).toHaveLength(0);
    });
  });

  describe('full mode with plan but no parseable tasks', () => {
    it('sets cascadeState to plan_parse_failed', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      const result = processPmCascadeResponse(store, goal, PLAN_DETECTED_NO_PARSEABLE);

      expect(result.hasPlan).toBe(true);
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('plan_parse_failed');
      expect(goal.cascadeState).toBe('plan_parse_failed');
    });
  });

  describe('edge cases', () => {
    it('handles empty content', () => {
      const goal = createGoal();
      const result = processPmCascadeResponse(store, goal, '');

      expect(result.hasPlan).toBe(false);
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('response_saved');
    });

    it('handles null content', () => {
      const goal = createGoal();
      const result = processPmCascadeResponse(store, goal, null);

      expect(result.hasPlan).toBe(false);
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('response_saved');
    });

    it('initializes pmChatHistory if missing', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      delete goal.pmChatHistory;

      processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      expect(goal.pmChatHistory).toHaveLength(1);
      expect(goal.pmChatHistory[0].role).toBe('assistant');
    });

    it('respects mode from options over goal.cascadeMode', () => {
      const goal = createGoal({ cascadeMode: 'full' });
      const result = processPmCascadeResponse(store, goal, PLAN_WITH_TASKS, { mode: 'plan' });

      // Should act as plan mode — no tasks created
      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('plan_ready');
    });

    it('defaults to plan mode when no mode specified anywhere', () => {
      const goal = createGoal({ cascadeMode: null });
      const result = processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      expect(result.tasksCreated).toBe(0);
      expect(result.cascadeState).toBe('plan_ready');
    });

    it('appends to existing tasks', () => {
      const goal = createGoal({
        cascadeMode: 'full',
        tasks: [{ id: 'existing_1', text: 'Existing task', status: 'done' }],
      });

      const result = processPmCascadeResponse(store, goal, PLAN_WITH_TASKS);

      expect(goal.tasks).toHaveLength(4); // 1 existing + 3 new
      expect(goal.tasks[0].id).toBe('existing_1');
      expect(result.tasksCreated).toBe(3);
    });
  });
});
