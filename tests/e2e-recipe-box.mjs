#!/usr/bin/env node
/**
 * E2E Test: Recipe Box Project — PM Endpoint Flow
 *
 * Instead of calling library functions directly, this test hits the PM endpoint
 * like a real Telegram user would:
 *   1. Send a message to the PM: 'Build me a recipe box app with core data
 *      model/API and frontend UI components'
 *   2. PM cascade flow: PM creates goals → tasks → spawns workers → code gets done
 *   3. Verify the full end-to-end pipeline works
 *
 * Gateway RPC calls are mocked so we don't need a live OpenClaw instance,
 * but the PM message → goals → tasks flow through real executor code.
 */

import { createGoalsStore } from '../plugins/helix-goals/lib/goals-store.js';
import {
  createStrandPmChatExecutor,
  createStrandPmKickoffExecutor,
} from '../plugins/helix-goals/lib/strand-tools.js';
import { createTaskSpawnHandler } from '../plugins/helix-goals/lib/task-spawn.js';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const DATA_DIR = join(tmpdir(), `e2e-recipe-box-pm-${Date.now()}`);
mkdirSync(DATA_DIR, { recursive: true });

const store = createGoalsStore(DATA_DIR);
const logger = {
  debug: () => {},
  info: (msg) => console.log(`   [info] ${msg}`),
  warn: (msg) => console.log(`   [warn] ${msg}`),
  error: (msg) => console.error(`   [error] ${msg}`),
};

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

// ─── PM plan response the mock gateway will return ───────────────────────────

const PM_PLAN_RESPONSE = `## Plan: Recipe Box App

I'll structure this as a two-phase project with sequential goals:

### Phase 1: Core data model and API
Build the recipe data model (JSON storage) and REST API endpoints for CRUD operations.

**Tasks:**
1. Create recipe data model with schema and validation
2. Implement CRUD API endpoints (GET/POST/PUT/DELETE)
3. Add seed data with sample recipes

### Phase 2: Frontend UI components
Build the HTML/CSS/JS frontend with recipe list, detail view, and add/edit forms.

**Tasks:**
1. Create main HTML page with recipe list layout
2. Add CSS styling with responsive grid
3. Implement JavaScript for dynamic recipe rendering

| Phase | Goal | Role |
|-------|------|------|
| 1 | Core data model and API | eng |
| 2 | Frontend UI components | eng |`;

// ─── Goal definitions that the PM "creates" ─────────────────────────────────

const GOAL_DEFS = [
  {
    title: 'Core data model and API',
    description: 'Create the recipe data model (JSON storage) and REST API endpoints for CRUD operations',
    tasks: [
      'Create recipe data model with schema and validation',
      'Implement CRUD API endpoints (GET/POST/PUT/DELETE)',
      'Add seed data with sample recipes',
    ],
  },
  {
    title: 'Frontend UI components',
    description: 'Build the HTML/CSS/JS frontend with recipe list, detail view, and add/edit forms',
    tasks: [
      'Create main HTML page with recipe list layout',
      'Add CSS styling with responsive grid',
      'Implement JavaScript for dynamic recipe rendering',
    ],
  },
];

// ─── Step 1: Set up strand (like a user's existing project) ──────────────────

log('📦', 'Setting up "Recipe Box" strand...');

const strandId = 'strand_recipe';
const now = Date.now();

const data = store.load();
data.strands.push({
  id: strandId,
  name: 'Recipe Box',
  description: 'A simple recipe management web app',
  color: '#e67e22',
  keywords: ['recipe', 'cooking', 'web-app'],
  workspace: null,
  services: {},
  createdAtMs: now,
  updatedAtMs: now,
});
store.save(data);

log('✅', 'Strand registered in store');

// ─── Step 2: Build mock gateway RPC ─────────────────────────────────────────

let historyCallCount = 0;
const rpcCalls = [];

