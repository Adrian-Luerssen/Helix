// tests/learning.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createClassificationLog } from '../plugins/helix-goals/lib/classification-log.js';
import { createGoalsStore } from '../plugins/helix-goals/lib/goals-store.js';
import { analyzeCorrections, applyLearning } from '../plugins/helix-goals/lib/learning.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'learning-test');

describe('Learning', () => {
  let log, store;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    log = createClassificationLog(TEST_DIR);
    store = createGoalsStore(TEST_DIR);

    // Seed a strand
    const data = store.load();
    data.strands.push({
      id: 'strand:system', name: 'System', description: '', color: null,
      keywords: ['infra'], telegramTopicIds: [], createdAtMs: Date.now(), updatedAtMs: Date.now(),
    });
    store.save(data);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('extracts keywords from corrections', () => {
    // Simulate: messages were misrouted, corrected to strand:system
    const e1 = log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'strand:other', confidence: 0.5 });
    const e2 = log.append({ sessionKey: 's2', tier: 1, predictedStrand: 'strand:other', confidence: 0.5 });
    log.recordFeedback(e1.id, { accepted: false, correctedTo: 'strand:system' });
    log.recordFeedback(e2.id, { accepted: false, correctedTo: 'strand:system' });

    const suggestions = analyzeCorrections(log);
    expect(suggestions).toBeInstanceOf(Array);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].strandId).toBe('strand:system');
    expect(suggestions[0].correctionCount).toBe(2);
  });

  it('requires 2+ corrections to suggest', () => {
    const e1 = log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'strand:other', confidence: 0.5 });
    log.recordFeedback(e1.id, { accepted: false, correctedTo: 'strand:system' });

    const suggestions = analyzeCorrections(log);
    expect(suggestions).toHaveLength(0);
  });

  it('applyLearning adds keywords to strands', () => {
    const suggestions = [{ strandId: 'strand:system', suggestedKeywords: ['scraper', 'deploy'] }];
    const applied = applyLearning(store, suggestions);
    expect(applied).toHaveLength(1);
    expect(applied[0].addedKeywords).toContain('scraper');

    const data = store.load();
    const strand = data.strands.find(c => c.id === 'strand:system');
    expect(strand.keywords).toContain('scraper');
    expect(strand.keywords).toContain('infra'); // Existing preserved
  });

  it('applyLearning skips unknown strands', () => {
    const suggestions = [{ strandId: 'strand:nonexistent', suggestedKeywords: ['foo'] }];
    const applied = applyLearning(store, suggestions);
    expect(applied).toHaveLength(0);
  });

  it('applyLearning dryRun does not save', () => {
    const suggestions = [{ strandId: 'strand:system', suggestedKeywords: ['test'] }];
    const applied = applyLearning(store, suggestions, true);
    expect(applied).toHaveLength(1);

    const data = store.load();
    const strand = data.strands.find(c => c.id === 'strand:system');
    expect(strand.keywords).not.toContain('test');
  });
});
