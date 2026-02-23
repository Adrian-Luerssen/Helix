/**
 * Tests for PM handlers - specifically the chat history functionality
 */
import { test, describe, beforeEach, afterEach } from 'node:test';
import { strict as assert } from 'assert';
import { createGoalsStore } from '../lib/goals-store.js';
import { createPmHandlers } from '../lib/pm-handlers.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Test context shared across tests
let tempDir;
let store;
let handlers;

// Helper to create a respond function that captures the result
function createResponder() {
  let result = null;
  const respond = (success, data, error) => {
    result = { success, data, error };
  };
  return { respond, getResult: () => result };
}

// Setup: create a strand and goal
function setupStrandAndGoal(strandId = 'test-strand', goalId = 'test-goal') {
  const data = store.load();
  data.strands.push({
    id: strandId,
    name: 'Test Strand',
    createdAtMs: Date.now(),
  });
  data.goals.push({
    id: goalId,
    title: 'Test Goal',
    strandId,
    tasks: [],
    createdAtMs: Date.now(),
  });
  data.config = { pmSession: 'agent:test:main' };
  store.save(data);
  return { strandId, goalId };
}

describe('PM Handlers - Chat History', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pm-handlers-test-'));
    store = createGoalsStore(tempDir);
    
    // Mock sendToSession that returns a canned response
    const mockSendToSession = async (session, payload) => {
      return { text: `Mock response to: ${payload.message.slice(-50)}` };
    };
    
    handlers = createPmHandlers(store, { 
      sendToSession: mockSendToSession,
      logger: { info: () => {}, error: () => {} }
    });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test('pm.getHistory returns empty array for new goal', async () => {
    const { goalId } = setupStrandAndGoal();
    const { respond, getResult } = createResponder();
    
    await handlers['pm.getHistory']({ params: { goalId }, respond });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert.deepEqual(result.data.messages, [], 'Should return empty array');
    assert.equal(result.data.total, 0, 'Total should be 0');
  });

  test('pm.chat saves user message and returns enriched message', async () => {
    const { strandId, goalId } = setupStrandAndGoal();
    const { respond, getResult } = createResponder();

    // Send a chat message
    await handlers['pm.chat']({
      params: { strandId, goalId, message: 'Hello PM!' },
      respond
    });

    const chatResult = getResult();
    assert(chatResult.success, 'Chat should succeed');
    assert(chatResult.data.enrichedMessage, 'Should return enriched message');
    assert(chatResult.data.enrichedMessage.includes('Hello PM!'), 'Enriched message should contain user message');
    assert(chatResult.data.pmSession, 'Should return PM session key');
    assert(chatResult.data.history, 'Should return history');
    assert.equal(chatResult.data.history.length, 1, 'Should have user message in history');

    // Check history via getHistory
    const { respond: respond2, getResult: getResult2 } = createResponder();
    await handlers['pm.getHistory']({ params: { goalId }, respond: respond2 });

    const historyResult = getResult2();
    assert(historyResult.success, 'getHistory should succeed');
    assert.equal(historyResult.data.messages.length, 1, 'Should have 1 message (user only)');
    assert.equal(historyResult.data.messages[0].role, 'user', 'Should be user message');
    assert.equal(historyResult.data.messages[0].content, 'Hello PM!', 'Content should match');
  });

  test('pm.clearHistory clears all messages', async () => {
    const { strandId, goalId } = setupStrandAndGoal();

    // Add some messages via pm.chat (saves user msg) + pm.saveResponse (saves assistant msg)
    const { respond: r1 } = createResponder();
    await handlers['pm.chat']({ params: { strandId, goalId, message: 'Message 1' }, respond: r1 });
    const { respond: r1b } = createResponder();
    await handlers['pm.saveResponse']({ params: { goalId, content: 'Response 1' }, respond: r1b });

    const { respond: r2 } = createResponder();
    await handlers['pm.chat']({ params: { strandId, goalId, message: 'Message 2' }, respond: r2 });
    const { respond: r2b } = createResponder();
    await handlers['pm.saveResponse']({ params: { goalId, content: 'Response 2' }, respond: r2b });

    // Verify we have messages
    const { respond: r3, getResult: gr3 } = createResponder();
    await handlers['pm.getHistory']({ params: { goalId }, respond: r3 });
    assert.equal(gr3().data.total, 4, 'Should have 4 messages (2 user + 2 assistant)');

    // Clear history
    const { respond: r4, getResult: gr4 } = createResponder();
    await handlers['pm.clearHistory']({ params: { goalId }, respond: r4 });

    const clearResult = gr4();
    assert(clearResult.success, 'Clear should succeed');
    assert.equal(clearResult.data.cleared, 4, 'Should report 4 cleared');

    // Verify empty
    const { respond: r5, getResult: gr5 } = createResponder();
    await handlers['pm.getHistory']({ params: { goalId }, respond: r5 });
    assert.equal(gr5().data.total, 0, 'Should be empty after clear');
  });

  test('pm.getHistory respects limit parameter', async () => {
    const { strandId, goalId } = setupStrandAndGoal();

    // Add messages (pm.chat saves user, pm.saveResponse saves assistant)
    const { respond: r1 } = createResponder();
    await handlers['pm.chat']({ params: { strandId, goalId, message: 'Msg 1' }, respond: r1 });
    const { respond: r1b } = createResponder();
    await handlers['pm.saveResponse']({ params: { goalId, content: 'Reply 1' }, respond: r1b });
    const { respond: r2 } = createResponder();
    await handlers['pm.chat']({ params: { strandId, goalId, message: 'Msg 2' }, respond: r2 });
    const { respond: r2b } = createResponder();
    await handlers['pm.saveResponse']({ params: { goalId, content: 'Reply 2' }, respond: r2b });
    const { respond: r3 } = createResponder();
    await handlers['pm.chat']({ params: { strandId, goalId, message: 'Msg 3' }, respond: r3 });
    const { respond: r3b } = createResponder();
    await handlers['pm.saveResponse']({ params: { goalId, content: 'Reply 3' }, respond: r3b });

    // Get with limit=2
    const { respond: r4, getResult: gr4 } = createResponder();
    await handlers['pm.getHistory']({ params: { goalId, limit: 2 }, respond: r4 });

    const result = gr4();
    assert.equal(result.data.messages.length, 2, 'Should return only 2 messages');
    assert.equal(result.data.total, 6, 'Total should still be 6');
  });

  test('pm.getHistory fails without goalId', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.getHistory']({ params: {}, respond: r1 });
    assert(!gr1().success, 'Should fail without goalId');
    assert(gr1().error.includes('goalId'), 'Error should mention goalId');
  });

  test('pm.clearHistory fails without goalId', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.clearHistory']({ params: {}, respond: r1 });
    assert(!gr1().success, 'Should fail without goalId');
  });

  test('pm.getHistory fails for nonexistent goal', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.getHistory']({ params: { goalId: 'nonexistent' }, respond: r1 });
    assert(!gr1().success, 'Should fail for nonexistent goal');
    assert(gr1().error.includes('not found'), 'Error should mention not found');
  });

  test('pm.clearHistory fails for nonexistent goal', async () => {
    const { respond: r1, getResult: gr1 } = createResponder();
    await handlers['pm.clearHistory']({ params: { goalId: 'nonexistent' }, respond: r1 });
    assert(!gr1().success, 'Should fail for nonexistent goal');
  });

  test('pm.saveResponse saves assistant message and detects plan', async () => {
    const { goalId } = setupStrandAndGoal('plan-test-strand', 'plan-test-goal');
    const { respond, getResult } = createResponder();

    await handlers['pm.saveResponse']({
      params: {
        goalId,
        content: `## Plan\n\n| Task | Agent |\n|------|-------|\n| Create form | Félix |\n\nAwaiting approval`
      },
      respond
    });

    const result = getResult();
    assert(result.success, 'saveResponse should succeed');
    assert(result.data.hasPlan === true, 'Should detect plan in response');

    // Verify history has the message
    const { respond: r2, getResult: gr2 } = createResponder();
    await handlers['pm.getHistory']({ params: { goalId }, respond: r2 });
    assert.equal(gr2().data.messages.length, 1, 'Should have 1 message');
    assert.equal(gr2().data.messages[0].role, 'assistant', 'Should be assistant message');
  });

  test('pm.saveResponse does not detect plan in regular response', async () => {
    const { goalId } = setupStrandAndGoal('no-plan-strand', 'no-plan-goal');
    const { respond, getResult } = createResponder();

    await handlers['pm.saveResponse']({
      params: { goalId, content: 'Just a regular reply, no plan here.' },
      respond
    });

    const result = getResult();
    assert(result.success, 'saveResponse should succeed');
    assert(result.data.hasPlan === false, 'Should not detect plan in regular response');
  });
});

