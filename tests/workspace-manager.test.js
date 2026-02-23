import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import {
  sanitizeDirName,
  strandWorkspacePath,
  goalWorktreePath,
  goalBranchName,
  createStrandWorkspace,
  createGoalWorktree,
  removeGoalWorktree,
  removeStrandWorkspace,
  getMainBranch,
  mergeGoalBranch,
  checkBranchStatus,
} from '../plugins/helix-goals/lib/workspace-manager.js';

const TEST_BASE = join(import.meta.dirname, '__fixtures__', 'workspace-manager-test');

describe('workspace-manager', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
    mkdirSync(TEST_BASE, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
  });

  // ── sanitizeDirName ──────────────────────────────────────────────

  describe('sanitizeDirName', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(sanitizeDirName('My Cool Project')).toBe('my-cool-project');
    });

    it('strips leading/trailing hyphens', () => {
      expect(sanitizeDirName('  --Hello World-- ')).toBe('hello-world');
    });

    it('collapses multiple non-alphanumeric characters', () => {
      expect(sanitizeDirName('foo!!!bar___baz')).toBe('foo-bar-baz');
    });

    it('truncates to 60 characters', () => {
      const long = 'a'.repeat(100);
      expect(sanitizeDirName(long).length).toBeLessThanOrEqual(60);
    });

    it('returns "workspace" for empty or all-special input', () => {
      expect(sanitizeDirName('---')).toBe('workspace');
      expect(sanitizeDirName('')).toBe('workspace');
    });
  });

  // ── path builders ────────────────────────────────────────────────

  describe('strandWorkspacePath', () => {
    it('builds path with slug and id suffix', () => {
      const result = strandWorkspacePath('/workspaces', 'strand_abcdef12', 'My Project');
      expect(result).toBe('/workspaces/my-project-abcdef12');
    });

    it('uses first 8 chars of id after strand_ prefix', () => {
      const result = strandWorkspacePath('/ws', 'strand_1234567890abcdef', 'Test');
      expect(result).toBe('/ws/test-12345678');
    });
  });

  describe('goalWorktreePath', () => {
    it('builds path under goals/ subdirectory', () => {
      expect(goalWorktreePath('/ws/project', 'goal_xyz')).toBe('/ws/project/goals/goal_xyz');
    });
  });

  describe('goalBranchName', () => {
    it('prefixes with goal/ using ID when no title provided', () => {
      expect(goalBranchName('goal_abc123')).toBe('goal/goal_abc123');
    });

    it('uses slugified title when title is provided', () => {
      expect(goalBranchName('goal_abc123', 'Project Foundation')).toBe('goal/project-foundation');
    });

    it('falls back to ID when title is empty', () => {
      expect(goalBranchName('goal_abc123', '')).toBe('goal/goal_abc123');
    });
  });

  // ── createStrandWorkspace ─────────────────────────────────────────

  describe('createStrandWorkspace', () => {
    it('creates a git-initialized workspace with empty initial commit', () => {
      const result = createStrandWorkspace(TEST_BASE, 'strand_abc123', 'Test Workspace');
      expect(result.ok).toBe(true);
      expect(result.path).toBeTruthy();
      expect(existsSync(result.path)).toBe(true);
      expect(result.existed).toBeUndefined();

      // Verify it's a git repo
      const gitDir = join(result.path, '.git');
      expect(existsSync(gitDir)).toBe(true);

      // Verify there is at least one commit (HEAD exists)
      const log = execSync('git log --oneline -1', { cwd: result.path, encoding: 'utf-8' });
      expect(log).toContain('Initial commit');

      // Verify goals/ subdirectory exists
      expect(existsSync(join(result.path, 'goals'))).toBe(true);
    });

    it('is idempotent — returns existed: true for existing directory', () => {
      const first = createStrandWorkspace(TEST_BASE, 'strand_idem', 'Idempotent');
      expect(first.ok).toBe(true);

      const second = createStrandWorkspace(TEST_BASE, 'strand_idem', 'Idempotent');
      expect(second.ok).toBe(true);
      expect(second.existed).toBe(true);
      expect(second.path).toBe(first.path);
    });

    it('creates base directory if it does not exist', () => {
      const nestedBase = join(TEST_BASE, 'nested', 'deep');
      expect(existsSync(nestedBase)).toBe(false);

      const result = createStrandWorkspace(nestedBase, 'strand_nested', 'Nested');
      expect(result.ok).toBe(true);
      expect(existsSync(result.path)).toBe(true);
    });

    it('returns error for invalid clone URL without throwing', () => {
      const result = createStrandWorkspace(TEST_BASE, 'strand_bad', 'Bad Clone', 'not-a-valid-url');
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── createGoalWorktree ───────────────────────────────────────────

  describe('createGoalWorktree', () => {
    let strandWs;

    beforeEach(() => {
      const r = createStrandWorkspace(TEST_BASE, 'strand_wt', 'Worktree Test');
      strandWs = r.path;
    });

    it('creates a worktree with ID-based branch when no title given', () => {
      const result = createGoalWorktree(strandWs, 'goal_abc');
      expect(result.ok).toBe(true);
      expect(result.branch).toBe('goal/goal_abc');
      expect(existsSync(result.path)).toBe(true);

      const branches = execSync('git branch --list', { cwd: strandWs, encoding: 'utf-8' });
      expect(branches).toContain('goal/goal_abc');
    });

    it('creates a worktree with readable branch name from title', () => {
      const result = createGoalWorktree(strandWs, 'goal_abc', 'Project Foundation');
      expect(result.ok).toBe(true);
      expect(result.branch).toBe('goal/project-foundation');
      expect(existsSync(result.path)).toBe(true);

      const branches = execSync('git branch --list', { cwd: strandWs, encoding: 'utf-8' });
      expect(branches).toContain('goal/project-foundation');
    });

    it('appends ID suffix on branch name conflict', () => {
      const r1 = createGoalWorktree(strandWs, 'goal_111111', 'Setup');
      expect(r1.ok).toBe(true);
      expect(r1.branch).toBe('goal/setup');

      // Second goal with the same title but different ID
      const r2 = createGoalWorktree(strandWs, 'goal_222222', 'Setup');
      expect(r2.ok).toBe(true);
      expect(r2.branch).toBe('goal/setup-222222');

      const branches = execSync('git branch --list', { cwd: strandWs, encoding: 'utf-8' });
      expect(branches).toContain('goal/setup');
      expect(branches).toContain('goal/setup-222222');
    });

    it('creates multiple independent worktrees', () => {
      const r1 = createGoalWorktree(strandWs, 'goal_one', 'First Goal');
      const r2 = createGoalWorktree(strandWs, 'goal_two', 'Second Goal');
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(r1.path).not.toBe(r2.path);

      const branches = execSync('git branch --list', { cwd: strandWs, encoding: 'utf-8' });
      expect(branches).toContain('goal/first-goal');
      expect(branches).toContain('goal/second-goal');
    });

    it('is idempotent — returns existed: true if worktree already exists', () => {
      createGoalWorktree(strandWs, 'goal_idem');
      const second = createGoalWorktree(strandWs, 'goal_idem');
      expect(second.ok).toBe(true);
      expect(second.existed).toBe(true);
    });

    it('returns error for invalid strandWs without throwing', () => {
      const result = createGoalWorktree('/nonexistent/path', 'goal_bad');
      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  // ── removeGoalWorktree ───────────────────────────────────────────

  describe('removeGoalWorktree', () => {
    let strandWs;

    beforeEach(() => {
      const r = createStrandWorkspace(TEST_BASE, 'strand_rm', 'Remove Test');
      strandWs = r.path;
    });

    it('removes an existing worktree and its branch', () => {
      createGoalWorktree(strandWs, 'goal_del');
      const wtPath = goalWorktreePath(strandWs, 'goal_del');
      expect(existsSync(wtPath)).toBe(true);

      const result = removeGoalWorktree(strandWs, 'goal_del');
      expect(result.ok).toBe(true);
      expect(existsSync(wtPath)).toBe(false);

      // Branch should be cleaned up
      const branches = execSync('git branch --list', { cwd: strandWs, encoding: 'utf-8' });
      expect(branches).not.toContain('goal/goal_del');
    });

    it('removes worktree using stored branch name', () => {
      const wt = createGoalWorktree(strandWs, 'goal_stored', 'My Feature');
      expect(wt.ok).toBe(true);
      expect(wt.branch).toBe('goal/my-feature');

      const result = removeGoalWorktree(strandWs, 'goal_stored', wt.branch);
      expect(result.ok).toBe(true);

      const branches = execSync('git branch --list', { cwd: strandWs, encoding: 'utf-8' });
      expect(branches).not.toContain('goal/my-feature');
    });

    it('succeeds even if worktree does not exist (no-op)', () => {
      const result = removeGoalWorktree(strandWs, 'goal_nonexistent');
      expect(result.ok).toBe(true);
    });
  });

  // ── removeStrandWorkspace ─────────────────────────────────────────

  describe('removeStrandWorkspace', () => {
    it('removes the entire workspace directory', () => {
      const r = createStrandWorkspace(TEST_BASE, 'strand_nuke', 'Nuke Me');
      expect(existsSync(r.path)).toBe(true);

      const result = removeStrandWorkspace(r.path);
      expect(result.ok).toBe(true);
      expect(existsSync(r.path)).toBe(false);
    });

    it('succeeds if directory does not exist (no-op)', () => {
      const result = removeStrandWorkspace(join(TEST_BASE, 'nonexistent'));
      expect(result.ok).toBe(true);
    });
  });

  // ── getMainBranch ──────────────────────────────────────────────

  describe('getMainBranch', () => {
    it('detects the main branch of a new repo', () => {
      const r = createStrandWorkspace(TEST_BASE, 'strand_main', 'Main Test');
      const branch = getMainBranch(r.path);
      // git init creates either 'main' or 'master' depending on git config
      expect(['main', 'master']).toContain(branch);
    });
  });

  // ── mergeGoalBranch ────────────────────────────────────────────

  describe('mergeGoalBranch', () => {
    let strandWs;

    beforeEach(() => {
      const r = createStrandWorkspace(TEST_BASE, 'strand_merge', 'Merge Test');
      strandWs = r.path;
    });

    it('merges a non-conflicting branch into main', () => {
      const wt = createGoalWorktree(strandWs, 'goal_m1', 'Feature A');
      expect(wt.ok).toBe(true);

      // Make a commit on the goal branch
      execSync(`echo "hello" > feature.txt && git add feature.txt && git commit -m "add feature"`, {
        cwd: wt.path,
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test' },
      });

      const result = mergeGoalBranch(strandWs, wt.branch);
      expect(result.ok).toBe(true);
      expect(result.merged).toBe(true);

      // Verify the file exists on main
      expect(existsSync(join(strandWs, 'feature.txt'))).toBe(true);
    });

    it('detects merge conflicts and aborts', () => {
      const wt = createGoalWorktree(strandWs, 'goal_conflict', 'Conflict Goal');
      expect(wt.ok).toBe(true);

      const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test' };

      // Make a commit on main with a file
      execSync(`echo "main content" > shared.txt && git add shared.txt && git commit -m "main change"`, {
        cwd: strandWs,
        stdio: 'pipe',
        env: gitEnv,
      });

      // Make a conflicting commit on the goal branch with the same file
      execSync(`echo "branch content" > shared.txt && git add shared.txt && git commit -m "branch change"`, {
        cwd: wt.path,
        stdio: 'pipe',
        env: gitEnv,
      });

      const result = mergeGoalBranch(strandWs, wt.branch);
      expect(result.ok).toBe(false);
      expect(result.conflict).toBe(true);
    });
  });

  // ── checkBranchStatus ──────────────────────────────────────────

  describe('checkBranchStatus', () => {
    let strandWs;

    beforeEach(() => {
      const r = createStrandWorkspace(TEST_BASE, 'strand_status', 'Status Test');
      strandWs = r.path;
    });

    it('reports ahead count for a branch with commits', () => {
      const wt = createGoalWorktree(strandWs, 'goal_ahead', 'Ahead Branch');
      expect(wt.ok).toBe(true);

      // Make a commit on the goal branch
      execSync(`echo "new" > newfile.txt && git add newfile.txt && git commit -m "ahead"`, {
        cwd: wt.path,
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test' },
      });

      const status = checkBranchStatus(strandWs, wt.branch);
      expect(status.ok).toBe(true);
      expect(status.aheadOfMain).toBe(1);
      expect(status.behindMain).toBe(0);
    });

    it('reports behind count when main has diverged', () => {
      const wt = createGoalWorktree(strandWs, 'goal_behind', 'Behind Branch');
      expect(wt.ok).toBe(true);

      // Make a commit on main
      execSync(`echo "main" > mainfile.txt && git add mainfile.txt && git commit -m "main ahead"`, {
        cwd: strandWs,
        stdio: 'pipe',
        env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@test' },
      });

      const status = checkBranchStatus(strandWs, wt.branch);
      expect(status.ok).toBe(true);
      expect(status.behindMain).toBe(1);
      expect(status.aheadOfMain).toBe(0);
    });

    it('returns error for non-existent branch', () => {
      const status = checkBranchStatus(strandWs, 'goal/nonexistent');
      expect(status.ok).toBe(false);
      expect(status.error).toBeTruthy();
    });
  });
});
