import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../plugins/helix-goals/lib/goals-store.js';
import {
  createStrandBindExecutor,
  createStrandCreateGoalExecutor,
  createStrandAddTaskExecutor,
  createStrandSpawnTaskExecutor,
  createStrandListExecutor,
  createStrandStatusExecutor,
  createStrandPmChatExecutor,
  createStrandPmKickoffExecutor,
} from '../plugins/helix-goals/lib/strand-tools.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'strand-tools-test');

describe('strand_bind tool', () => {
  let store, execute;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    execute = createStrandBindExecutor(store);

    // Seed a strand
    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Website Redesign', description: 'Redesign project',
      color: null, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    store.save(data);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('binds session to existing strand by strandId', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      strandId: 'strand_1',
    });
    expect(result.content[0].text).toContain('Website Redesign');

    const data = store.load();
    expect(data.sessionStrandIndex['agent:main:telegram:123']).toBe('strand_1');
  });

  it('creates new strand and binds when name is provided', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:456',
      name: 'New Project',
      description: 'A new project',
    });
    expect(result.content[0].text).toContain('New Project');

    const data = store.load();
    const strandId = data.sessionStrandIndex['agent:main:telegram:456'];
    expect(strandId).toBeTruthy();
    const strand = data.strands.find(c => c.id === strandId);
    expect(strand.name).toBe('New Project');
    expect(strand.description).toBe('A new project');
  });

  it('passes repoUrl to workspace manager when creating new strand', async () => {
    const wsOps = {
      dir: '/tmp/workspaces',
      createStrandWorkspace: vi.fn(() => ({ ok: true, path: '/tmp/workspaces/new-proj-abc' })),
    };
    const execWithWs = createStrandBindExecutor(store, wsOps);

    const result = await execWithWs('call1', {
      sessionKey: 'agent:main:telegram:789',
      name: 'Repo Project',
      description: 'With a repo',
      repoUrl: 'https://github.com/org/repo.git',
    });
    expect(result.content[0].text).toContain('Repo Project');

    // Verify wsOps was called with repoUrl
    expect(wsOps.createStrandWorkspace).toHaveBeenCalledWith(
      '/tmp/workspaces',
      expect.any(String),
      'Repo Project',
      'https://github.com/org/repo.git'
    );

    // Verify workspace.repoUrl is set on the strand
    const data = store.load();
    const strandId = data.sessionStrandIndex['agent:main:telegram:789'];
    const strand = data.strands.find(c => c.id === strandId);
    expect(strand.workspace).toBeTruthy();
    expect(strand.workspace.repoUrl).toBe('https://github.com/org/repo.git');
    expect(strand.workspace.path).toBe('/tmp/workspaces/new-proj-abc');
  });

  it('returns error for nonexistent strandId', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      strandId: 'strand_nonexistent',
    });
    expect(result.content[0].text).toContain('not found');
  });

  it('returns error when neither strandId nor name provided', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
    });
    expect(result.content[0].text).toContain('Error');
  });
});

describe('strand_create_goal tool', () => {
  let store, execute;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    execute = createStrandCreateGoalExecutor(store);

    // Seed a strand and bind a session
    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Project', description: '',
      color: null, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.sessionStrandIndex['agent:main:telegram:123'] = 'strand_1';
    store.save(data);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('creates a goal in the bound strand', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      title: 'Ship Landing Page',
    });
    expect(result.content[0].text).toContain('Ship Landing Page');
    expect(result.content[0].text).toContain('strand_1');

    const data = store.load();
    expect(data.goals).toHaveLength(1);
    expect(data.goals[0].strandId).toBe('strand_1');
    expect(data.goals[0].title).toBe('Ship Landing Page');
  });

  it('creates goal with initial tasks (string array)', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      title: 'Ship It',
      tasks: ['Design mockups', 'Write code', 'Deploy'],
    });
    expect(result.content[0].text).toContain('3 tasks');

    const data = store.load();
    expect(data.goals[0].tasks).toHaveLength(3);
    expect(data.goals[0].tasks[0].text).toBe('Design mockups');
    expect(data.goals[0].tasks[1].text).toBe('Write code');
  });

  it('creates goal with initial tasks (object array)', async () => {
    await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      title: 'Ship It',
      tasks: [{ text: 'Design', description: 'Create mockups', priority: 'P0' }],
    });

    const data = store.load();
    expect(data.goals[0].tasks[0].text).toBe('Design');
    expect(data.goals[0].tasks[0].description).toBe('Create mockups');
    expect(data.goals[0].tasks[0].priority).toBe('P0');
  });

  it('skips invalid tasks in array', async () => {
    await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      title: 'Ship It',
      tasks: ['Valid task', '', null, { text: '  ' }],
    });

    const data = store.load();
    expect(data.goals[0].tasks).toHaveLength(1);
    expect(data.goals[0].tasks[0].text).toBe('Valid task');
  });

  it('returns error for missing title', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
    });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error for unbound session', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:unbound:main',
      title: 'Orphan Goal',
    });
    expect(result.content[0].text).toContain('not bound');
  });
});

