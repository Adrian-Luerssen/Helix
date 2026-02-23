import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { setupGitRemote, pushBranch } from '../plugins/helix-goals/lib/github.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'github-test');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "Initial commit"', {
    cwd: dir,
    stdio: 'pipe',
    env: GIT_ENV,
  });
}

describe('GitHub integration helpers', () => {
  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  describe('setupGitRemote', () => {
    it('adds origin remote when none exists', () => {
      const repoDir = join(TEST_DIR, 'repo1');
      initRepo(repoDir);

      setupGitRemote(repoDir, 'https://github.com/test/repo.git', 'test-token');

      const url = execSync('git remote get-url origin', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      expect(url).toBe('https://x-access-token:test-token@github.com/test/repo.git');
    });

    it('updates origin remote when one already exists', () => {
      const repoDir = join(TEST_DIR, 'repo2');
      initRepo(repoDir);
      execSync('git remote add origin https://old-url.com/repo.git', {
        cwd: repoDir,
        stdio: 'pipe',
      });

      setupGitRemote(repoDir, 'https://github.com/new/repo.git', 'new-token');

      const url = execSync('git remote get-url origin', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      expect(url).toBe('https://x-access-token:new-token@github.com/new/repo.git');
    });

    it('embeds token in URL correctly for github.com URLs', () => {
      const repoDir = join(TEST_DIR, 'repo3');
      initRepo(repoDir);

      setupGitRemote(repoDir, 'https://github.com/owner/project.git', 'ghp_abc123');

      const url = execSync('git remote get-url origin', {
        cwd: repoDir,
        encoding: 'utf-8',
      }).trim();
      expect(url).toContain('x-access-token:ghp_abc123@github.com');
    });
  });

  describe('pushBranch', () => {
    it('returns error when no remote is configured', () => {
      const repoDir = join(TEST_DIR, 'no-remote');
      initRepo(repoDir);

      const result = pushBranch(repoDir, 'master');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('returns error when remote is unreachable', () => {
      const repoDir = join(TEST_DIR, 'bad-remote');
      initRepo(repoDir);
      execSync('git remote add origin https://x-access-token:bad@github.com/no/exist.git', {
        cwd: repoDir,
        stdio: 'pipe',
      });

      const result = pushBranch(repoDir, 'master');
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('succeeds when pushing to a local bare remote', () => {
      // Create a bare remote repo
      const bareDir = join(TEST_DIR, 'bare.git');
      mkdirSync(bareDir, { recursive: true });
      execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });

      // Create a working repo with the bare as remote
      const repoDir = join(TEST_DIR, 'working');
      initRepo(repoDir);
      execSync(`git remote add origin ${bareDir}`, {
        cwd: repoDir,
        stdio: 'pipe',
      });

      const result = pushBranch(repoDir, 'master', { setUpstream: true });
      expect(result.ok).toBe(true);

      // Verify the push worked
      const log = execSync('git log --oneline', {
        cwd: bareDir,
        encoding: 'utf-8',
      }).trim();
      expect(log).toContain('Initial commit');
    });
  });

  describe('strands.create GitHub integration', () => {
    it('skips GitHub repo creation when no workspace ops', async () => {
      // Import handler factory
      const { createStrandHandlers } = await import(
        '../plugins/helix-goals/lib/strands-handlers.js'
      );
      const { createGoalsStore } = await import(
        '../plugins/helix-goals/lib/goals-store.js'
      );

      const store = createGoalsStore(join(TEST_DIR, 'store'));
      const handlers = createStrandHandlers(store);

      let result;
      await handlers['strands.create']({
        params: { name: 'NoGitHub' },
        respond: (ok, payload, error) => { result = { ok, payload, error }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.strand.workspace).toBeNull();
    });

    it('skips GitHub when workspace exists but no GitHub config in store', async () => {
      const { createStrandHandlers } = await import(
        '../plugins/helix-goals/lib/strands-handlers.js'
      );
      const { createGoalsStore } = await import(
        '../plugins/helix-goals/lib/goals-store.js'
      );
      const ws = await import(
        '../plugins/helix-goals/lib/workspace-manager.js'
      );

      const storeDir = join(TEST_DIR, 'store2');
      const wsDir = join(TEST_DIR, 'workspaces');
      mkdirSync(wsDir, { recursive: true });

      const store = createGoalsStore(storeDir);
      const handlers = createStrandHandlers(store, {
        wsOps: { dir: wsDir, ...ws },
      });

      let result;
      await handlers['strands.create']({
        params: { name: 'NoGitHubConfig' },
        respond: (ok, payload, error) => { result = { ok, payload, error }; },
      });

      expect(result.ok).toBe(true);
      expect(result.payload.strand.workspace).not.toBeNull();
      expect(result.payload.strand.workspace.path).toBeTruthy();
      // No repoUrl since no GitHub config
      expect(result.payload.strand.workspace.repoUrl).toBeNull();
    });

    it('skips GitHub when repoUrl is explicitly provided (clone mode)', async () => {
      const { createStrandHandlers } = await import(
        '../plugins/helix-goals/lib/strands-handlers.js'
      );
      const { createGoalsStore } = await import(
        '../plugins/helix-goals/lib/goals-store.js'
      );

      // Create a bare repo to clone from
      const bareDir = join(TEST_DIR, 'source.git');
      mkdirSync(bareDir, { recursive: true });
      execSync('git init --bare', { cwd: bareDir, stdio: 'pipe' });
      // Need at least one commit for clone to work
      const tmpDir = join(TEST_DIR, 'tmp-src');
      mkdirSync(tmpDir, { recursive: true });
      execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
      execSync(`git remote add origin ${bareDir}`, { cwd: tmpDir, stdio: 'pipe' });
      execSync('git commit --allow-empty -m "init"', { cwd: tmpDir, stdio: 'pipe', env: GIT_ENV });
      execSync('git push -u origin master', { cwd: tmpDir, stdio: 'pipe' });

      const ws = await import(
        '../plugins/helix-goals/lib/workspace-manager.js'
      );

      const storeDir = join(TEST_DIR, 'store3');
      const wsDir = join(TEST_DIR, 'workspaces3');
      mkdirSync(wsDir, { recursive: true });

      const store = createGoalsStore(storeDir);

      // Pre-configure GitHub in the store so we can verify it's skipped when repoUrl is given
      const data = store.load();
      data.config.services = {
        github: {
          authMode: 'account',
          agentToken: 'fake-token',
          agentUsername: 'fake-user',
        },
      };
      store.save(data);

      const handlers = createStrandHandlers(store, {
        wsOps: { dir: wsDir, ...ws },
      });

      let result;
      await handlers['strands.create']({
        params: { name: 'ClonedRepo', repoUrl: bareDir },
        respond: (ok, payload, error) => { result = { ok, payload, error }; },
      });

      expect(result.ok).toBe(true);
      // repoUrl is set to the provided URL, NOT a GitHub URL
      expect(result.payload.strand.workspace.repoUrl).toBe(bareDir);
      // No githubFullName since we didn't create a GitHub repo
      expect(result.payload.strand.workspace.githubFullName).toBeUndefined();
    });
  });
});