describe('PM Handlers - createTasksFromPlan', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pm-handlers-test-'));
    store = createGoalsStore(tempDir);
    
    const mockSendToSession = async (session, payload) => {
      return { text: `Mock response` };
    };
    
    handlers = createPmHandlers(store, { 
      sendToSession: mockSendToSession,
      logger: { info: () => {}, error: () => {} }
    });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true });
    }
  });

  // Helper to create a goal
  function setupGoal(strandId = 'test-strand') {
    const data = store.load();
    data.strands.push({
      id: strandId,
      name: 'Test Strand',
      createdAtMs: Date.now(),
    });
    const goalId = store.newId('goal');
    data.goals.push({
      id: goalId,
      title: 'Test Goal',
      strandId,
      tasks: [],
      createdAtMs: Date.now(),
    });
    store.save(data);
    return { strandId, goalId };
  }

  test('creates tasks from provided planContent', async () => {
    const { goalId } = setupGoal();
    const planContent = `
## Plan

| Task | Agent | Time |
|------|-------|------|
| Create login page | Félix 🎨 | 2h |
| Add auth endpoint | Blake 🔧 | 1h |
`;
    
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: { goalId, planContent },
      respond
    });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert.equal(result.data.tasksCreated, 2, 'Should create 2 tasks');
    assert.equal(result.data.tasks[0].text, 'Create login page');
    assert.equal(result.data.tasks[0].assignedAgent, 'frontend');
    assert.equal(result.data.tasks[1].text, 'Add auth endpoint');
    assert.equal(result.data.tasks[1].assignedAgent, 'backend');
    
    // Verify tasks are in store
    const data = store.load();
    const goal = data.goals.find(g => g.id === goalId);
    assert.equal(goal.tasks.length, 2, 'Goal should have 2 tasks');
  });

  test('uses goal.plan.content when planContent not provided', async () => {
    const data = store.load();
    data.strands.push({
      id: 'plan-strand',
      name: 'Plan Strand',
      createdAtMs: Date.now(),
    });
    const goalId = store.newId('goal');
    data.goals.push({
      id: goalId,
      title: 'Goal with Plan',
      strandId: 'plan-strand',
      tasks: [],
      plan: {
        status: 'awaiting_approval',
        content: `| Task | Agent |\n|------|-------|\n| Test task | Quinn |`,
      },
      createdAtMs: Date.now(),
    });
    store.save(data);
    
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: { goalId },
      respond
    });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert.equal(result.data.tasksCreated, 1, 'Should create 1 task');
    assert.equal(result.data.tasks[0].text, 'Test task');
    assert.equal(result.data.tasks[0].assignedAgent, 'tester');
    
    // Verify plan status updated to approved
    const afterData = store.load();
    const goal = afterData.goals.find(g => g.id === goalId);
    assert.equal(goal.plan.status, 'approved', 'Plan should be approved');
  });

  test('uses PM chat history when no plan content', async () => {
    const data = store.load();
    const strandId = 'chat-history-strand';
    data.strands.push({
      id: strandId,
      name: 'Chat History Strand',
      createdAtMs: Date.now(),
    });
    const goalId = store.newId('goal');
    data.goals.push({
      id: goalId,
      title: 'Goal from Chat',
      strandId,
      tasks: [],
      // PM chat history is now on the goal
      pmChatHistory: [
        { role: 'user', content: 'Create a plan' },
        { role: 'assistant', content: '## Plan\n\n| Task | Agent |\n|------|-------|\n| Deploy app | Devon |' },
      ],
      createdAtMs: Date.now(),
    });
    store.save(data);
    
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: { goalId },
      respond
    });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert.equal(result.data.tasksCreated, 1, 'Should create 1 task');
    assert.equal(result.data.tasks[0].text, 'Deploy app');
    assert.equal(result.data.tasks[0].assignedAgent, 'devops');
  });

  test('fails when goalId not provided', async () => {
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: {},
      respond
    });
    
    const result = getResult();
    assert(!result.success, 'Should fail');
    assert(result.error.includes('goalId'), 'Error should mention goalId');
  });

  test('fails when goal not found', async () => {
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: { goalId: 'nonexistent' },
      respond
    });
    
    const result = getResult();
    assert(!result.success, 'Should fail');
    assert(result.error.includes('not found'), 'Error should mention not found');
  });

  test('fails when no plan content available', async () => {
    const { goalId } = setupGoal();
    
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: { goalId },
      respond
    });
    
    const result = getResult();
    assert(!result.success, 'Should fail when no content available');
  });

  test('fails when content has no detectable plan', async () => {
    const { goalId } = setupGoal();
    
    const { respond, getResult } = createResponder();
    await handlers['pm.createTasksFromPlan']({
      params: { goalId, planContent: 'Just regular text, no plan here' },
      respond
    });
    
    const result = getResult();
    assert(!result.success, 'Should fail when no plan detected');
  });
});

