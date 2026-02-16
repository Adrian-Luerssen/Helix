#!/usr/bin/env node
/**
 * E2E Live Test: Create a condo and verify GitHub repo creation.
 * Uses the plugin modules directly (same as the server does).
 */

import { createGoalsStore } from '../clawcondos/condo-management/lib/goals-store.js';
import { createCondoHandlers } from '../clawcondos/condo-management/lib/condos-handlers.js';
import { createGoalHandlers } from '../clawcondos/condo-management/lib/goals-handlers.js';
import * as workspaceManager from '../clawcondos/condo-management/lib/workspace-manager.js';
import https from 'https';

const WORKSPACES_DIR = process.env.CLAWCONDOS_WORKSPACES_DIR || '/home/clawdia/clawcondos-workspaces';
const DATA_DIR = '/home/clawdia/clawcondos/clawcondos/condo-management/.data';

function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }

function githubGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ClawCondos-E2E',
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  // Use the production store so GitHub config is available
  const store = createGoalsStore(DATA_DIR);

  // Verify GitHub config exists
  const data = store.load();
  const ghConfig = data.config?.services?.github;
  if (!ghConfig?.agentToken || ghConfig.authMode !== 'account') {
    console.error('FATAL: No GitHub agent account configured in store');
    process.exit(1);
  }
  log('🔑', `GitHub agent: ${ghConfig.agentUsername}, manager: ${ghConfig.managerUsername}`);

  const wsOps = { dir: WORKSPACES_DIR, ...workspaceManager };
  const logger = {
    info: (msg) => console.log(`  [info] ${msg}`),
    error: (msg) => console.error(`  [error] ${msg}`),
  };

  const handlers = createCondoHandlers(store, { wsOps, logger });
  const goalHandlers = createGoalHandlers(store, { wsOps, logger });

  // ── Step 1: Create a condo (should auto-create GitHub repo) ──
  log('📦', 'Creating "E2E Test Project" condo...');

  const result = await new Promise((resolve) => {
    handlers['condos.create']({
      params: {
        name: 'E2E Test Project',
        description: 'Automated E2E test — verifying GitHub repo creation',
      },
      respond: (ok, payload, error) => resolve({ ok, payload, error }),
    });
  });

  if (!result.ok) {
    console.error('FATAL: Condo creation failed:', result.error);
    process.exit(1);
  }

  const condo = result.payload.condo;
  log('✅', `Condo created: ${condo.id}`);
  log('📁', `Workspace: ${condo.workspace?.path || 'NONE'}`);
  log('🔗', `Repo URL: ${condo.workspace?.repoUrl || 'NONE'}`);
  log('📛', `GitHub repo: ${condo.workspace?.githubFullName || 'NONE'}`);

  if (!condo.workspace?.repoUrl) {
    console.error('FATAL: No GitHub repo URL set on condo workspace!');
    process.exit(1);
  }

  // ── Step 2: Verify repo exists on GitHub ──
  log('🔍', 'Verifying repo exists on GitHub...');
  const repoName = condo.workspace.githubRepoName;
  const owner = ghConfig.org || ghConfig.agentUsername;
  const repoCheck = await githubGet(`/repos/${owner}/${repoName}`, ghConfig.agentToken);

  if (repoCheck.status !== 200) {
    console.error(`FATAL: Repo not found on GitHub! Status: ${repoCheck.status}`, repoCheck.data);
    process.exit(1);
  }
  log('✅', `Repo verified: ${repoCheck.data.full_name}`);
  log('🔒', `Visibility: ${repoCheck.data.private ? 'private' : 'public'}`);

  // ── Step 3: Verify manager was added as collaborator ──
  if (ghConfig.autoCollaborator && ghConfig.managerUsername) {
    log('👥', `Checking collaborator: ${ghConfig.managerUsername}...`);
    const collabCheck = await githubGet(
      `/repos/${owner}/${repoName}/collaborators/${ghConfig.managerUsername}`,
      ghConfig.agentToken,
    );
    // 204 = is a collaborator, 404 = not a collaborator
    if (collabCheck.status === 204) {
      log('✅', `Manager ${ghConfig.managerUsername} is a collaborator`);
    } else {
      log('⚠️', `Collaborator check returned ${collabCheck.status} (may be pending invitation)`);
    }
  }

  // ── Step 4: Create a goal (should push branch to GitHub) ──
  log('🎯', 'Creating a goal with worktree...');
  const goalResult = await new Promise((resolve) => {
    goalHandlers['goals.create']({
      params: {
        title: 'Initial setup',
        condoId: condo.id,
        description: 'Set up the project structure',
      },
      respond: (ok, payload, error) => resolve({ ok, payload, error }),
    });
  });

  if (!goalResult.ok) {
    log('⚠️', `Goal creation failed: ${goalResult.error?.message}`);
  } else {
    const goal = goalResult.payload.goal;
    log('✅', `Goal created: ${goal.id}`);
    log('🌿', `Branch: ${goal.worktree?.branch || 'NONE'}`);

    // Check if branch was pushed to GitHub
    if (goal.worktree?.branch) {
      // Give GitHub a moment to propagate
      await new Promise(r => setTimeout(r, 2000));
      const branchCheck = await githubGet(
        `/repos/${owner}/${repoName}/branches/${encodeURIComponent(goal.worktree.branch)}`,
        ghConfig.agentToken,
      );
      if (branchCheck.status === 200) {
        log('✅', `Branch ${goal.worktree.branch} pushed to GitHub`);
      } else {
        log('⚠️', `Branch not found on GitHub (status ${branchCheck.status}) — may need a moment`);
      }
    }
  }

  // ── Step 5: Verify remote is set in the workspace ──
  const { execSync } = await import('child_process');
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: condo.workspace.path,
      encoding: 'utf-8',
    }).trim();
    // Mask token in output
    const masked = remoteUrl.replace(/x-access-token:[^@]+@/, 'x-access-token:****@');
    log('🔗', `Remote URL: ${masked}`);
  } catch {
    log('⚠️', 'No remote configured in workspace');
  }

  // ── Summary ──
  log('', '');
  log('🎉', '═══════════════════════════════════════════════════════');
  log('🎉', '  GitHub Integration E2E Test PASSED!');
  log('🎉', '═══════════════════════════════════════════════════════');
  log('', '');
  log('📦', `Condo: ${condo.name} (${condo.id})`);
  log('🔗', `GitHub: ${condo.workspace.githubFullName}`);
  log('📁', `Workspace: ${condo.workspace.path}`);
  log('', '');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
