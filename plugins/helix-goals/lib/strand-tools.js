import { buildGoalContext, getProjectSummaryForGoal } from './context-builder.js';
import { resolveAutonomyMode, buildAutonomyDirective } from './autonomy.js';
import { getWorkerSkillContext } from './skill-injector.js';
import { buildPlanFilePath, resolveEffectiveServices, buildServiceContextBlock } from './task-spawn.js';
import { createEmptyPlan } from './plan-manager.js';

export function createStrandBindExecutor(store, wsOps) {
  return async function execute(toolCallId, params) {
    const { sessionKey, strandId, name, description, repoUrl } = params;

    if (!strandId && !name) {
      return { content: [{ type: 'text', text: 'Error: provide either strandId (to bind to existing strand) or name (to create a new strand and bind).' }] };
    }

    const data = store.load();

    let strand;
    if (strandId) {
      strand = data.strands.find(c => c.id === strandId);
      if (!strand) {
        return { content: [{ type: 'text', text: `Error: strand ${strandId} not found.` }] };
      }
    } else {
      const now = Date.now();
      const newStrandId = store.newId('strand');
      strand = {
        id: newStrandId,
        name: name.trim(),
        description: typeof description === 'string' ? description : '',
        color: null,
        workspace: null,
        createdAtMs: now,
        updatedAtMs: now,
      };

      // Create workspace if workspaces are enabled
      if (wsOps) {
        const wsResult = wsOps.createStrandWorkspace(wsOps.dir, newStrandId, name.trim(), repoUrl || undefined);
        if (wsResult.ok) {
          strand.workspace = { path: wsResult.path, repoUrl: repoUrl || null, createdAtMs: now };
        }
      }

      data.strands.unshift(strand);
    }

    data.sessionStrandIndex[sessionKey] = strand.id;
    store.save(data);

    return {
      content: [{ type: 'text', text: `Session bound to strand "${strand.name}" (${strand.id}).` }],
    };
  };
}

export function createStrandCreateGoalExecutor(store, wsOps) {
  return async function execute(toolCallId, params) {
    const { sessionKey, title, description, priority, tasks } = params;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return { content: [{ type: 'text', text: 'Error: title is required.' }] };
    }

    const data = store.load();
    const strandId = data.sessionStrandIndex[sessionKey];
    if (!strandId) {
      return { content: [{ type: 'text', text: 'Error: session is not bound to a strand. Use strand_bind first.' }] };
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
      strandId,
      priority: priority || null,
      deadline: null,
      worktree: null,
      tasks: [],
      sessions: [],
      createdAtMs: now,
      updatedAtMs: now,
    };

    // Create worktree if strand has a workspace
    if (wsOps) {
      const strand = data.strands.find(c => c.id === strandId);
      if (strand?.workspace?.path) {
        const wtResult = wsOps.createGoalWorktree(strand.workspace.path, goalId, title.trim());
        if (wtResult.ok) {
          goal.worktree = { path: wtResult.path, branch: wtResult.branch, createdAtMs: now };
          // Push new branch to remote so it's visible on GitHub
          if (strand.workspace.repoUrl && wsOps.pushGoalBranch) {
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
      content: [{ type: 'text', text: `Goal "${goal.title}" created (${goal.id}) in strand ${strandId} with ${taskCount} task${taskCount !== 1 ? 's' : ''}.` }],
    };
  };
}

export function createStrandAddTaskExecutor(store) {
  return async function execute(toolCallId, params) {
    const { sessionKey, goalId, text, description, priority } = params;

    if (!goalId) {
      return { content: [{ type: 'text', text: 'Error: goalId is required.' }] };
    }
    if (!text || typeof text !== 'string' || !text.trim()) {
      return { content: [{ type: 'text', text: 'Error: text is required.' }] };
    }

    const data = store.load();
    const strandId = data.sessionStrandIndex[sessionKey];
    if (!strandId) {
      return { content: [{ type: 'text', text: 'Error: session is not bound to a strand.' }] };
    }

    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} not found.` }] };
    }
    if (goal.strandId !== strandId) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} does not belong to the bound strand.` }] };
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

