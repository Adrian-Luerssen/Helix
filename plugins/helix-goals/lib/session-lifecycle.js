/**
 * Session Lifecycle Management
 * Kill sessions for goals/strands, clean up stale sessions.
 */

/**
 * Collect all session keys associated with a goal.
 * @param {object} goal - Goal object
 * @returns {string[]} Unique session keys
 */
function collectGoalSessionKeys(goal) {
  const keys = new Set();
  // Goal PM session
  if (goal.pmSessionKey) keys.add(goal.pmSessionKey);
  // Goal-level sessions
  for (const sk of goal.sessions || []) {
    keys.add(sk);
  }
  // Task-level sessions
  for (const task of goal.tasks || []) {
    if (task.sessionKey) {
      keys.add(task.sessionKey);
    }
  }
  return [...keys];
}

/**
 * Collect all session keys associated with a strand.
 * @param {object} data - Store data
 * @param {string} strandId - Strand ID
 * @returns {string[]} Unique session keys
 */
function collectStrandSessionKeys(data, strandId) {
  const keys = new Set();
  // Strand PM session
  const strand = data.strands?.find(c => c.id === strandId);
  if (strand?.pmStrandSessionKey) keys.add(strand.pmStrandSessionKey);
  // Sessions from sessionStrandIndex
  for (const [sk, cId] of Object.entries(data.sessionStrandIndex || {})) {
    if (cId === strandId) keys.add(sk);
  }
  // Sessions from all goals in the strand
  const goals = data.goals.filter(g => g.strandId === strandId);
  for (const goal of goals) {
    for (const sk of collectGoalSessionKeys(goal)) {
      keys.add(sk);
    }
  }
  return [...keys];
}

/**
 * Create session lifecycle RPC handlers.
 * @param {object} store - Goals store
 * @param {object} options
 * @param {function} options.rpcCall - Function to call gateway RPC methods
 * @param {object} [options.logger] - Logger
 * @returns {object} Map of method names to handlers
 */
export function createSessionLifecycleHandlers(store, options = {}) {
  const { rpcCall, logger } = options;

  /**
   * Abort and attempt to delete a single session (best-effort).
   */
  async function abortSession(sessionKey) {
    try {
      // Try sessions.delete first (if gateway supports it)
      try { await rpcCall('sessions.delete', { sessionKey }); } catch { /* may not exist */ }
      await rpcCall('chat.abort', { sessionKey });
      return { sessionKey, aborted: true };
    } catch (err) {
      return { sessionKey, aborted: false, error: err.message };
    }
  }

  return {
    /**
     * Kill all sessions for a goal.
     * Params: { goalId }
     */
    'sessions.killForGoal': async ({ params, respond }) => {
      const { goalId } = params || {};
      if (!goalId) return respond(false, null, 'goalId is required');

      try {
        const data = store.load();
        const goal = data.goals.find(g => g.id === goalId);
        if (!goal) return respond(false, null, 'Goal not found');

        const sessionKeys = collectGoalSessionKeys(goal);
        const results = await Promise.all(sessionKeys.map(abortSession));

        // Clear task session assignments for aborted tasks
        for (const task of goal.tasks || []) {
          if (task.sessionKey && task.status !== 'done') {
            task.sessionKey = null;
            task.status = 'pending';
            task.updatedAtMs = Date.now();
          }
        }
        goal.updatedAtMs = Date.now();
        store.save(data);

        const abortedCount = results.filter(r => r.aborted).length;
        if (logger) logger.info(`sessions.killForGoal: aborted ${abortedCount}/${sessionKeys.length} for goal ${goalId}`);

        respond(true, { goalId, total: sessionKeys.length, aborted: abortedCount, killedSessions: sessionKeys, results });
      } catch (err) {
        respond(false, null, err.message);
      }
    },

    /**
     * Kill all sessions for a strand.
     * Params: { strandId }
     */
    'sessions.killForStrand': async ({ params, respond }) => {
      const { strandId } = params || {};
      if (!strandId) return respond(false, null, 'strandId is required');

      try {
        const data = store.load();
        const strand = data.strands.find(c => c.id === strandId);
        if (!strand) return respond(false, null, 'Strand not found');

        const sessionKeys = collectStrandSessionKeys(data, strandId);
        const results = await Promise.all(sessionKeys.map(abortSession));

        // Clear task session assignments for all goals in strand
        const goals = data.goals.filter(g => g.strandId === strandId);
        for (const goal of goals) {
          for (const task of goal.tasks || []) {
            if (task.sessionKey && task.status !== 'done') {
              task.sessionKey = null;
              task.status = 'pending';
              task.updatedAtMs = Date.now();
            }
          }
          goal.updatedAtMs = Date.now();
        }
        store.save(data);

        const abortedCount = results.filter(r => r.aborted).length;
        if (logger) logger.info(`sessions.killForStrand: aborted ${abortedCount}/${sessionKeys.length} for strand ${strandId}`);

        respond(true, { strandId, total: sessionKeys.length, aborted: abortedCount, killedSessions: sessionKeys, results });
      } catch (err) {
        respond(false, null, err.message);
      }
    },

    /**
     * Clean up stale sessions (sessions with no active task).
     * Params: { strandId? }
     */
    'sessions.cleanupStale': async ({ params, respond }) => {
      const { strandId } = params || {};

      try {
        const data = store.load();
        const goals = strandId
          ? data.goals.filter(g => g.strandId === strandId)
          : data.goals;

        const staleSessions = [];

        for (const goal of goals) {
          for (const task of goal.tasks || []) {
            // A session is stale if it has a sessionKey but the task isn't actively in-progress
            if (task.sessionKey && task.status !== 'in-progress' && task.status !== 'done') {
              staleSessions.push(task.sessionKey);
            }
          }
        }

        const results = await Promise.all(staleSessions.map(abortSession));
        const abortedCount = results.filter(r => r.aborted).length;

        if (logger) logger.info(`sessions.cleanupStale: cleaned ${abortedCount}/${staleSessions.length} stale sessions`);

        respond(true, { total: staleSessions.length, aborted: abortedCount, results });
      } catch (err) {
        respond(false, null, err.message);
      }
    },

    /**
     * List all sessions for a strand with status info.
     * Params: { strandId }
     */
    'sessions.listForStrand': ({ params, respond }) => {
      const { strandId } = params || {};
      if (!strandId) return respond(false, null, 'strandId is required');

      try {
        const data = store.load();
        const strand = data.strands.find(c => c.id === strandId);
        if (!strand) return respond(false, null, 'Strand not found');

        const sessions = [];
        const goals = data.goals.filter(g => g.strandId === strandId);

        for (const goal of goals) {
          for (const task of goal.tasks || []) {
            if (task.sessionKey) {
              sessions.push({
                sessionKey: task.sessionKey,
                goalId: goal.id,
                goalTitle: goal.title,
                taskId: task.id,
                taskText: task.text,
                taskStatus: task.status,
              });
            }
          }
        }

        // Also include strand-level sessions from sessionStrandIndex
        for (const [sk, cId] of Object.entries(data.sessionStrandIndex || {})) {
          if (cId === strandId && !sessions.find(s => s.sessionKey === sk)) {
            sessions.push({
              sessionKey: sk,
              goalId: null,
              goalTitle: null,
              taskId: null,
              taskText: null,
              taskStatus: 'strand-session',
            });
          }
        }

        respond(true, { strandId, sessions, count: sessions.length });
      } catch (err) {
        respond(false, null, err.message);
      }
    },
  };
}

export { collectGoalSessionKeys, collectStrandSessionKeys };