async function mockGatewayRpcCall(method, params) {
  rpcCalls.push({ method, params });

  // pm.strandChat — prepare enriched message and return PM session key
  if (method === 'pm.strandChat') {
    return {
      sessionKey: 'agent:main:webchat:pm-recipe',
      enrichedMessage: `[Strand: Recipe Box]\n${params.message}`,
    };
  }

  // chat.send — the message is delivered to the PM (no-op in mock)
  if (method === 'chat.send') {
    return {};
  }

  // chat.history — first call is baseline (empty), second returns PM plan
  if (method === 'chat.history') {
    historyCallCount++;
    if (historyCallCount <= 1) {
      return { messages: [] };
    }
    return {
      messages: [
        { role: 'user', content: params.message || 'Build me an app' },
        { role: 'assistant', content: PM_PLAN_RESPONSE },
      ],
    };
  }

  // pm.strandSaveResponse — acknowledge
  if (method === 'pm.strandSaveResponse') {
    return {};
  }

  // pm.strandCreateGoals — parse PM plan and create goals in our store
  if (method === 'pm.strandCreateGoals') {
    const storeData = store.load();
    const createdGoals = [];

    for (let i = 0; i < GOAL_DEFS.length; i++) {
      const def = GOAL_DEFS[i];
      const goalId = store.newId('goal');
      const goalNow = Date.now();

      const tasks = def.tasks.map((text) => ({
        id: store.newId('task'),
        text,
        description: '',
        status: 'pending',
        done: false,
        priority: null,
        sessionKey: null,
        dependsOn: [],
        summary: '',
        createdAtMs: goalNow,
        updatedAtMs: goalNow,
      }));

      // Sequential dependencies within a goal
      for (let j = 1; j < tasks.length; j++) {
        tasks[j].dependsOn = [tasks[j - 1].id];
      }

      const goal = {
        id: goalId,
        title: def.title,
        description: def.description,
        notes: '',
        status: 'active',
        completed: false,
        strandId,
        priority: null,
        deadline: null,
        worktree: null,
        tasks,
        sessions: [],
        files: [],
        phase: i + 1,
        dependsOn: i > 0 ? [createdGoals[i - 1].id] : [],
        pmPlanContent: PM_PLAN_RESPONSE,
        createdAtMs: goalNow,
        updatedAtMs: goalNow,
      };

      storeData.goals.unshift(goal);
      createdGoals.push(goal);
    }

    store.save(storeData);

    return {
      ok: true,
      goalsCreated: createdGoals.length,
      goals: createdGoals.map(g => ({
        id: g.id,
        title: g.title,
        tasks: g.tasks,
      })),
    };
  }

  // pm.goalCascade — would trigger PM planning for taskless goals
  if (method === 'pm.goalCascade') {
    return {};
  }

  return {};
}

// ─── Step 3: Send PM message (like a Telegram user would) ───────────────────

log('💬', 'Sending PM message: "Build me a recipe box app with core data model/API and frontend UI components"');

const pmChatExecute = createStrandPmChatExecutor(store, {
  gatewayRpcCall: mockGatewayRpcCall,
  logger,
});

const pmResult = await pmChatExecute('call_pm', {
  strandId,
  message: 'Build me a recipe box app with core data model/API and frontend UI components',
});

// Verify PM responded with plan
assert(pmResult.pmResponse, 'PM should have responded');
assert(pmResult.pmResponse.includes('Recipe Box App'), 'PM response should mention Recipe Box App');
log('✅', 'PM responded with plan');

// Verify goals were auto-created from plan
assert(pmResult.goals, 'Goals should have been created from PM plan');
assert(pmResult.goals.length === 2, `Expected 2 goals, got ${pmResult.goals?.length}`);
assert(pmResult.goals[0].title === 'Core data model and API', `Goal 1 title mismatch: ${pmResult.goals[0].title}`);
assert(pmResult.goals[1].title === 'Frontend UI components', `Goal 2 title mismatch: ${pmResult.goals[1].title}`);
log('✅', `PM created ${pmResult.goals.length} goals from plan`);

// Verify the correct RPC sequence was followed
const rpcSequence = rpcCalls.map(c => c.method);
assert(rpcSequence.includes('pm.strandChat'), 'Should have called pm.strandChat');
assert(rpcSequence.includes('chat.send'), 'Should have called chat.send');
assert(rpcSequence.includes('chat.history'), 'Should have called chat.history');
assert(rpcSequence.includes('pm.strandSaveResponse'), 'Should have called pm.strandSaveResponse');
assert(rpcSequence.includes('pm.strandCreateGoals'), 'Should have called pm.strandCreateGoals');
log('✅', `RPC call sequence verified (${rpcCalls.length} calls): ${rpcSequence.join(' → ')}`);

