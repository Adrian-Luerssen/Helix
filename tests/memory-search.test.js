import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMemorySearch } from '../lib/memory-search.js';
import Database from 'better-sqlite3';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

const TEST_DIR = join(tmpdir(), 'helix-test-memory-' + crypto.randomBytes(4).toString('hex'));
const MEMORY_DIR = join(TEST_DIR, 'memory');

function createTestDb(agentId, chunks = []) {
  const dbPath = join(MEMORY_DIR, `${agentId}.sqlite`);
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE chunks (
      id INTEGER PRIMARY KEY,
      path TEXT,
      source TEXT,
      start_line INTEGER,
      end_line INTEGER,
      hash TEXT,
      model TEXT,
      text TEXT,
      embedding BLOB,
      updated_at TEXT
    );
    CREATE TABLE files (path TEXT PRIMARY KEY, source TEXT, hash TEXT, mtime TEXT, size INTEGER);
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  db.exec(`CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id');`);

  const insert = db.prepare('INSERT INTO chunks (path, source, start_line, end_line, text) VALUES (?, ?, ?, ?, ?)');
  const insertFts = db.prepare('INSERT INTO chunks_fts(rowid, text) VALUES (?, ?)');

  for (const chunk of chunks) {
    const result = insert.run(chunk.path, chunk.source || 'file', chunk.startLine || 1, chunk.endLine || 10, chunk.text);
    insertFts.run(result.lastInsertRowid, chunk.text);
  }

  db.close();
  return dbPath;
}

describe('createMemorySearch', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(MEMORY_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('initializes and discovers DBs', () => {
    createTestDb('main', [
      { path: 'src/app.ts', text: 'function hello() { return "world"; }' },
    ]);

    const ms = createMemorySearch({
      stateDir: TEST_DIR,
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    ms.init();
    const dbs = ms.getAgentDbs();
    expect(dbs).toHaveLength(1);
    expect(dbs[0].agentId).toBe('main');
    expect(dbs[0].hasFts).toBe(true);
    ms.close();
  });

  it('handles missing memory directory', () => {
    const ms = createMemorySearch({
      stateDir: join(TEST_DIR, 'nonexistent'),
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    ms.init();
    expect(ms.getAgentDbs()).toHaveLength(0);
    ms.close();
  });

  it('searches with FTS5 keyword matching', async () => {
    createTestDb('main', [
      { path: 'src/amm/params.ts', text: 'The tick spacing parameter controls pool granularity' },
      { path: 'src/amm/swap.ts', text: 'Swap logic with slippage protection' },
      { path: 'src/utils/math.ts', text: 'Mathematical helper functions for precision arithmetic' },
    ]);

    const ms = createMemorySearch({
      stateDir: TEST_DIR,
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    ms.init();
    const results = await ms.search('tick spacing');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toBe('src/amm/params.ts');
    expect(results[0].agentId).toBe('main');
    expect(results[0].snippet).toContain('tick spacing');
    ms.close();
  });

  it('searches across multiple agent DBs', async () => {
    createTestDb('main', [
      { path: 'src/main.ts', text: 'Main agent entry point for the application' },
    ]);
    createTestDb('codex', [
      { path: 'docs/api.md', text: 'API documentation for the codex service' },
    ]);

    const ms = createMemorySearch({
      stateDir: TEST_DIR,
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    ms.init();
    expect(ms.getAgentDbs()).toHaveLength(2);

    const results = await ms.search('documentation');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].agentId).toBe('codex');
    ms.close();
  });

  it('returns empty for no match', async () => {
    createTestDb('main', [
      { path: 'src/app.ts', text: 'Hello world application' },
    ]);

    const ms = createMemorySearch({
      stateDir: TEST_DIR,
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    ms.init();
    const results = await ms.search('xyznonexistent');
    expect(results).toHaveLength(0);
    ms.close();
  });

  it('respects limit option', async () => {
    const chunks = [];
    for (let i = 0; i < 20; i++) {
      chunks.push({ path: `src/file${i}.ts`, text: `Module number ${i} with common keyword search` });
    }
    createTestDb('main', chunks);

    const ms = createMemorySearch({
      stateDir: TEST_DIR,
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });

    ms.init();
    const results = await ms.search('search', { limit: 5 });
    expect(results.length).toBe(5);
    ms.close();
  });

  it('close is idempotent', () => {
    const ms = createMemorySearch({
      stateDir: TEST_DIR,
      embeddingProvider: null,
      logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    });
    ms.init();
    ms.close();
    ms.close(); // should not throw
  });
});