export function createStrandSpawnTaskExecutor(store) {
  return async function execute(toolCallId, params) {
    const { sessionKey, goalId, taskId, agentId, model } = params;

    if (!goalId || !taskId) {
      return { content: [{ type: 'text', text: 'Error: goalId and taskId are required.' }] };
    }

    const data = store.load();
    const strandId = data.sessionStrandIndex[sessionKey];
    if (!strandId) {
      return { content: [{ type: 'text', text: 'Error: session is not bound to a strand.' }] };
    }

    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} not found.` }] };
    }
    if (goal.strandId !== strandId) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} does not belong to the bound strand.` }] };
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
    const strand = data.strands.find(c => c.id === strandId);
    const planFilePath = buildPlanFilePath(agent, goalId, taskId);
    const autonomyMode = resolveAutonomyMode(task, goal, strand);
    const autonomyDirective = buildAutonomyDirective(autonomyMode);
    const goalContext = buildGoalContext(goal, { currentSessionKey: spawnSessionKey });
    const ps = getProjectSummaryForGoal(goal, data);
    const projectPrefix = ps ? ps + '\n\n' : '';
    const workspacePath = goal.worktree?.path || strand?.workspace?.path || null;
    const effectiveServices = resolveEffectiveServices(data, goal.strandId);
    const serviceContextBlock = buildServiceContextBlock(effectiveServices);
    const workerSkillContext = getWorkerSkillContext({
      goalId,
      taskId,
      taskText: task.text,
      taskDescription: task.description || null,
      goalTitle: goal.title,
      strandId: goal.strandId || null,
      strandName: strand?.name || null,
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

export function createStrandListExecutor(store) {
  return async function execute(toolCallId, params) {
    const data = store.load();
    const strands = data.strands || [];

    if (strands.length === 0) {
      return { content: [{ type: 'text', text: 'No strands found. Use `strand_bind` with a `name` to create one.' }] };
    }

    const lines = [`Found ${strands.length} strand(s):`, ''];
    for (const strand of strands) {
      const goalCount = (data.goals || []).filter(g => g.strandId === strand.id).length;
      const activeGoals = (data.goals || []).filter(g => g.strandId === strand.id && g.status !== 'done').length;
      lines.push(`- **${strand.name}** (${strand.id})`);
      if (strand.description) lines.push(`  ${strand.description}`);
      lines.push(`  Goals: ${goalCount} total, ${activeGoals} active`);
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };
}

export function createStrandStatusExecutor(store) {
  return async function execute(toolCallId, params) {
    const { strandId } = params;

    if (!strandId) {
      return { content: [{ type: 'text', text: 'Error: strandId is required.' }] };
    }

    const data = store.load();
    const strand = data.strands.find(c => c.id === strandId);
    if (!strand) {
      return { content: [{ type: 'text', text: `Error: strand ${strandId} not found.` }] };
    }

    const goals = (data.goals || []).filter(g => g.strandId === strandId);
    const lines = [
      `# ${strand.name} (${strand.id})`,
    ];
    if (strand.description) lines.push(strand.description);
    if (strand.workspace?.path) lines.push(`Workspace: ${strand.workspace.path}`);

    if (goals.length === 0) {
      lines.push('', 'No goals yet.');
    } else {
      const active = goals.filter(g => g.status !== 'done');
      const done = goals.filter(g => g.status === 'done');
      lines.push('', `## Goals (${active.length} active, ${done.length} done)`);

      for (const goal of goals) {
        const tasks = goal.tasks || [];
        const doneTasks = tasks.filter(t => t.done || t.status === 'done').length;
        lines.push('', `### [${goal.status || 'active'}] ${goal.title} (${goal.id})`);
        if (goal.description) lines.push(goal.description);

        if (tasks.length > 0) {
          lines.push(`Tasks (${doneTasks}/${tasks.length} done):`);
          for (const t of tasks) {
            const status = t.status || (t.done ? 'done' : 'pending');
            let suffix = '';
            if (t.sessionKey) suffix = ` (session: ${t.sessionKey})`;
            else if (status !== 'done') suffix = ' — unassigned';
            lines.push(`- [${status}] ${t.text} [${t.id}]${suffix}`);
            if ((t.done || status === 'done') && t.summary) {
              lines.push(`  > ${t.summary}`);
            }
          }
        }
      }
    }

    return { content: [{ type: 'text', text: lines.join('\n') }] };
  };
}

export function createStrandPmChatExecutor(store, { gatewayRpcCall, logger }) {
  return async function execute(toolCallId, params) {
    const { strandId, message } = params;

    if (!strandId) {
      return { content: [{ type: 'text', text: 'Error: strandId is required.' }] };
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return { content: [{ type: 'text', text: 'Error: message is required.' }] };
    }

    const data = store.load();
    const strand = data.strands.find(c => c.id === strandId);
    if (!strand) {
      return { content: [{ type: 'text', text: `Error: strand ${strandId} not found.` }] };
    }

    // Step 1: Build enriched message and get PM session key via pm.strandChat
    let pmSession, enrichedMessage;
    try {
      const chatResult = await gatewayRpcCall('pm.strandChat', { strandId, message: message.trim() });
      pmSession = chatResult.sessionKey || chatResult.pmSessionKey;
      enrichedMessage = chatResult.enrichedMessage || chatResult.message || message.trim();
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: failed to prepare PM chat: ${err.message}` }] };
    }

    if (!pmSession) {
      return { content: [{ type: 'text', text: 'Error: could not obtain PM session key.' }] };
    }

    // Step 2: Get baseline message count
    let baselineCount = 0;
    try {
      const history = await gatewayRpcCall('chat.history', { sessionKey: pmSession, limit: 50 });
      const messages = history?.messages || history || [];
      baselineCount = messages.length;
    } catch {
      // Fresh session, no history
    }

    // Step 3: Send message to PM
    try {
      await gatewayRpcCall('chat.send', { sessionKey: pmSession, message: enrichedMessage });
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: failed to send message to PM: ${err.message}` }] };
    }

    // Step 4: Poll for PM response
    const POLL_INTERVAL = 3000;
    const POLL_TIMEOUT = 180000;
    const startTime = Date.now();
    let pmResponse = null;

    while (Date.now() - startTime < POLL_TIMEOUT) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL));

      try {
        const history = await gatewayRpcCall('chat.history', { sessionKey: pmSession, limit: 50 });
        const messages = history?.messages || history || [];

        if (messages.length > baselineCount) {
          // Look for last assistant message
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === 'assistant') {
              pmResponse = typeof msg.content === 'string'
                ? msg.content
                : Array.isArray(msg.content)
                  ? msg.content.filter(c => c.type === 'text').map(c => c.text).join('\n')
                  : null;
              break;
            }
          }
          if (pmResponse) break;
        }
      } catch (err) {
        logger.warn(`strand_pm_chat: poll error: ${err.message}`);
      }
    }

    if (!pmResponse) {
      return { content: [{ type: 'text', text: 'PM did not respond within the timeout period (3 minutes). The PM session may still be processing — check back with `strand_status`.' }] };
    }

    // Step 5: Save PM response
    try {
      await gatewayRpcCall('pm.strandSaveResponse', { strandId, content: pmResponse });
    } catch (err) {
      logger.warn(`strand_pm_chat: failed to save PM response: ${err.message}`);
    }

    // Step 6: Try to auto-create goals from PM plan
    let goals = null;
    try {
      const createResult = await gatewayRpcCall('pm.strandCreateGoals', { strandId, planContent: pmResponse });
      goals = createResult?.goals || createResult?.createdGoals || null;
    } catch {
      // PM might be asking questions rather than proposing a plan — this is expected
    }

    const resultLines = ['**PM Response:**', '', pmResponse];
    if (goals && goals.length > 0) {
      resultLines.push('', '---', `**${goals.length} goal(s) created from PM plan:**`);
      for (const g of goals) {
        const taskCount = g.tasks?.length || 0;
        resultLines.push(`- ${g.title} (${g.id}) — ${taskCount} task(s)`);
      }
      resultLines.push('', 'Use `strand_pm_kickoff` with a goalId to start execution.');
    }

    return {
      content: [{ type: 'text', text: resultLines.join('\n') }],
      pmResponse,
      goals,
    };
  };
}