describe('strand_add_task tool', () => {
  let store, execute;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    execute = createStrandAddTaskExecutor(store);

    // Seed a strand, goal, and binding
    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Project', description: '',
      color: null, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.goals.push({
      id: 'goal_1', title: 'Ship It', description: '', status: 'active',
      completed: false, strandId: 'strand_1', priority: null, deadline: null,
      tasks: [], sessions: [], createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.sessionStrandIndex['agent:main:telegram:123'] = 'strand_1';
    store.save(data);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('adds a task to a goal in the bound strand', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_1',
      text: 'Design mockups',
    });
    expect(result.content[0].text).toContain('Design mockups');

    const data = store.load();
    expect(data.goals[0].tasks).toHaveLength(1);
    expect(data.goals[0].tasks[0].text).toBe('Design mockups');
    expect(data.goals[0].tasks[0].status).toBe('pending');
  });

  it('returns error for missing goalId', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      text: 'Orphan task',
    });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error for missing text', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_1',
    });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error when goal does not belong to the bound strand', async () => {
    // Add a goal in a different strand
    const data = store.load();
    data.goals.push({
      id: 'goal_other', title: 'Other', description: '', status: 'active',
      completed: false, strandId: 'strand_other', priority: null, deadline: null,
      tasks: [], sessions: [], createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    store.save(data);

    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_other',
      text: 'Cross-strand task',
    });
    expect(result.content[0].text).toContain('does not belong');
  });

  it('returns error for unbound session', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:unbound:main',
      goalId: 'goal_1',
      text: 'Task',
    });
    expect(result.content[0].text).toContain('not bound');
  });
});

describe('strand_spawn_task tool', () => {
  let store, execute;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    execute = createStrandSpawnTaskExecutor(store);

    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Project', description: '',
      color: null, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.goals.push({
      id: 'goal_1', title: 'Ship It', description: '', status: 'active',
      completed: false, strandId: 'strand_1', priority: null, deadline: null,
      tasks: [
        { id: 'task_1', text: 'Build API', description: '', status: 'pending', done: false, priority: null, sessionKey: null, dependsOn: [], summary: '', createdAtMs: Date.now(), updatedAtMs: Date.now() },
        { id: 'task_2', text: 'Deploy', description: '', status: 'pending', done: false, priority: null, sessionKey: 'agent:existing:sub', dependsOn: [], summary: '', createdAtMs: Date.now(), updatedAtMs: Date.now() },
      ],
      sessions: [], createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.sessionStrandIndex['agent:main:telegram:123'] = 'strand_1';
    store.save(data);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('spawns a task worker session', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_1',
      taskId: 'task_1',
    });
    expect(result.content[0].text).toContain('Task session');
    expect(result.content[0].text).toContain('Build API');
    expect(result.spawnRequest).toBeTruthy();
    expect(result.spawnRequest.goalId).toBe('goal_1');
    expect(result.spawnRequest.taskId).toBe('task_1');

    const data = store.load();
    const task = data.goals[0].tasks.find(t => t.id === 'task_1');
    expect(task.sessionKey).toBeTruthy();
    expect(task.status).toBe('in-progress');
    expect(data.sessionIndex[task.sessionKey]).toEqual({ goalId: 'goal_1' });
  });

  it('returns error when task already has a session', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_1',
      taskId: 'task_2',
    });
    expect(result.content[0].text).toContain('already has a session');
  });

  it('returns error for missing goalId', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      taskId: 'task_1',
    });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error for nonexistent task', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_1',
      taskId: 'task_nonexistent',
    });
    expect(result.content[0].text).toContain('not found');
  });

  it('returns error when goal does not belong to the bound strand', async () => {
    const data = store.load();
    data.goals.push({
      id: 'goal_other', title: 'Other', description: '', status: 'active',
      completed: false, strandId: 'strand_other', priority: null, deadline: null,
      tasks: [{ id: 'task_x', text: 'X', description: '', status: 'pending', done: false, priority: null, sessionKey: null, dependsOn: [], summary: '', createdAtMs: Date.now(), updatedAtMs: Date.now() }],
      sessions: [], createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    store.save(data);

    const result = await execute('call1', {
      sessionKey: 'agent:main:telegram:123',
      goalId: 'goal_other',
      taskId: 'task_x',
    });
    expect(result.content[0].text).toContain('does not belong');
  });

  it('returns error for unbound session', async () => {
    const result = await execute('call1', {
      sessionKey: 'agent:unbound:main',
      goalId: 'goal_1',
      taskId: 'task_1',
    });
    expect(result.content[0].text).toContain('not bound');
  });
});