// ─── Step 4: Verify goals and tasks in the store ────────────────────────────

log('🔍', 'Verifying goals and tasks in store...');

const afterPm = store.load();
const goals = afterPm.goals.filter(g => g.strandId === strandId);
assert(goals.length === 2, `Expected 2 goals in store, got ${goals.length}`);

const goal1 = goals.find(g => g.title === 'Core data model and API');
const goal2 = goals.find(g => g.title === 'Frontend UI components');
assert(goal1, 'Goal 1 not found in store');
assert(goal2, 'Goal 2 not found in store');

assert(goal1.tasks.length === 3, `Goal 1 should have 3 tasks, got ${goal1.tasks.length}`);
assert(goal2.tasks.length === 3, `Goal 2 should have 3 tasks, got ${goal2.tasks.length}`);

// Phase dependencies: goal2 depends on goal1
assert(goal2.dependsOn.includes(goal1.id), 'Goal 2 should depend on Goal 1');
assert(goal1.dependsOn.length === 0, 'Goal 1 should have no dependencies');

// Task-level sequential dependencies
assert(goal1.tasks[0].dependsOn.length === 0, 'First task should have no deps');
assert(goal1.tasks[1].dependsOn.includes(goal1.tasks[0].id), 'Task 2 should depend on Task 1');
assert(goal1.tasks[2].dependsOn.includes(goal1.tasks[1].id), 'Task 3 should depend on Task 2');

log('✅', 'Goals, tasks, and dependency chains verified');

// ─── Step 5: Kick off Goal 1 — spawn worker sessions ───────────────────────

log('🚀', `Kicking off Goal 1: "${goal1.title}"...`);

// Build a real internalKickoff using the task spawn handler
const taskSpawnHandler = createTaskSpawnHandler(store);

async function internalKickoff(goalId) {
  const kickoffData = store.load();
  const goal = kickoffData.goals.find(g => g.id === goalId);
  if (!goal) throw new Error(`Goal ${goalId} not found`);

  const doneTasks = new Set(
    goal.tasks.filter(t => t.status === 'done' || t.done).map(t => t.id)
  );

  const tasksToSpawn = goal.tasks.filter(t => {
    if (t.sessionKey || t.status === 'done') return false;
    if (Array.isArray(t.dependsOn) && t.dependsOn.length > 0) {
      return t.dependsOn.every(depId => doneTasks.has(depId));
    }
    return true;
  });

  const spawnedSessions = [];
  for (const task of tasksToSpawn) {
    const result = await new Promise((resolve, reject) => {
      taskSpawnHandler({
        params: { goalId, taskId: task.id, agentId: 'main' },
        respond: (ok, payload, error) => {
          if (ok) resolve(payload);
          else reject(new Error(error?.message || error || 'Spawn failed'));
        },
      });
    });
    spawnedSessions.push({
      taskId: task.id,
      taskText: task.text,
      sessionKey: result.sessionKey,
      agentId: result.agentId,
      taskContext: result.taskContext,
    });
  }

  return { goalId, spawnedSessions };
}

// Track startSpawnedSessions calls
const startedSessions = [];

async function mockStartSpawnedSessions(sessions) {
  startedSessions.push(...sessions);
}

const broadcastEvents = [];

function mockBroadcast(payload) {
  broadcastEvents.push(payload);
}

const pmKickoffExecute = createStrandPmKickoffExecutor(store, {
  gatewayRpcCall: mockGatewayRpcCall,
  internalKickoff,
  startSpawnedSessions: mockStartSpawnedSessions,
  broadcastPlanUpdate: mockBroadcast,
  logger,
});

// First kickoff — only task 1 is unblocked (tasks are sequential)
const kickoff1 = await pmKickoffExecute('kick_g1_t1', {
  strandId,
  goalId: goal1.id,
});

assert(kickoff1.spawnedCount === 1, `Expected 1 spawned session, got ${kickoff1.spawnedCount}`);
assert(kickoff1.content[0].text.includes('spawned 1 worker'), `Unexpected kickoff message: ${kickoff1.content[0].text}`);

