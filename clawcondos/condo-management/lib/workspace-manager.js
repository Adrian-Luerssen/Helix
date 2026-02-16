/**
 * Workspace Manager
 * Creates and manages git workspaces for condos and git worktrees for goals.
 * All functions return { ok, path?, error? } result objects (never throw).
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

/**
 * Sanitize a condo name for use as a directory name.
 * Lowercases, replaces non-alphanumeric chars with hyphens, collapses runs, trims.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeDirName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'workspace';
}

/**
 * Build the workspace directory path for a condo.
 * @param {string} baseDir - CLAWCONDOS_WORKSPACES_DIR
 * @param {string} condoId - Condo ID (e.g. condo_abc123)
 * @param {string} condoName - Human-readable condo name
 * @returns {string}
 */
export function condoWorkspacePath(baseDir, condoId, condoName) {
  const slug = sanitizeDirName(condoName);
  const suffix = condoId.replace(/^condo_/, '').slice(0, 8);
  return join(baseDir, `${slug}-${suffix}`);
}

/**
 * Build the worktree directory path for a goal inside a condo workspace.
 * @param {string} condoWs - Condo workspace root path
 * @param {string} goalId - Goal ID
 * @returns {string}
 */
export function goalWorktreePath(condoWs, goalId) {
  return join(condoWs, 'goals', goalId);
}

/**
 * Build the branch name for a goal worktree.
 * If goalTitle is provided, uses a human-readable slug; otherwise falls back to goalId.
 * @param {string} goalId
 * @param {string} [goalTitle] - Optional goal title for readable branch names
 * @returns {string}
 */
export function goalBranchName(goalId, goalTitle) {
  if (!goalTitle) return `goal/${goalId}`;
  const slug = sanitizeDirName(goalTitle);
  return `goal/${slug}`;
}

/**
 * Create a git-initialized workspace directory for a condo.
 * If repoUrl is provided, clones it; otherwise does git init + empty commit.
 * Idempotent — returns { ok: true, existed: true } if directory already exists.
 *
 * @param {string} baseDir - Base workspaces directory
 * @param {string} condoId - Condo ID
 * @param {string} condoName - Condo name (used for slug)
 * @param {string} [repoUrl] - Optional git repo URL to clone
 * @returns {{ ok: boolean, path?: string, existed?: boolean, error?: string }}
 */
export function createCondoWorkspace(baseDir, condoId, condoName, repoUrl) {
  const wsPath = condoWorkspacePath(baseDir, condoId, condoName);

  try {
    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // Idempotent — if already exists, return success
    if (existsSync(wsPath)) {
      return { ok: true, path: wsPath, existed: true };
    }

    if (repoUrl) {
      // Clone the repository
      execSync(`git clone ${shellQuote(repoUrl)} ${shellQuote(wsPath)}`, {
        stdio: 'pipe',
        timeout: 120_000,
      });
    } else {
      // Fresh git init with empty initial commit
      mkdirSync(wsPath, { recursive: true });
      execSync('git init', { cwd: wsPath, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "Initial commit"', {
        cwd: wsPath,
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Helix', GIT_AUTHOR_EMAIL: 'clawcondos@localhost', GIT_COMMITTER_NAME: 'Helix', GIT_COMMITTER_EMAIL: 'clawcondos@localhost' },
      });
    }

    // Create goals/ subdirectory
    const goalsDir = join(wsPath, 'goals');
    if (!existsSync(goalsDir)) {
      mkdirSync(goalsDir, { recursive: true });
    }

    return { ok: true, path: wsPath };
  } catch (err) {
    return { ok: false, path: wsPath, error: err.message };
  }
}

/**
 * Create a git worktree for a goal inside a condo workspace.
 * Creates branch goal/<slug> and worktree at goals/<goalId>/.
 * If goalTitle is provided, generates a readable branch name from the title.
 * Handles branch name conflicts by appending a goalId suffix.
 * Idempotent — returns { ok: true, existed: true } if worktree already exists.
 *
 * @param {string} condoWs - Condo workspace root path
 * @param {string} goalId - Goal ID
 * @param {string} [goalTitle] - Optional goal title for readable branch names
 * @returns {{ ok: boolean, path?: string, branch?: string, existed?: boolean, error?: string }}
 */
export function createGoalWorktree(condoWs, goalId, goalTitle) {
  const wtPath = goalWorktreePath(condoWs, goalId);
  let branch = goalBranchName(goalId, goalTitle);

  try {
    // Idempotent check
    if (existsSync(wtPath)) {
      return { ok: true, path: wtPath, branch, existed: true };
    }

    // If using a title-based branch, check for conflicts and append suffix if needed
    if (goalTitle) {
      const branchExists = branchExistsInRepo(condoWs, branch);
      if (branchExists) {
        const suffix = goalId.replace(/^goal_/, '').slice(0, 6);
        branch = `${branch}-${suffix}`;
      }
    }

    // Ensure goals/ parent exists
    const goalsDir = join(condoWs, 'goals');
    if (!existsSync(goalsDir)) {
      mkdirSync(goalsDir, { recursive: true });
    }

    execSync(`git worktree add ${shellQuote(wtPath)} -b ${shellQuote(branch)}`, {
      cwd: condoWs,
      stdio: 'pipe',
    });

    return { ok: true, path: wtPath, branch };
  } catch (err) {
    return { ok: false, path: wtPath, branch, error: err.message };
  }
}

/**
 * Remove a goal's git worktree and prune.
 * Accepts an optional stored branch name to avoid recomputing.
 *
 * @param {string} condoWs - Condo workspace root path
 * @param {string} goalId - Goal ID
 * @param {string} [storedBranch] - Stored branch name from goal.worktree.branch
 * @returns {{ ok: boolean, error?: string }}
 */