describe('strand_list tool', () => {
  let store, execute;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    execute = createStrandListExecutor(store);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns strands with goal counts', async () => {
    const data = store.load();
    data.strands.push(
      { id: 'strand_1', name: 'Alpha', description: 'First project', color: null, createdAtMs: Date.now(), updatedAtMs: Date.now() },
      { id: 'strand_2', name: 'Beta', description: '', color: null, createdAtMs: Date.now(), updatedAtMs: Date.now() },
    );
    data.goals.push(
      { id: 'goal_1', title: 'G1', strandId: 'strand_1', status: 'active', tasks: [] },
      { id: 'goal_2', title: 'G2', strandId: 'strand_1', status: 'done', tasks: [] },
      { id: 'goal_3', title: 'G3', strandId: 'strand_2', status: 'active', tasks: [] },
    );
    store.save(data);

    const result = await execute('call1', {});
    const text = result.content[0].text;

    expect(text).toContain('2 strand(s)');
    expect(text).toContain('Alpha');
    expect(text).toContain('strand_1');
    expect(text).toContain('First project');
    expect(text).toContain('Beta');
    expect(text).toContain('Goals: 2 total, 1 active');  // Alpha: 2 total, 1 active
    expect(text).toContain('Goals: 1 total, 1 active');  // Beta: 1 total, 1 active
  });

  it('returns empty message when no strands', async () => {
    const result = await execute('call1', {});
    expect(result.content[0].text).toContain('No strands found');
  });
});

describe('strand_status tool', () => {
  let store, execute;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    execute = createStrandStatusExecutor(store);

    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Website', description: 'Marketing site',
      color: null, workspace: { path: '/ws/website' }, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.goals.push({
      id: 'goal_1', title: 'Landing Page', description: 'Build it', status: 'active',
      strandId: 'strand_1', tasks: [
        { id: 'task_1', text: 'Design', done: true, status: 'done', summary: 'Completed 3 variants', sessionKey: null },
        { id: 'task_2', text: 'Implement', done: false, status: 'in-progress', sessionKey: 'agent:main:s1' },
        { id: 'task_3', text: 'Test', done: false, status: 'pending', sessionKey: null },
      ],
    });
    data.goals.push({
      id: 'goal_2', title: 'SEO', description: '', status: 'done',
      strandId: 'strand_1', tasks: [
        { id: 'task_4', text: 'Keywords', done: true, status: 'done', summary: 'Done', sessionKey: null },
      ],
    });
    store.save(data);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('returns strand info with goals and tasks', async () => {
    const result = await execute('call1', { strandId: 'strand_1' });
    const text = result.content[0].text;

    expect(text).toContain('Website');
    expect(text).toContain('Marketing site');
    expect(text).toContain('/ws/website');
    expect(text).toContain('1 active, 1 done');
    expect(text).toContain('Landing Page');
    expect(text).toContain('[done] Design [task_1]');
    expect(text).toContain('Completed 3 variants');
    expect(text).toContain('[in-progress] Implement [task_2]');
    expect(text).toContain('(session: agent:main:s1)');
    expect(text).toContain('[pending] Test [task_3]');
    expect(text).toContain('unassigned');
    expect(text).toContain('Tasks (1/3 done)');
    expect(text).toContain('SEO');
  });

  it('returns error for unknown strandId', async () => {
    const result = await execute('call1', { strandId: 'strand_nope' });
    expect(result.content[0].text).toContain('not found');
  });

  it('returns error for missing strandId', async () => {
    const result = await execute('call1', {});
    expect(result.content[0].text).toContain('Error');
  });
});