const firstSession = startedSessions[startedSessions.length - 1];
assert(firstSession.sessionKey.startsWith('agent:main:webchat:task-'), `Bad session key: ${firstSession.sessionKey}`);
assert(firstSession.taskContext.includes('Your Assignment'), 'Task context should contain assignment');
assert(firstSession.taskContext.includes('goal_update'), 'Task context should mention goal_update');
log('✅', `  Task 1 spawned: "${firstSession.taskText}" → ${firstSession.sessionKey}`);

// Verify worker context contains PM plan reference
assert(firstSession.taskContext.includes('PM Plan'), 'Worker context should include PM plan');
log('✅', '  Worker context includes PM plan for reference');

// ─── Step 6: Simulate workers completing tasks sequentially ─────────────────

/**
 * Simulate a worker completing a task (what goal_update tool does).
 * Then kick off the next task if any are unblocked.
 */
async function completeTaskAndKickNext(goalId, taskIndex, summary) {
  const d = store.load();
  const g = d.goals.find(x => x.id === goalId);
  assert(g, `Goal ${goalId} not found for completion`);
  assert(g.tasks[taskIndex], `Task index ${taskIndex} out of range`);

  const task = g.tasks[taskIndex];
  assert(task.status === 'in-progress', `Task "${task.text}" should be in-progress, is ${task.status}`);
  assert(task.sessionKey, `Task "${task.text}" should have a session assigned`);

  task.status = 'done';
  task.done = true;
  task.summary = summary;
  task.updatedAtMs = Date.now();
  store.save(d);

  log('✅', `  Completed: "${task.text}"`);

  // Check if all tasks in the goal are done
  const refreshed = store.load();
  const refreshedGoal = refreshed.goals.find(x => x.id === goalId);
  const allDone = refreshedGoal.tasks.every(t => t.status === 'done');

  if (allDone) {
    refreshedGoal.status = 'done';
    refreshedGoal.completed = true;
    refreshedGoal.updatedAtMs = Date.now();
    store.save(refreshed);
    log('🎯', `  Goal "${refreshedGoal.title}" completed!`);
    return { goalDone: true };
  }

  // Kick off next unblocked task
  const nextKickoff = await pmKickoffExecute(`kick_${goalId}_${taskIndex + 1}`, {
    strandId,
    goalId,
  });

  if (nextKickoff.spawnedCount > 0) {
    const nextSession = startedSessions[startedSessions.length - 1];
    log('✅', `  Next task spawned: "${nextSession.taskText}" → ${nextSession.sessionKey}`);
  }

  return { goalDone: false, spawnedCount: nextKickoff.spawnedCount };
}

log('💻', 'Simulating Goal 1 worker execution...');

// Task 1: Data model
let result = await completeTaskAndKickNext(goal1.id, 0,
  'Created lib/recipes.js with validateRecipe, getAllRecipes, getRecipeById, createRecipe, updateRecipe, deleteRecipe');
assert(!result.goalDone, 'Goal should not be done after task 1');
assert(result.spawnedCount === 1, 'Should spawn task 2');

// Task 2: API endpoints
result = await completeTaskAndKickNext(goal1.id, 1,
  'Built server.js with GET/POST/PUT/DELETE /api/recipes endpoints and static file serving');
assert(!result.goalDone, 'Goal should not be done after task 2');
assert(result.spawnedCount === 1, 'Should spawn task 3');

// Task 3: Seed data
result = await completeTaskAndKickNext(goal1.id, 2,
  'Added 3 sample recipes: Margherita Pizza, Thai Green Curry, Chocolate Lava Cake');
assert(result.goalDone, 'Goal 1 should be done after task 3');

// ─── Step 7: Kick off Goal 2 (phase 2, now unblocked) ──────────────────────

log('🚀', `Kicking off Goal 2: "${goal2.title}"...`);

const kickoff2 = await pmKickoffExecute('kick_g2_t1', {
  strandId,
  goalId: goal2.id,
});

assert(kickoff2.spawnedCount === 1, `Expected 1 spawned session for goal 2, got ${kickoff2.spawnedCount}`);
log('✅', `  Goal 2 first task spawned`);