export function createStrandPmKickoffExecutor(store, { gatewayRpcCall, internalKickoff, startSpawnedSessions, broadcastPlanUpdate, logger }) {
  return async function execute(toolCallId, params) {
    const { strandId, goalId } = params;

    if (!strandId) {
      return { content: [{ type: 'text', text: 'Error: strandId is required.' }] };
    }
    if (!goalId) {
      return { content: [{ type: 'text', text: 'Error: goalId is required.' }] };
    }

    const data = store.load();
    const strand = data.strands.find(c => c.id === strandId);
    if (!strand) {
      return { content: [{ type: 'text', text: `Error: strand ${strandId} not found.` }] };
    }

    const goal = data.goals.find(g => g.id === goalId);
    if (!goal) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} not found.` }] };
    }
    if (goal.strandId !== strandId) {
      return { content: [{ type: 'text', text: `Error: goal ${goalId} does not belong to strand ${strandId}.` }] };
    }

    const tasks = goal.tasks || [];
    const pendingTasks = tasks.filter(t => !t.sessionKey && t.status !== 'done');

    // Goal has tasks ready to spawn
    if (pendingTasks.length > 0) {
      try {
        const kickoffResult = await internalKickoff(goalId);
        if (kickoffResult.spawnedSessions?.length > 0) {
          await startSpawnedSessions(kickoffResult.spawnedSessions);
          broadcastPlanUpdate({
            event: 'goal.kickoff',
            goalId,
            spawnedCount: kickoffResult.spawnedSessions.length,
            spawnedSessions: kickoffResult.spawnedSessions,
          });
        }

        const spawnedCount = kickoffResult.spawnedSessions?.length || 0;
        return {
          content: [{ type: 'text', text: `Kickoff complete: spawned ${spawnedCount} worker session(s) for goal "${goal.title}". Use \`strand_status\` to monitor progress.` }],
          spawnedCount,
        };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: kickoff failed: ${err.message}` }] };
      }
    }

    // Goal has no tasks — trigger PM goal cascade to create tasks first
    try {
      await gatewayRpcCall('pm.goalCascade', { goalId, mode: 'full' });
      return {
        content: [{ type: 'text', text: `Goal "${goal.title}" has no tasks yet. Triggered PM goal cascade to plan tasks and auto-spawn workers. Use \`strand_status\` to monitor progress.` }],
        cascadeStarted: true,
      };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error: goal cascade failed: ${err.message}` }] };
    }
  };
}