describe('strand_pm_chat tool', () => {
  let store, execute, mockRpcCall;
  const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);

    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Project', description: '',
      color: null, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    store.save(data);

    mockRpcCall = vi.fn();
    execute = createStrandPmChatExecutor(store, { gatewayRpcCall: mockRpcCall, logger: mockLogger });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('sends message to PM and returns response', async () => {
    // pm.strandChat returns session key and enriched message
    mockRpcCall.mockImplementation(async (method, params) => {
      if (method === 'pm.strandChat') {
        return { sessionKey: 'agent:main:webchat:pm-abc', enrichedMessage: 'Enriched: Build a page' };
      }
      if (method === 'chat.history') {
        // First call: baseline (empty)
        // Second call: PM responded
        const callCount = mockRpcCall.mock.calls.filter(c => c[0] === 'chat.history').length;
        if (callCount <= 1) return { messages: [] };
        return { messages: [
          { role: 'user', content: 'Enriched: Build a page' },
          { role: 'assistant', content: 'I will create a landing page goal with 3 tasks.' },
        ]};
      }
      if (method === 'chat.send') return {};
      if (method === 'pm.strandSaveResponse') return {};
      if (method === 'pm.strandCreateGoals') {
        return { goals: [{ id: 'goal_new', title: 'Landing Page', tasks: [{ id: 't1' }, { id: 't2' }] }] };
      }
      return {};
    });

    const result = await execute('call1', { strandId: 'strand_1', message: 'Build a landing page' });
    const text = result.content[0].text;

    expect(text).toContain('PM Response');
    expect(text).toContain('landing page goal with 3 tasks');
    expect(text).toContain('1 goal(s) created');
    expect(text).toContain('Landing Page');
    expect(result.pmResponse).toBeTruthy();
    expect(result.goals).toHaveLength(1);

    // Verify RPC calls were made
    expect(mockRpcCall).toHaveBeenCalledWith('pm.strandChat', { strandId: 'strand_1', message: 'Build a landing page' });
    expect(mockRpcCall).toHaveBeenCalledWith('chat.send', expect.objectContaining({ message: 'Enriched: Build a page' }));
    expect(mockRpcCall).toHaveBeenCalledWith('pm.strandSaveResponse', expect.objectContaining({ strandId: 'strand_1' }));
  });

  it('handles PM response as structured content array', async () => {
    mockRpcCall.mockImplementation(async (method) => {
      if (method === 'pm.strandChat') return { sessionKey: 'agent:main:webchat:pm-abc', enrichedMessage: 'msg' };
      if (method === 'chat.history') {
        const callCount = mockRpcCall.mock.calls.filter(c => c[0] === 'chat.history').length;
        if (callCount <= 1) return { messages: [] };
        return { messages: [
          { role: 'assistant', content: [{ type: 'text', text: 'Part 1' }, { type: 'text', text: 'Part 2' }] },
        ]};
      }
      if (method === 'chat.send') return {};
      if (method === 'pm.strandSaveResponse') return {};
      if (method === 'pm.strandCreateGoals') throw new Error('not a plan');
      return {};
    });

    const result = await execute('call1', { strandId: 'strand_1', message: 'hello' });
    expect(result.pmResponse).toBe('Part 1\nPart 2');
  });

  it('returns error for missing strandId', async () => {
    const result = await execute('call1', { message: 'hello' });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error for empty message', async () => {
    const result = await execute('call1', { strandId: 'strand_1', message: '' });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error for nonexistent strand', async () => {
    const result = await execute('call1', { strandId: 'strand_nope', message: 'hello' });
    expect(result.content[0].text).toContain('not found');
  });
});

