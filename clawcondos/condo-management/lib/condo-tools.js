import { buildGoalContext, getProjectSummaryForGoal } from './context-builder.js';
import { resolveAutonomyMode, buildAutonomyDirective } from './autonomy.js';
import { getWorkerSkillContext } from './skill-injector.js';
import { buildPlanFilePath, resolveEffectiveServices, buildServiceContextBlock } from './task-spawn.js';
import { createEmptyPlan } from './plan-manager.js';

export function createCondoBindExecutor(store, wsOps) {
  return async function execute(toolCallId, params) {
    const { sessionKey, condoId, name, description } = params;

    if (!condoId && !name) {
      return { content: [{ type: 'text', text: 'Error: provide either condoId (to bind to existing condo) or name (to create a new condo and bind).' }] };
    }

    const data = store.load();

    let condo;
    if (condoId) {
      condo = data.condos.find(c => c.id === condoId);
      if (!condo) {
        return { content: [{ type: 'text', text: `Error: condo ${condoId} not found.` }] };
      }
    } else {
      const now = Date.now();
      const newCondoId = store.newId('condo');
      condo = {
        id: newCondoId,
        name: name.trim(),
        description: typeof description === 'string' ? description : '',
        color: null,
        workspace: null,
        createdAtMs: now,
        updatedAtMs: now,
      };

      // Create workspace if workspaces are enabled
      if (wsOps) {
        const wsResult = wsOps.createCondoWorkspace(wsOps.dir, newCondoId, name.trim());
        if (wsResult.ok) {
          condo.workspace = { path: wsResult.path, repoUrl: null, createdAtMs: now };
        }
      }

      data.condos.unshift(condo);
    }

    data.sessionCondoIndex[sessionKey] = condo.id;
    store.save(data);

    return {
      content: [{ type: 'text', text: `Session bound to condo "${condo.name}" (${condo.id}).` }],
    };
  };
}

export function createCondoCreateGoalExecutor(store, wsOps) {
  return async function execute(toolCallId, params) {
    const { sessionKey, title, description, priority, tasks } = params;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return { content: [{ type: 'text', text: 'Error: title is required.' }] };
    }

    const data = store.load();
    const condoId = data.sessionCondoIndex[sessionKey];
    if (!condoId) {
      return { content: [{ type: 'text', text: 'Error: session is not bound to a condo. Use condo_bind first.' }] };
    }

    const now = Date.now();
    const goalId = store.newId('goal');
    const goal = {
      id: goalId,
      title: title.trim(),
      description: description || '',
      notes: '',
      status: 'active',
      completed: false,
      condoId,
      priority: priority || null,
      deadline: null,
      worktree: null,
      tasks: [],
      sessions: [],
      createdAtMs: now,
      updatedAtMs: now,
    };

    // Create worktree if condo has a workspace
    if (wsOps) {
      const condo = data.condos.find(c => c.id === condoId);
      if (condo?.workspace?.path) {
        const wtResult = wsOps.createGoalWorktree(condo.workspace.path, goalId, title.trim());
        if (wtResult.ok) {
          goal.worktree = { path: wtResult.path, branch: wtResult.branch, createdAtMs: now };
          // Push new branch to remote so it's visible on GitHub
          if (condo.workspace.repoUrl && wsOps.pushGoalBranch) {
            const pushResult = wsOps.pushGoalBranch(wtResult.path, wtResult.branch);
            if (pushResult.pushed || pushResult.ok) {
              goal.pushStatus = 'pushed';
            } else {
              goal.pushStatus = 'failed';
              goal.pushError = pushResult.error || 'Push failed';
            }
          }
        }
      }
    }

    // Add initial tasks if provided
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        const text = typeof t === 'string' ? t : t?.text;
        if (!text || typeof text !== 'string' || !text.trim()) continue;
        goal.tasks.push({
          id: store.newId('task'),
          text: text.trim(),
          description: (typeof t === 'object' && t?.description) || '',
          status: 'pending',
          done: false,
          priority: (typeof t === 'object' && t?.priority) || null,
          sessionKey: null,
          dependsOn: [],
          summary: '',
          createdAtMs: now,
          updatedAtMs: now,
        });
      }
    }

    data.goals.unshift(goal);
    store.save(data);

    const taskCount = goal.tasks.length;
    return {
      content: [{ type: 'text', text: `Goal "${goal.title}" created (${goal.id}) in condo ${condoId} with ${taskCount} task${taskCount !== 1 ? 's' : ''}.` }],
    };
  };
}

export function createCondoAddTaskExecutor(store) {
  return async function execute(toolCallId, params) {
    const { sessionKey, goalId, text, description, priority } = params;

    if (!goalId) {
      return { content: [{ type: 'text', text: 'Error: goalId is required.' }] };
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { content: [{ type: 'text', text: 'Error: text is required.' }] };
    }

    const data = store.load();
    const condoId = data.sessionCondoIndex[sessionKey];
    if (!condoId) {
      return { content: [{ type: 'text', text: 'Error: session is not bound to a condo.' }] };
    }

    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} not found.` }] };
    }
    if (goal.condoId !== condoId) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} does not belong to the bound condo.` }] };
    }

    const now = Date.now();
    const task = {
      id: store.newId('task'),
      text: text.trim(),
      description: description || '',
      status: 'pending',
      done: false,
      priority: priority || null,
      sessionKey: null,
      dependsOn: [],
      summary: '',
      createdAtMs: now,
      updatedAtMs: now,
    };

    goal.tasks.push(task);
    goal.updatedAtMs = now;
    store.save(data);

    return {
      content: [{ type: 'text', text: `Task "${task.text}" (${task.id}) added to goal "${goal.title}".` }],
    };
  };
}