export function removeGoalWorktree(condoWs, goalId, storedBranch) {
  const wtPath = goalWorktreePath(condoWs, goalId);
  const branch = storedBranch || goalBranchName(goalId);

  try {
    if (existsSync(wtPath)) {
      execSync(`git worktree remove --force ${shellQuote(wtPath)}`, {
        cwd: condoWs,
        stdio: 'pipe',
      });
    }

    // Prune stale worktree entries
    try {
      execSync('git worktree prune', { cwd: condoWs, stdio: 'pipe' });
    } catch { /* non-critical */ }

    // Delete the branch (best-effort)
    try {
      execSync(`git branch -D ${shellQuote(branch)}`, { cwd: condoWs, stdio: 'pipe' });
    } catch { /* branch may not exist or may be checked out elsewhere */ }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Remove an entire condo workspace directory.
 *
 * @param {string} condoWs - Condo workspace root path
 * @returns {{ ok: boolean, error?: string }}
 */
export function removeCondoWorkspace(condoWs) {
  try {
    if (existsSync(condoWs)) {
      rmSync(condoWs, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Detect the main branch name in a repository.
 * @param {string} repoPath - Repository root path
 * @returns {string} 'main' or 'master' (defaults to 'main')
 */
export function getMainBranch(repoPath) {
  try {
    const branches = execSync('git branch --list main master', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // Prefer the branch marked with *, otherwise check what exists
    const lines = branches.split('\n').map(l => l.trim());
    const current = lines.find(l => l.startsWith('* '));
    if (current) return current.replace('* ', '');
    if (lines.includes('main')) return 'main';
    if (lines.includes('master')) return 'master';
    // Fall back to HEAD's branch name
    const head = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return head || 'main';
  } catch {
    return 'main';
  }
}

/**
 * Merge a goal branch into the main branch.
 * @param {string} condoWs - Condo workspace root path
 * @param {string} branch - Branch name to merge
 * @returns {{ ok: boolean, merged?: boolean, conflict?: boolean, error?: string }}
 */
export function mergeGoalBranch(condoWs, branch) {
  try {
    const mainBranch = getMainBranch(condoWs);

    // Merge from the main working tree (condo root)
    execSync(`git merge ${shellQuote(branch)} --no-ff -m ${shellQuote(`Merge ${branch} into ${mainBranch}`)}`, {
      cwd: condoWs,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Helix',
        GIT_AUTHOR_EMAIL: 'clawcondos@localhost',
        GIT_COMMITTER_NAME: 'Helix',
        GIT_COMMITTER_EMAIL: 'clawcondos@localhost',
      },
    });

    return { ok: true, merged: true };
  } catch (err) {
    // Collect all output to check for conflict markers
    const output = [
      err.message || '',
      err.stdout?.toString() || '',
      err.stderr?.toString() || '',
    ].join('\n');

    if (output.includes('CONFLICT') || output.includes('Automatic merge failed') || output.includes('Merge conflict')) {
      // Abort the failed merge
      try {
        execSync('git merge --abort', { cwd: condoWs, stdio: 'pipe' });
      } catch { /* best-effort */ }
      return { ok: false, conflict: true, error: output.trim() };
    }
    return { ok: false, error: err.message };
  }
}

/**
 * Check the status of a goal branch relative to main.
 * @param {string} condoWs - Condo workspace root path
 * @param {string} branch - Branch name to check
 * @returns {{ ok: boolean, behindMain?: number, aheadOfMain?: number, conflictFiles?: string[], error?: string }}
 */
export function checkBranchStatus(condoWs, branch) {
  try {
    const mainBranch = getMainBranch(condoWs);

    // Get ahead/behind counts
    const counts = execSync(
      `git rev-list --left-right --count ${shellQuote(mainBranch)}...${shellQuote(branch)}`,
      { cwd: condoWs, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    const [behind, ahead] = counts.split(/\s+/).map(Number);

    // Dry-run merge to detect conflicts (using merge-tree with two commits)
    let conflictFiles = [];
    if (behind > 0 && ahead > 0) {
      try {
        // git merge-tree --write-tree exits non-zero if there are conflicts
        execSync(
          `git merge-tree --write-tree ${shellQuote(mainBranch)} ${shellQuote(branch)}`,
          { cwd: condoWs, stdio: 'pipe' }
        );
      } catch (mergeErr) {
        // Parse conflict file names from output
        const output = mergeErr.stdout?.toString() || mergeErr.message || '';
        const lines = output.split('\n');
        for (const line of lines) {
          // merge-tree outputs conflict markers with file paths
          if (line.includes('CONFLICT')) {
            const match = line.match(/CONFLICT.*?:\s*(.+)/);
            if (match) conflictFiles.push(match[1].trim());
          }
        }
        if (conflictFiles.length === 0 && output.trim()) {
          conflictFiles = ['(conflict detected)'];
        }
      }
    }

    return {
      ok: true,
      behindMain: behind || 0,
      aheadOfMain: ahead || 0,
      conflictFiles: conflictFiles.length > 0 ? conflictFiles : undefined,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Check if a branch exists in a repository.
 * @param {string} repoPath - Repository root path
 * @param {string} branch - Branch name to check
 * @returns {boolean}
 */
function branchExistsInRepo(repoPath, branch) {
  try {
    execSync(`git rev-parse --verify ${shellQuote(branch)}`, {
      cwd: repoPath,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Quote a string for safe shell usage.
 * Uses JSON.stringify which wraps in double quotes and escapes special chars.
 * @param {string} str
 * @returns {string}
 */
function shellQuote(str) {
  return JSON.stringify(str);
}