log('💻', 'Simulating Goal 2 worker execution...');

// Task 1: HTML page
result = await completeTaskAndKickNext(goal2.id, 0,
  'Created public/index.html with recipe grid, detail modal, and add/edit form');
assert(!result.goalDone, 'Goal 2 not done after task 1');
assert(result.spawnedCount === 1, 'Should spawn task 2');

// Task 2: CSS styling
result = await completeTaskAndKickNext(goal2.id, 1,
  'Added public/styles.css with dark theme, responsive grid, glassmorphism cards');
assert(!result.goalDone, 'Goal 2 not done after task 2');
assert(result.spawnedCount === 1, 'Should spawn task 3');

// Task 3: JavaScript app
result = await completeTaskAndKickNext(goal2.id, 2,
  'Implemented public/app.js with loadRecipes, renderRecipes, search, CRUD handlers');
assert(result.goalDone, 'Goal 2 should be done after task 3');

// ─── Step 8: Final verification — full pipeline complete ────────────────────

log('🔍', 'Running final verification...');

const finalData = store.load();
const allGoals = finalData.goals.filter(g => g.strandId === strandId);
const allTasks = allGoals.flatMap(g => g.tasks);

// All goals done
assert(allGoals.length === 2, `Expected 2 goals, got ${allGoals.length}`);
assert(allGoals.every(g => g.status === 'done'), 'All goals should be done');
assert(allGoals.every(g => g.completed), 'All goals should be marked completed');

// All tasks done (6 total: 3 per goal)
assert(allTasks.length === 6, `Expected 6 tasks, got ${allTasks.length}`);
assert(allTasks.every(t => t.status === 'done'), 'All tasks should be done');
assert(allTasks.every(t => t.done === true), 'All tasks should have done=true');

// Every task got a worker session
assert(allTasks.every(t => t.sessionKey != null), 'Every task should have a session key');
assert(
  allTasks.every(t => t.sessionKey.startsWith('agent:main:webchat:task-')),
  'All session keys should follow agent:main:webchat:task-* pattern'
);

// Every task has a completion summary
assert(allTasks.every(t => t.summary && t.summary.length > 0), 'Every task should have a summary');

// All session keys are unique
const sessionKeys = allTasks.map(t => t.sessionKey);
const uniqueKeys = new Set(sessionKeys);
assert(uniqueKeys.size === sessionKeys.length, 'All session keys should be unique');

// Strand still exists
const strand = finalData.strands.find(c => c.id === strandId);
assert(strand, 'Strand should still exist');
assert(strand.name === 'Recipe Box', 'Strand name should be Recipe Box');

// Broadcast events were fired
const kickoffEvents = broadcastEvents.filter(e => e.event === 'goal.kickoff');
assert(kickoffEvents.length >= 2, `Expected at least 2 kickoff broadcasts, got ${kickoffEvents.length}`);

log('✅', 'All verifications passed');

// ─── Summary ────────────────────────────────────────────────────────────────

log('', '');
log('🎉', '═══════════════════════════════════════════════════════');
log('🎉', '  E2E TEST PASSED — Recipe Box PM pipeline complete!');
log('🎉', '═══════════════════════════════════════════════════════');
log('', '');
log('📬', `PM message: "Build me a recipe box app with core data model/API and frontend UI components"`);
log('📦', `Strand: ${strand.name} (${strandId})`);
log('🎯', `Goals completed: ${allGoals.length}`);
log('📋', `Tasks completed: ${allTasks.length}`);
log('🤖', `Worker sessions: ${uniqueKeys.size}`);
log('📡', `Gateway RPC calls: ${rpcCalls.length}`);
log('📢', `Broadcast events: ${broadcastEvents.length}`);
log('', '');
log('📬', 'RPC call sequence:');
for (const call of rpcCalls) {
  log('  ', `  ${call.method}(${JSON.stringify(call.params).slice(0, 80)}...)`);
}
log('', '');
log('📌', `Test store (temp): ${DATA_DIR}`);

// Cleanup
rmSync(DATA_DIR, { recursive: true, force: true });
log('🧹', 'Cleaned up temp data');
log('', '');