export function createCondoSpawnTaskExecutor(store) {
  return async function execute(toolCallId, params) {
    const { sessionKey, goalId, taskId, agentId, model } = params;

    if (!goalId || !taskId) {
      return { content: [{ type: 'text', text: 'Error: goalId and taskId are required.' }] };
    }

    const data = store.load();
    const condoId = data.sessionCondoIndex[sessionKey];
    if (!condoId) {
      return { content: [{ type: 'text', text: 'Error: session is not bound to a condo.' }] };
    }

    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} not found.` }] };
    }
    if (goal.condoId !== condoId) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} does not belong to the bound condo.` }] };
    }

    const task = (goal.tasks || []).find(t => t.id === taskId);
    if (!task) {
      return { content: [{ type: 'text', text: `Error: task ${taskId} not found in goal.` }] };
    }
    if (task.sessionKey) {
      return { content: [{ type: 'text', text: `Error: task already has a session (${task.sessionKey}).` }] };
    }

    // Generate a session key for the spawned task worker
    // Uses `webchat` session type so chat.send auto-creates the session on the gateway.
    const suffix = store.newId('spawn').replace('spawn_', '');
    const agent = agentId || 'main';
    const spawnSessionKey = `agent:${agent}:webchat:task-${suffix}`;

    // Build taskContext using the same helpers as task-spawn.js
    const condo = data.condos.find(c => c.id === condoId);
    const planFilePath = buildPlanFilePath(agent, goalId, taskId);
    const autonomyMode = resolveAutonomyMode(task, goal, condo);
    const autonomyDirective = buildAutonomyDirective(autonomyMode);
    const goalContext = buildGoalContext(goal, { currentSessionKey: spawnSessionKey });
    const ps = getProjectSummaryForGoal(goal, data);
    const projectPrefix = ps ? ps + '\n\n' : '';
    const workspacePath = goal.worktree?.path || condo?.workspace?.path || null;
    const effectiveServices = resolveEffectiveServices(data, goal.condoId);
    const serviceContextBlock = buildServiceContextBlock(effectiveServices);
    const workerSkillContext = getWorkerSkillContext({
      goalId,
      taskId,
      taskText: task.text,
      taskDescription: task.description || null,
      goalTitle: goal.title,
      condoId: goal.condoId || null,
      condoName: condo?.name || null,
      autonomyMode,
      planFilePath,
      assignedRole: task.assignedAgent || null,
      workspacePath,
    });
    const pmPlan = goal.pmPlanContent || null;

    const taskContext = [
      `⚠️ **REQUIRED: When you finish this task, you MUST call \`goal_update\` with \`status: "done"\` and \`taskId: "${task.id}"\`. Your work is not recorded until you do this.**`,
      '',
      workerSkillContext || null,
      '',
      projectPrefix + goalContext,
      '',
      pmPlan ? '---\n## PM Plan (for reference)\n\n' + pmPlan + '\n---' : null,
      '',
      '---',
      `## Your Assignment: ${task.text}`,
      task.description ? `\n${task.description}` : null,
      '',
      workspacePath ? `**Working Directory:** \`${workspacePath}\`\nIMPORTANT: Start by running \`cd ${workspacePath}\` to work in the correct directory.` : null,
      '',
      serviceContextBlock,
      '',
      autonomyDirective,
      '',
      `**Plan File:** If you need to create a plan, write it to: \`${planFilePath}\``,
      'Use `goal_update` with `planStatus="awaiting_approval"` when your plan is ready for review.',
      '',
      `⚠️ **REMINDER: When done, call \`goal_update({ taskId: "${task.id}", status: "done", summary: "..." })\`**`,
    ].filter(line => line != null).join('\n');

    // Initialize plan
    if (!task.plan) {
      task.plan = createEmptyPlan();
    }
    task.plan.expectedFilePath = planFilePath;
    task.plan.updatedAtMs = Date.now();

    // Link session to goal and update task
    task.sessionKey = spawnSessionKey;
    task.status = 'in-progress';
    task.autonomyMode = autonomyMode;
    task.updatedAtMs = Date.now();
    goal.sessions.push(spawnSessionKey);
    goal.updatedAtMs = Date.now();
    data.sessionIndex[spawnSessionKey] = { goalId };
    store.save(data);

    return {
      content: [{ type: 'text', text: `Task session ${spawnSessionKey} spawned for task "${task.text}".` }],
      taskContext,
      spawnRequest: {
        sessionKey: spawnSessionKey,
        agentId: agent,
        model: model || null,
        goalId,
        taskId,
      },
    };
  };
}
