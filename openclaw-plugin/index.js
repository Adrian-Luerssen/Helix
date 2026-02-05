import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGoalsStore } from './lib/goals-store.js';
import { createGoalHandlers } from './lib/goals-handlers.js';
import { buildGoalContext } from './lib/context-builder.js';
import { createGoalUpdateExecutor } from './lib/goal-update-tool.js';

export default function register(api) {
  const dataDir = api.pluginConfig?.dataDir
    || join(dirname(fileURLToPath(import.meta.url)), '.data');
  const store = createGoalsStore(dataDir);
  const handlers = createGoalHandlers(store);

  for (const [method, handler] of Object.entries(handlers)) {
    api.registerGatewayMethod(method, handler);
  }

  // Hook: inject goal context into agent prompts
  api.registerHook('before_agent_start', async (event) => {
    const sessionKey = event.context?.sessionKey;
    if (!sessionKey) return;
    const data = store.load();
    const entry = data.sessionIndex[sessionKey];
    if (!entry) return;
    const goal = data.goals.find(g => g.id === entry.goalId);
    if (!goal) return;
    const context = buildGoalContext(goal);
    if (!context) return;
    return { prependContext: context };
  });

  // Hook: track session activity on goals
  api.registerHook('agent_end', async (event) => {
    const sessionKey = event.context?.sessionKey;
    if (!sessionKey || !event.success) return;
    const data = store.load();
    const entry = data.sessionIndex[sessionKey];
    if (!entry) return;
    const goal = data.goals.find(g => g.id === entry.goalId);
    if (!goal) return;
    goal.updatedAtMs = Date.now();
    store.save(data);
    api.logger.info(`clawcondos-goals: agent_end for session ${sessionKey} (goal: ${goal.title})`);
  });

  // Tool: goal_update for agents to report task status
  const goalUpdateExecute = createGoalUpdateExecutor(store);

  api.registerTool(
    (ctx) => {
      if (!ctx.sessionKey) return null;
      const data = store.load();
      const entry = data.sessionIndex[ctx.sessionKey];
      if (!entry) return null;

      return {
        name: 'goal_update',
        label: 'Update Goal/Task Status',
        description: 'Report progress on a task within your assigned goal. Use when you complete a task or encounter a blocker.',
        parameters: {
          type: 'object',
          properties: {
            taskId: { type: 'string', description: 'ID of the task to update (from goal context)' },
            status: { type: 'string', enum: ['done', 'in-progress', 'blocked'], description: 'New status' },
            summary: { type: 'string', description: 'Brief summary of what was accomplished or what is blocking' },
          },
          required: ['status'],
        },
        async execute(toolCallId, params) {
          return goalUpdateExecute(toolCallId, { ...params, sessionKey: ctx.sessionKey });
        },
      };
    },
    { names: ['goal_update'] }
  );

  api.logger.info(`clawcondos-goals: registered ${Object.keys(handlers).length} gateway methods, data at ${dataDir}`);
}
