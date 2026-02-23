import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createChatIndex } from '../lib/chat-index.js';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import crypto from 'crypto';

const TEST_DIR = join(tmpdir(), 'helix-test-chat-' + crypto.randomBytes(4).toString('hex'));
const DB_PATH = join(TEST_DIR, 'chat-index.db');

const nullProvider = {
  embed: async () => null,
  getDimensions: () => 1536,
  getProviderName: () => 'none',
  isAvailable: () => false,
};

const silentLogger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

describe('createChatIndex', () => {
  let idx;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (idx) { idx.close(); idx = null; }
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('initializes and creates DB', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();
    expect(existsSync(DB_PATH)).toBe(true);
    const stats = idx.getStats();
    expect(stats.initialized).toBe(true);
    expect(stats.sessionCount).toBe(0);
    expect(stats.chunkCount).toBe(0);
  });

  it('indexes a session', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    idx.indexSession('agent:main:main', [
      { role: 'user', content: 'How do I configure the tick spacing?' },
      { role: 'assistant', content: 'The tick spacing controls pool granularity. Set it in the params config.' },
    ], { displayName: 'Main Session' });

    const stats = idx.getStats();
    expect(stats.sessionCount).toBe(1);
    expect(stats.chunkCount).toBe(1);
  });

  it('skips indexing unchanged content', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    const messages = [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there!' },
    ];

    idx.indexSession('agent:main:main', messages, {});
    const stats1 = idx.getStats();

    // Index again with same content
    idx.indexSession('agent:main:main', messages, {});
    const stats2 = idx.getStats();

    expect(stats1.chunkCount).toBe(stats2.chunkCount);
  });

  it('re-indexes when content changes', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    idx.indexSession('agent:main:main', [
      { role: 'user', content: 'First message' },
    ], {});

    idx.indexSession('agent:main:main', [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'Second message added' },
    ], {});

    const stats = idx.getStats();
    expect(stats.sessionCount).toBe(1);
  });

  it('searches indexed content with FTS5', async () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    idx.indexSession('agent:main:main', [
      { role: 'user', content: 'How do I configure the tick spacing for Uniswap pools?' },
      { role: 'assistant', content: 'The tick spacing parameter determines the granularity of price ranges.' },
    ], { displayName: 'Uniswap Config' });

    idx.indexSession('agent:codex:main', [
      { role: 'user', content: 'Write a poem about cats' },
      { role: 'assistant', content: 'Whiskers twitch in moonlight glow' },
    ], { displayName: 'Poetry Session' });

    const results = await idx.search('tick spacing');
    expect(results.length).toBe(1);
    expect(results[0].sessionKey).toBe('agent:main:main');
    expect(results[0].snippet).toBeTruthy();
    expect(results[0].source).toBe('chat');
  });

  it('deduplicates results by session', async () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    // Index a session with repeated terms across chunks
    const messages = [];
    for (let i = 0; i < 10; i++) {
      messages.push({ role: 'user', content: `The search keyword appears in message ${i}` });
    }
    idx.indexSession('agent:main:main', messages, {});

    const results = await idx.search('search keyword');
    // All results should be from the same session, deduplicated to 1
    expect(results.length).toBe(1);
    expect(results[0].sessionKey).toBe('agent:main:main');
  });

  it('returns empty for no match', async () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    idx.indexSession('agent:main:main', [
      { role: 'user', content: 'Hello world' },
    ], {});

    const results = await idx.search('xyznonexistent');
    expect(results).toHaveLength(0);
  });

  it('returns stats correctly', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    expect(idx.getStats().initialized).toBe(false);

    idx.init();
    expect(idx.getStats().initialized).toBe(true);
    expect(idx.getStats().syncing).toBe(false);
  });

  it('handles multiple sessions', async () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();

    for (let i = 0; i < 5; i++) {
      idx.indexSession(`agent:main:session${i}`, [
        { role: 'user', content: `Unique content for session ${i}` },
      ], { displayName: `Session ${i}` });
    }

    const stats = idx.getStats();
    expect(stats.sessionCount).toBe(5);

    const results = await idx.search('session 3');
    expect(results.length).toBeGreaterThan(0);
  });

  it('close is idempotent', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();
    idx.close();
    idx.close(); // should not throw
    idx = null;
  });

  it('handles empty messages gracefully', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();
    idx.indexSession('agent:main:main', [], {});
    expect(idx.getStats().sessionCount).toBe(0);
  });

  it('handles messages with empty content', () => {
    idx = createChatIndex({ dbPath: DB_PATH, embeddingProvider: nullProvider, logger: silentLogger });
    idx.init();
    idx.indexSession('agent:main:main', [
      { role: 'user', content: '' },
      { role: 'assistant', content: '   ' },
    ], {});
    // Session is created but no chunks since all messages are empty/whitespace
    const stats = idx.getStats();
    expect(stats.sessionCount).toBe(1);
    expect(stats.chunkCount).toBe(0);
  });
});
