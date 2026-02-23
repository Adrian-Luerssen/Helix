import { AUTONOMY_MODES } from './autonomy.js';
import { initGitHubRepo, pushBranch, setupGitRemote } from './github.js';

export function createStrandHandlers(store, options = {}) {
  const { wsOps, logger, rpcCall } = options;
  function loadData() { return store.load(); }
  function saveData(data) { store.save(data); }

  /**
   * Resolve GitHub config from store (global services).
   * Returns the config if authMode === 'account' and agentToken is set, else null.
   */
  function getGitHubAgentConfig() {
    try {
      const data = loadData();
      const gh = data.config?.services?.github;
      if (gh?.authMode === 'account' && gh?.agentToken && gh?.agentUsername) {
        return gh;
      }
    } catch { /* ignore */ }
    return null;
  }

  /**
   * Resolve the raw GitHub token from store (per-strand override or global).
   * Returns the agentToken or token, whichever is configured.
   */
  function getGitHubToken(data, strandId) {
    // Check per-strand override first
    if (strandId) {
      const strand = data.strands.find(c => c.id === strandId);
      const strandGh = strand?.services?.github;
      if (strandGh?.agentToken) return strandGh.agentToken;
      if (strandGh?.token) return strandGh.token;
    }
    // Fall back to global
    const gh = data.config?.services?.github;
    if (gh?.agentToken) return gh.agentToken;
    if (gh?.token) return gh.token;
    return null;
  }

  return {
    'strands.create': async ({ params, respond }) => {
      try {
        const { name, description, color, repoUrl, autonomyMode } = params;
        if (!name || typeof name !== 'string' || !name.trim()) {
          respond(false, undefined, { message: 'name is required' });
          return;
        }
        if (autonomyMode && !AUTONOMY_MODES.includes(autonomyMode)) {
          respond(false, undefined, { message: `Invalid autonomyMode. Must be one of: ${AUTONOMY_MODES.join(', ')}` });
          return;
        }
        const data = loadData();
        const now = Date.now();
        const strandId = store.newId('strand');
        const strand = {
          id: strandId,
          name: name.trim(),
          description: typeof description === 'string' ? description : '',
          color: color || null,
          keywords: Array.isArray(params.keywords) ? params.keywords : [],
          telegramTopicIds: Array.isArray(params.telegramTopicIds) ? params.telegramTopicIds : [],
          autonomyMode: autonomyMode || null,
          workspace: null,
          createdAtMs: now,
          updatedAtMs: now,
        };

        // Create workspace if workspaces are enabled
        if (wsOps) {
          const wsResult = wsOps.createStrandWorkspace(wsOps.dir, strandId, name.trim(), repoUrl || undefined);
          if (wsResult.ok) {
            strand.workspace = { path: wsResult.path, repoUrl: repoUrl || null, createdAtMs: now };
          } else if (logger) {
            logger.error(`helix-goals: workspace creation failed for strand ${strandId}: ${wsResult.error}`);
          }
        }

        // Clone-mode: embed auth token in remote URL so pushes authenticate
        if (strand.workspace?.path && repoUrl) {
          const ghToken = getGitHubToken(loadData(), null);
          if (ghToken) {
            try {
              setupGitRemote(strand.workspace.path, repoUrl, ghToken);
            } catch (err) {
              if (logger) logger.warn(`strands.create: failed to setup authenticated remote: ${err.message}`);
            }
          }
        }

        // Auto-create GitHub repo if agent account is configured and workspace exists
        if (strand.workspace?.path && !repoUrl) {
          const ghConfig = getGitHubAgentConfig();
          if (ghConfig) {
            try {
              const ghResult = await initGitHubRepo(
                strand.workspace.path,
                ghConfig,
                name.trim(),
                typeof description === 'string' ? description : '',
              );
              if (ghResult.ok) {
                strand.workspace.repoUrl = ghResult.repoUrl;
                strand.workspace.githubFullName = ghResult.fullName;
                strand.workspace.githubRepoName = ghResult.repoName;
                if (logger) {
                  logger.info(`helix-goals: GitHub repo created: ${ghResult.fullName} for strand ${strandId}`);
                }
              } else if (logger) {
                logger.error(`helix-goals: GitHub repo creation failed for strand ${strandId}: ${ghResult.error}`);
              }
            } catch (ghErr) {
              if (logger) {
                logger.error(`helix-goals: GitHub repo creation error for strand ${strandId}: ${ghErr.message}`);
              }
            }
          }
        }

        data.strands.unshift(strand);
        saveData(data);
        respond(true, { strand });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'strands.list': ({ params, respond }) => {
      try {
        const data = loadData();
        const strands = data.strands.map(c => ({
          ...c,
          goalCount: data.goals.filter(g => g.strandId === c.id).length,
        }));
        respond(true, { strands });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'strands.get': ({ params, respond }) => {
      try {
        const data = loadData();
        const strand = data.strands.find(c => c.id === params.id);
        if (!strand) {
          respond(false, undefined, { message: 'Strand not found' });
          return;
        }
        const goals = data.goals.filter(g => g.strandId === strand.id);
        respond(true, { strand, goals });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'strands.update': ({ params, respond }) => {
      try {
        const data = loadData();
        const idx = data.strands.findIndex(c => c.id === params.id);
        if (idx === -1) {
          respond(false, undefined, { message: 'Strand not found' });
          return;
        }
        const strand = data.strands[idx];

        // Validate name if provided (match strands.create rigor)
        if ('name' in params && (!params.name || typeof params.name !== 'string' || !params.name.trim())) {
          respond(false, undefined, { message: 'name is required' });
          return;
        }

        // Whitelist allowed patch fields (prevent overwriting internal fields)
        // Validate autonomyMode if provided
        if ('autonomyMode' in params && params.autonomyMode !== null && !AUTONOMY_MODES.includes(params.autonomyMode)) {
          respond(false, undefined, { message: `Invalid autonomyMode. Must be one of: ${AUTONOMY_MODES.join(', ')}` });
          return;
        }

        const allowed = ['name', 'description', 'color', 'keywords', 'telegramTopicIds', 'autonomyMode', 'services'];
        for (const f of allowed) {
          if (f in params) {
            // Validate array fields
            if ((f === 'keywords' || f === 'telegramTopicIds') && !Array.isArray(params[f])) continue;
            strand[f] = params[f];
          }
        }
        if (typeof strand.name === 'string') strand.name = strand.name.trim();
        strand.updatedAtMs = Date.now();

        saveData(data);
        respond(true, { strand });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },

    'strands.delete': async ({ params, respond }) => {
      try {
        const data = loadData();
        const idx = data.strands.findIndex(c => c.id === params.id);
        if (idx === -1) {
          respond(false, undefined, { message: 'Strand not found' });
          return;
        }
        const deletedStrand = data.strands[idx];

        // Collect ALL sessions associated with this strand (for abort + frontend cleanup)
        const allSessionKeys = new Set();
        // Strand PM session
        if (deletedStrand.pmStrandSessionKey) allSessionKeys.add(deletedStrand.pmStrandSessionKey);
        // Sessions from sessionStrandIndex
        for (const [sk, cId] of Object.entries(data.sessionStrandIndex || {})) {
          if (cId === params.id) allSessionKeys.add(sk);
        }
        // Goal sessions, task sessions, and goal PM sessions
        for (const goal of data.goals.filter(g => g.strandId === params.id)) {
          if (goal.pmSessionKey) allSessionKeys.add(goal.pmSessionKey);
          for (const sk of goal.sessions || []) allSessionKeys.add(sk);
          for (const task of goal.tasks || []) {
            if (task.sessionKey) allSessionKeys.add(task.sessionKey);
          }
        }
        // Kill all running sessions (best-effort)
        if (rpcCall) {
          for (const sk of allSessionKeys) {
            try { await rpcCall('sessions.delete', { sessionKey: sk }); } catch { /* may not exist */ }
            try { await rpcCall('chat.abort', { sessionKey: sk }); } catch { /* best-effort */ }
          }
        }

        // Remove workspace if it exists
        if (wsOps && deletedStrand.workspace?.path) {
          const rmResult = wsOps.removeStrandWorkspace(deletedStrand.workspace.path);
          if (!rmResult.ok && logger) {
            logger.error(`helix-goals: workspace removal failed for strand ${params.id}: ${rmResult.error}`);
          }
        }

        // Cascade-delete all goals linked to this strand (and their task sessions)
        const linkedGoalIds = data.goals
          .filter(g => g.strandId === params.id)
          .map(g => g.id);
        for (const goalId of linkedGoalIds) {
          const gIdx = data.goals.findIndex(g => g.id === goalId);
          if (gIdx === -1) continue;
          const goal = data.goals[gIdx];
          // Clean up session index entries for this goal and its tasks
          for (const [key, val] of Object.entries(data.sessionIndex || {})) {
            if (val.goalId === goalId) delete data.sessionIndex[key];
          }
          // Remove worktree (workspace dir removal above handles this too, but be explicit)
          if (wsOps && goal.worktree?.path && deletedStrand.workspace?.path) {
            try { wsOps.removeGoalWorktree(deletedStrand.workspace.path, goalId, goal.worktree?.branch); } catch {}
          }
          data.goals.splice(gIdx, 1);
        }
        // Clean up sessionStrandIndex entries pointing to this strand
        if (data.sessionStrandIndex) {
          for (const [key, val] of Object.entries(data.sessionStrandIndex)) {
            if (val === params.id) delete data.sessionStrandIndex[key];
          }
        }
        // Clean up sessionIndex entries for this strand's PM session
        if (deletedStrand.pmStrandSessionKey && data.sessionIndex) {
          delete data.sessionIndex[deletedStrand.pmStrandSessionKey];
        }
        data.strands.splice(idx, 1);
        saveData(data);
        respond(true, { ok: true, killedSessions: [...allSessionKeys] });
      } catch (err) {
        respond(false, undefined, { message: String(err) });
      }
    },
  };
}