describe('strand_pm_kickoff tool', () => {
  let store, execute, mockRpcCall, mockInternalKickoff, mockStartSpawned, mockBroadcast;
  const mockLogger = { warn: vi.fn(), info: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);

    const data = store.load();
    data.strands.push({
      id: 'strand_1', name: 'Project', description: '',
      color: null, createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    data.goals.push({
      id: 'goal_with_tasks', title: 'Has Tasks', description: '', status: 'active',
      strandId: 'strand_1', tasks: [
        { id: 'task_1', text: 'Do work', status: 'pending', done: false, sessionKey: null, dependsOn: [] },
        { id: 'task_2', text: 'More work', status: 'pending', done: false, sessionKey: null, dependsOn: [] },
      ],
      sessions: [],
    });
    data.goals.push({
      id: 'goal_no_tasks', title: 'No Tasks', description: '', status: 'active',
      strandId: 'strand_1', tasks: [], sessions: [],
    });
    store.save(data);

    mockRpcCall = vi.fn();
    mockInternalKickoff = vi.fn();
    mockStartSpawned = vi.fn();
    mockBroadcast = vi.fn();

    execute = createStrandPmKickoffExecutor(store, {
      gatewayRpcCall: mockRpcCall,
      internalKickoff: mockInternalKickoff,
      startSpawnedSessions: mockStartSpawned,
      broadcastPlanUpdate: mockBroadcast,
      logger: mockLogger,
    });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('kicks off goal with tasks using internalKickoff', async () => {
    mockInternalKickoff.mockResolvedValue({
      spawnedSessions: [
        { taskId: 'task_1', sessionKey: 'agent:main:webchat:task-abc', taskContext: 'context' },
        { taskId: 'task_2', sessionKey: 'agent:main:webchat:task-def', taskContext: 'context' },
      ],
    });

    const result = await execute('call1', { strandId: 'strand_1', goalId: 'goal_with_tasks' });
    const text = result.content[0].text;

    expect(text).toContain('spawned 2 worker session(s)');
    expect(result.spawnedCount).toBe(2);
    expect(mockInternalKickoff).toHaveBeenCalledWith('goal_with_tasks');
    expect(mockStartSpawned).toHaveBeenCalled();
    expect(mockBroadcast).toHaveBeenCalledWith(expect.objectContaining({
      event: 'goal.kickoff',
      goalId: 'goal_with_tasks',
      spawnedCount: 2,
    }));
  });

  it('triggers PM goal cascade for goal without tasks', async () => {
    mockRpcCall.mockResolvedValue({});

    const result = await execute('call1', { strandId: 'strand_1', goalId: 'goal_no_tasks' });
    const text = result.content[0].text;

    expect(text).toContain('Triggered PM goal cascade');
    expect(result.cascadeStarted).toBe(true);
    expect(mockRpcCall).toHaveBeenCalledWith('pm.goalCascade', { goalId: 'goal_no_tasks', mode: 'full' });
    expect(mockInternalKickoff).not.toHaveBeenCalled();
  });

  it('returns error for unknown strandId', async () => {
    const result = await execute('call1', { strandId: 'strand_nope', goalId: 'goal_with_tasks' });
    expect(result.content[0].text).toContain('not found');
  });

  it('returns error for unknown goalId', async () => {
    const result = await execute('call1', { strandId: 'strand_1', goalId: 'goal_nope' });
    expect(result.content[0].text).toContain('not found');
  });

  it('returns error when goal does not belong to strand', async () => {
    const data = store.load();
    data.goals.push({
      id: 'goal_other', title: 'Other', description: '', status: 'active',
      strandId: 'strand_other', tasks: [], sessions: [],
    });
    store.save(data);

    const result = await execute('call1', { strandId: 'strand_1', goalId: 'goal_other' });
    expect(result.content[0].text).toContain('does not belong');
  });

  it('returns error for missing strandId', async () => {
    const result = await execute('call1', { goalId: 'goal_with_tasks' });
    expect(result.content[0].text).toContain('Error');
  });

  it('returns error for missing goalId', async () => {
    const result = await execute('call1', { strandId: 'strand_1' });
    expect(result.content[0].text).toContain('Error');
  });
});
