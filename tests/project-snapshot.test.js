import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { buildProjectSnapshot } from '../plugins/helix-goals/lib/project-snapshot.js';

const TEST_BASE = join(import.meta.dirname, '__fixtures__', 'project-snapshot-test');
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test',
};

function initGitRepo(dir) {
  mkdirSync(dir, { recursive: true });
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe', env: gitEnv });
}

describe('buildProjectSnapshot', () => {
  beforeEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
    mkdirSync(TEST_BASE, { recursive: true });
  });

  afterEach(() => {
    rmSync(TEST_BASE, { recursive: true, force: true });
  });

  it('returns null snapshot for non-existent path', () => {
    const result = buildProjectSnapshot('/nonexistent/path');
    expect(result.snapshot).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('builds snapshot for a Node.js project', () => {
    const wsPath = join(TEST_BASE, 'node-project');
    initGitRepo(wsPath);

    // Create project files
    const pkg = { name: 'test-app', version: '1.0.0', dependencies: { express: '^4.0.0' } };
    writeFileSync(join(wsPath, 'package.json'), JSON.stringify(pkg, null, 2));
    writeFileSync(join(wsPath, 'README.md'), '# Test App\nA test application.');
    mkdirSync(join(wsPath, 'src'));
    writeFileSync(join(wsPath, 'src', 'index.js'), 'console.log("hello");');

    // Stage files so git ls-files returns them
    execSync('git add .', { cwd: wsPath, stdio: 'pipe' });
    execSync('git commit -m "add files"', { cwd: wsPath, stdio: 'pipe', env: gitEnv });

    const { snapshot, error } = buildProjectSnapshot(wsPath);
    expect(error).toBeUndefined();
    expect(snapshot).toBeTruthy();

    // Should contain tech stack detection
    expect(snapshot).toContain('Node.js');
    expect(snapshot).toContain('Express');

    // Should contain file tree
    expect(snapshot).toContain('File Tree');
    expect(snapshot).toContain('package.json');

    // Should contain key file contents
    expect(snapshot).toContain('test-app');
    expect(snapshot).toContain('README.md');
    expect(snapshot).toContain('A test application.');
  });

  it('detects Python tech stack', () => {
    const wsPath = join(TEST_BASE, 'python-project');
    initGitRepo(wsPath);

    writeFileSync(join(wsPath, 'pyproject.toml'), '[project]\nname = "myapp"\n');
    writeFileSync(join(wsPath, 'requirements.txt'), 'flask==2.0\n');
    execSync('git add .', { cwd: wsPath, stdio: 'pipe' });
    execSync('git commit -m "add files"', { cwd: wsPath, stdio: 'pipe', env: gitEnv });

    const { snapshot } = buildProjectSnapshot(wsPath);
    expect(snapshot).toContain('Python');
  });

  it('handles empty workspace gracefully', () => {
    const wsPath = join(TEST_BASE, 'empty-project');
    initGitRepo(wsPath);

    const { snapshot, error } = buildProjectSnapshot(wsPath);
    expect(error).toBeUndefined();
    expect(snapshot).toBeTruthy();
    expect(snapshot).toContain('Tech Stack: Unknown');
    expect(snapshot).toContain('NEW PROJECT');
    expect(snapshot).toContain('Foundation goal (Phase 1)');
  });

  it('truncates large files', () => {
    const wsPath = join(TEST_BASE, 'large-project');
    initGitRepo(wsPath);

    // Create a very large README
    const largeContent = 'x'.repeat(10000);
    writeFileSync(join(wsPath, 'README.md'), largeContent);
    execSync('git add .', { cwd: wsPath, stdio: 'pipe' });
    execSync('git commit -m "add files"', { cwd: wsPath, stdio: 'pipe', env: gitEnv });

    const { snapshot } = buildProjectSnapshot(wsPath);
    expect(snapshot).toContain('truncated');
    // Should not contain the full 10000 chars
    expect(snapshot.length).toBeLessThan(largeContent.length);
  });
});