describe('PM Handlers - detectPlan RPC', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pm-handlers-test-'));
    store = createGoalsStore(tempDir);
    handlers = createPmHandlers(store, { 
      logger: { info: () => {}, error: () => {} }
    });
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true });
    }
  });

  test('detects plan in content', async () => {
    const { respond, getResult } = createResponder();
    await handlers['pm.detectPlan']({
      params: { content: '## Plan\n\n| Task | Agent |\n|------|-------|\n| Build UI | Félix |' },
      respond
    });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert(result.data.hasPlan === true, 'Should detect plan');
    assert.equal(result.data.taskCount, 1, 'Should find 1 task');
  });

  test('returns false for non-plan content', async () => {
    const { respond, getResult } = createResponder();
    await handlers['pm.detectPlan']({
      params: { content: 'Just a regular message' },
      respond
    });
    
    const result = getResult();
    assert(result.success, 'Should succeed');
    assert(result.data.hasPlan === false, 'Should not detect plan');
    assert.equal(result.data.taskCount, 0, 'Should find 0 tasks');
  });

  test('fails without content', async () => {
    const { respond, getResult } = createResponder();
    await handlers['pm.detectPlan']({
      params: {},
      respond
    });
    
    const result = getResult();
    assert(!result.success, 'Should fail');
    assert(result.error.includes('content'), 'Error should mention content');
  });
});
