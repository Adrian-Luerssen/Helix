// tests/classification-log.test.js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createClassificationLog } from '../plugins/helix-goals/lib/classification-log.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'classification-log-test');

describe('ClassificationLog', () => {
  let log;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    log = createClassificationLog(TEST_DIR);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('starts with empty entries', () => {
    const data = log.load();
    expect(data.entries).toEqual([]);
  });

  it('appends a classification entry', () => {
    const entry = log.append({
      sessionKey: 'agent:main:telegram:123',
      tier: 1,
      predictedStrand: 'strand:subastas',
      confidence: 0.9,
      reasoning: 'kw:subastas',
    });
    expect(entry.id).toMatch(/^clf_/);
    expect(entry.timestamp).toBeTypeOf('number');

    const data = log.load();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].predictedStrand).toBe('strand:subastas');
  });

  it('records feedback on an entry', () => {
    const entry = log.append({
      sessionKey: 's1',
      tier: 1,
      predictedStrand: 'strand:a',
      confidence: 0.8,
    });
    const updated = log.recordFeedback(entry.id, { accepted: false, correctedTo: 'strand:b' });
    expect(updated.accepted).toBe(false);
    expect(updated.correctedTo).toBe('strand:b');
    expect(updated.feedbackMs).toBeTypeOf('number');
  });

  it('getCorrections returns only corrected entries', () => {
    log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'a', confidence: 0.8 });
    const e2 = log.append({ sessionKey: 's2', tier: 1, predictedStrand: 'a', confidence: 0.7 });
    log.recordFeedback(e2.id, { accepted: false, correctedTo: 'b' });

    const corrections = log.getCorrections();
    expect(corrections).toHaveLength(1);
    expect(corrections[0].correctedTo).toBe('b');
  });

  it('getStats computes accuracy', () => {
    const e1 = log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'a', confidence: 0.9 });
    const e2 = log.append({ sessionKey: 's2', tier: 1, predictedStrand: 'a', confidence: 0.8 });
    const e3 = log.append({ sessionKey: 's3', tier: 1, predictedStrand: 'a', confidence: 0.7 });
    log.recordFeedback(e1.id, { accepted: true });
    log.recordFeedback(e2.id, { accepted: true });
    log.recordFeedback(e3.id, { accepted: false, correctedTo: 'b' });

    const stats = log.getStats();
    expect(stats.total).toBe(3);
    expect(stats.withFeedback).toBe(3);
    expect(stats.accepted).toBe(2);
    expect(stats.corrected).toBe(1);
    expect(stats.accuracy).toBeCloseTo(2 / 3);
  });

  it('trims entries beyond max', () => {
    for (let i = 0; i < 105; i++) {
      log.append({ sessionKey: `s${i}`, tier: 1, predictedStrand: 'a', confidence: 0.5 });
    }
    // Default max is 1000, but let's check it doesn't blow up
    const data = log.load();
    expect(data.entries.length).toBeLessThanOrEqual(1000);
  });

  it('persists across reload', () => {
    log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'a', confidence: 0.8 });
    const fresh = createClassificationLog(TEST_DIR);
    expect(fresh.load().entries).toHaveLength(1);
  });

  describe('recordReclassification', () => {
    it('updates existing classification entry when match found', () => {
      const entry = log.append({
        sessionKey: 'agent:main:telegram:123',
        tier: 1,
        predictedStrand: 'strand:old',
        confidence: 0.85,
        reasoning: 'kw:test',
      });

      const updated = log.recordReclassification('agent:main:telegram:123', 'strand:old', 'strand:new');
      expect(updated.id).toBe(entry.id);
      expect(updated.accepted).toBe(false);
      expect(updated.correctedTo).toBe('strand:new');
      expect(updated.feedbackMs).toBeTypeOf('number');

      // Verify persisted
      const data = log.load();
      const persisted = data.entries.find(e => e.id === entry.id);
      expect(persisted.accepted).toBe(false);
      expect(persisted.correctedTo).toBe('strand:new');
    });

    it('finds the most recent matching entry (not the first)', () => {
      log.append({
        sessionKey: 'agent:main:telegram:123',
        tier: 1,
        predictedStrand: 'strand:old',
        confidence: 0.7,
        reasoning: 'first',
      });
      const second = log.append({
        sessionKey: 'agent:main:telegram:123',
        tier: 1,
        predictedStrand: 'strand:old',
        confidence: 0.9,
        reasoning: 'second',
      });

      const updated = log.recordReclassification('agent:main:telegram:123', 'strand:old', 'strand:new');
      expect(updated.id).toBe(second.id);
      expect(updated.reasoning).toBe('second');
    });

    it('creates synthetic correction entry when no match found', () => {
      // No entries for this session
      const synth = log.recordReclassification('agent:new:session', 'strand:old', 'strand:new');
      expect(synth.id).toMatch(/^clf_/);
      expect(synth.tier).toBe(0);
      expect(synth.predictedStrand).toBe('strand:old');
      expect(synth.correctedTo).toBe('strand:new');
      expect(synth.accepted).toBe(false);
      expect(synth.reasoning).toBe('reclassification');

      // Verify persisted
      const data = log.load();
      expect(data.entries).toHaveLength(1);
      expect(data.entries[0].tier).toBe(0);
    });

    it('creates synthetic when session exists but predicted strand does not match', () => {
      log.append({
        sessionKey: 'agent:main:telegram:123',
        tier: 1,
        predictedStrand: 'strand:other',
        confidence: 0.9,
      });

      const synth = log.recordReclassification('agent:main:telegram:123', 'strand:old', 'strand:new');
      // Should not match the existing entry (different predictedStrand)
      expect(synth.tier).toBe(0); // synthetic
      expect(synth.predictedStrand).toBe('strand:old');

      const data = log.load();
      expect(data.entries).toHaveLength(2); // original + synthetic
    });
  });

  it('recordFeedback returns null for missing entry', () => {
    log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'a', confidence: 0.8 });
    const result = log.recordFeedback('clf_nonexistent', { accepted: true });
    expect(result).toBeNull();
  });

  it('getCorrections filters by sinceMs', () => {
    const e1 = log.append({ sessionKey: 's1', tier: 1, predictedStrand: 'a', confidence: 0.8 });
    log.recordFeedback(e1.id, { accepted: false, correctedTo: 'b' });

    const e2 = log.append({ sessionKey: 's2', tier: 1, predictedStrand: 'a', confidence: 0.7 });
    log.recordFeedback(e2.id, { accepted: false, correctedTo: 'c' });

    // All corrections (sinceMs=0)
    expect(log.getCorrections(0)).toHaveLength(2);

    // No corrections from the future
    expect(log.getCorrections(Date.now() + 100000)).toHaveLength(0);

    // Verify the filter uses strict > comparison
    const data = log.load();
    const minFeedbackMs = Math.min(...data.entries.filter(e => e.feedbackMs).map(e => e.feedbackMs));
    // sinceMs equal to earliest feedbackMs should exclude it (> not >=)
    const filtered = log.getCorrections(minFeedbackMs);
    expect(filtered.length).toBeLessThan(2);
  });

  describe('_loadError protection', () => {
    it('refuses to save when load encountered an error', () => {
      // Write corrupt JSON to the file
      writeFileSync(join(TEST_DIR, 'classification-log.json'), '{corrupt');

      const corruptLog = createClassificationLog(TEST_DIR);
      const data = corruptLog.load();
      expect(data._loadError).toBeTruthy();
      expect(data.entries).toEqual([]);

      // Attempting to save should throw
      expect(() => corruptLog.save(data)).toThrow('Refusing to save');
    });
  });

  describe('append nullish coalescing', () => {
    it('preserves tier:0 instead of defaulting to 1', () => {
      const entry = log.append({
        sessionKey: 's1',
        tier: 0,
        predictedStrand: null,
        confidence: 0,
      });
      expect(entry.tier).toBe(0);
    });

    it('preserves confidence:0 instead of defaulting', () => {
      const entry = log.append({
        sessionKey: 's1',
        tier: 1,
        predictedStrand: 'a',
        confidence: 0,
      });
      expect(entry.confidence).toBe(0);
    });

    it('preserves empty string reasoning', () => {
      const entry = log.append({
        sessionKey: 's1',
        tier: 1,
        predictedStrand: 'a',
        confidence: 0.5,
        reasoning: '',
      });
      expect(entry.reasoning).toBe('');
    });
  });
});
