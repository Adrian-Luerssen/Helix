import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { createGoalsStore } from '../plugins/helix-goals/lib/goals-store.js';
import { createStrandHandlers } from '../plugins/helix-goals/lib/strands-handlers.js';
import { createGoalHandlers } from '../plugins/helix-goals/lib/goals-handlers.js';

const TEST_DIR = join(import.meta.dirname, '__fixtures__', 'strands-handlers-test');

function makeResponder() {
  let result = null;
  const respond = (ok, payload, error) => { result = { ok, payload, error }; };
  return { respond, getResult: () => result };
}

/** Helper: create a strand and return its full object */
function createStrand(handlers, params) {
  const { respond, getResult } = makeResponder();
  handlers['strands.create']({ params, respond });
  const r = getResult();
  if (!r.ok) throw new Error(`createStrand failed: ${r.error?.message}`);
  return r.payload.strand;
}

/** Helper: create a goal and return its full object */
function createGoal(goalHandlers, params) {
  const { respond, getResult } = makeResponder();
  goalHandlers['goals.create']({ params, respond });
  const r = getResult();
  if (!r.ok) throw new Error(`createGoal failed: ${r.error?.message}`);
  return r.payload.goal;
}

describe('StrandHandlers', () => {
  let store, handlers, goalHandlers;

  beforeEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    mkdirSync(TEST_DIR, { recursive: true });
    store = createGoalsStore(TEST_DIR);
    handlers = createStrandHandlers(store);
    goalHandlers = createGoalHandlers(store);
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  // ─── strands.create ────────────────────────────────────────────────

  describe('strands.create', () => {
    it('creates a strand with required fields', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: { name: 'GenLayer' }, respond });
      const r = getResult();
      expect(r.ok).toBe(true);
      expect(r.payload.strand.name).toBe('GenLayer');
      expect(r.payload.strand.id).toMatch(/^strand_/);
      expect(r.payload.strand.description).toBe('');
      expect(r.payload.strand.color).toBeNull();
      expect(r.payload.strand.createdAtMs).toBeTypeOf('number');
      expect(r.payload.strand.updatedAtMs).toBeTypeOf('number');
    });

    it('rejects missing name', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: {}, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('rejects empty string name', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: { name: '   ' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('rejects non-string name (number)', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: { name: 42 }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('rejects non-string name (boolean)', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: { name: true }, respond });
      expect(getResult().ok).toBe(false);
    });

    it('rejects null name', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: { name: null }, respond });
      expect(getResult().ok).toBe(false);
    });

    it('trims name', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({ params: { name: '  GenLayer  ' }, respond });
      expect(getResult().payload.strand.name).toBe('GenLayer');
    });

    it('accepts optional description and color', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.create']({
        params: { name: 'GenLayer', description: 'Layer 1 validator', color: '#ff0000' },
        respond,
      });
      const strand = getResult().payload.strand;
      expect(strand.description).toBe('Layer 1 validator');
      expect(strand.color).toBe('#ff0000');
    });

    it('defaults description to empty string when omitted', () => {
      const strand = createStrand(handlers, { name: 'Test' });
      expect(strand.description).toBe('');
    });

    it('coerces non-string description to empty string', () => {
      const strand = createStrand(handlers, { name: 'Test', description: 42 });
      expect(strand.description).toBe('');
    });

    it('defaults color to null when omitted', () => {
      const strand = createStrand(handlers, { name: 'Test' });
      expect(strand.color).toBeNull();
    });

    it('accepts optional keywords array', () => {
      const strand = createStrand(handlers, { name: 'KW', keywords: ['investor', 'pipeline'] });
      expect(strand.keywords).toEqual(['investor', 'pipeline']);
    });

    it('defaults keywords to empty array', () => {
      const strand = createStrand(handlers, { name: 'NoKW' });
      expect(strand.keywords).toEqual([]);
    });

    it('accepts optional telegramTopicIds array', () => {
      const strand = createStrand(handlers, { name: 'TG', telegramTopicIds: [2212, 3001] });
      expect(strand.telegramTopicIds).toEqual([2212, 3001]);
    });

    it('defaults telegramTopicIds to empty array', () => {
      const strand = createStrand(handlers, { name: 'NoTG' });
      expect(strand.telegramTopicIds).toEqual([]);
    });

    it('generates unique IDs across creates', () => {
      const c1 = createStrand(handlers, { name: 'A' });
      const c2 = createStrand(handlers, { name: 'B' });
      const c3 = createStrand(handlers, { name: 'C' });
      const ids = new Set([c1.id, c2.id, c3.id]);
      expect(ids.size).toBe(3);
    });

    it('prepends new strands (newest first)', () => {
      createStrand(handlers, { name: 'First' });
      createStrand(handlers, { name: 'Second' });
      createStrand(handlers, { name: 'Third' });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const names = getResult().payload.strands.map(c => c.name);
      expect(names).toEqual(['Third', 'Second', 'First']);
    });

    it('persists across store reload', () => {
      createStrand(handlers, { name: 'Persistent' });

      // Recreate handlers from same store directory (simulates restart)
      const freshStore = createGoalsStore(TEST_DIR);
      const freshHandlers = createStrandHandlers(freshStore);

      const { respond, getResult } = makeResponder();
      freshHandlers['strands.list']({ params: {}, respond });
      expect(getResult().payload.strands).toHaveLength(1);
      expect(getResult().payload.strands[0].name).toBe('Persistent');
    });
  });

  // ─── strands.list ──────────────────────────────────────────────────

  describe('strands.list', () => {
    it('returns empty list initially', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      expect(getResult().ok).toBe(true);
      expect(getResult().payload.strands).toEqual([]);
    });

    it('returns strands with goalCount enrichment', () => {
      const strand = createStrand(handlers, { name: 'Project A' });
      createGoal(goalHandlers, { title: 'Goal 1', strandId: strand.id });
      createGoal(goalHandlers, { title: 'Goal 2', strandId: strand.id });
      createGoal(goalHandlers, { title: 'Goal 3' }); // unlinked

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const strands = getResult().payload.strands;
      expect(strands).toHaveLength(1);
      expect(strands[0].goalCount).toBe(2);
    });

    it('returns goalCount 0 for strands with no goals', () => {
      createStrand(handlers, { name: 'Empty' });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      expect(getResult().payload.strands[0].goalCount).toBe(0);
    });

    it('computes goalCount independently per strand', () => {
      const c1 = createStrand(handlers, { name: 'Alpha' });
      const c2 = createStrand(handlers, { name: 'Beta' });
      const c3 = createStrand(handlers, { name: 'Gamma' });

      createGoal(goalHandlers, { title: 'G1', strandId: c1.id });
      createGoal(goalHandlers, { title: 'G2', strandId: c1.id });
      createGoal(goalHandlers, { title: 'G3', strandId: c1.id });
      createGoal(goalHandlers, { title: 'G4', strandId: c2.id });
      // c3 gets no goals

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const strands = getResult().payload.strands;

      const byName = Object.fromEntries(strands.map(c => [c.name, c.goalCount]));
      expect(byName['Alpha']).toBe(3);
      expect(byName['Beta']).toBe(1);
      expect(byName['Gamma']).toBe(0);
    });

    it('returns multiple strands in insertion order (newest first)', () => {
      createStrand(handlers, { name: 'A' });
      createStrand(handlers, { name: 'B' });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const names = getResult().payload.strands.map(c => c.name);
      expect(names).toEqual(['B', 'A']);
    });

    it('includes all strand fields plus goalCount', () => {
      createStrand(handlers, { name: 'Full', description: 'desc', color: '#abc' });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const strand = getResult().payload.strands[0];
      expect(strand).toHaveProperty('id');
      expect(strand).toHaveProperty('name', 'Full');
      expect(strand).toHaveProperty('description', 'desc');
      expect(strand).toHaveProperty('color', '#abc');
      expect(strand).toHaveProperty('createdAtMs');
      expect(strand).toHaveProperty('updatedAtMs');
      expect(strand).toHaveProperty('goalCount', 0);
    });
  });

  // ─── strands.get ───────────────────────────────────────────────────

  describe('strands.get', () => {
    it('returns a strand by id with linked goals', () => {
      const strand = createStrand(handlers, { name: 'Project X' });
      createGoal(goalHandlers, { title: 'Task 1', strandId: strand.id });

      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond });
      expect(getResult().ok).toBe(true);
      expect(getResult().payload.strand.name).toBe('Project X');
      expect(getResult().payload.goals).toHaveLength(1);
      expect(getResult().payload.goals[0].title).toBe('Task 1');
    });

    it('returns empty goals array when no goals linked', () => {
      const strand = createStrand(handlers, { name: 'Lonely' });

      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond });
      expect(getResult().ok).toBe(true);
      expect(getResult().payload.goals).toEqual([]);
    });

    it('returns only goals matching this strand', () => {
      const c1 = createStrand(handlers, { name: 'Mine' });
      const c2 = createStrand(handlers, { name: 'Theirs' });

      createGoal(goalHandlers, { title: 'My Goal', strandId: c1.id });
      createGoal(goalHandlers, { title: 'Their Goal', strandId: c2.id });
      createGoal(goalHandlers, { title: 'Orphan Goal' }); // no strandId

      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: c1.id }, respond });
      const goals = getResult().payload.goals;
      expect(goals).toHaveLength(1);
      expect(goals[0].title).toBe('My Goal');
    });

    it('returns all strand fields', () => {
      const strand = createStrand(handlers, { name: 'Full', description: 'A desc', color: '#123' });

      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond });
      const fetched = getResult().payload.strand;
      expect(fetched.id).toBe(strand.id);
      expect(fetched.name).toBe('Full');
      expect(fetched.description).toBe('A desc');
      expect(fetched.color).toBe('#123');
      expect(fetched.createdAtMs).toBe(strand.createdAtMs);
    });

    it('returns error for missing strand', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: 'strand_nonexistent' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Strand not found');
    });
  });

  // ─── strands.update ────────────────────────────────────────────────

  describe('strands.update', () => {
    it('patches all allowed fields at once', () => {
      const strand = createStrand(handlers, { name: 'Original' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, name: 'Updated', description: 'New desc', color: '#00ff00' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.name).toBe('Updated');
      expect(updated.description).toBe('New desc');
      expect(updated.color).toBe('#00ff00');
      expect(updated.updatedAtMs).toBeGreaterThanOrEqual(updated.createdAtMs);
    });

    it('patches only name (partial update)', () => {
      const strand = createStrand(handlers, { name: 'Old', description: 'Keep me', color: '#abc' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, name: 'New' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.name).toBe('New');
      expect(updated.description).toBe('Keep me');
      expect(updated.color).toBe('#abc');
    });

    it('patches only description', () => {
      const strand = createStrand(handlers, { name: 'Keep', color: '#abc' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, description: 'New desc' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.name).toBe('Keep');
      expect(updated.description).toBe('New desc');
      expect(updated.color).toBe('#abc');
    });

    it('patches only color', () => {
      const strand = createStrand(handlers, { name: 'Keep', description: 'Keep too' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, color: '#ff0000' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.name).toBe('Keep');
      expect(updated.description).toBe('Keep too');
      expect(updated.color).toBe('#ff0000');
    });

    it('can set color to null', () => {
      const strand = createStrand(handlers, { name: 'Colored', color: '#ff0000' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, color: null },
        respond,
      });
      expect(getResult().payload.strand.color).toBeNull();
    });

    it('can set description to empty string', () => {
      const strand = createStrand(handlers, { name: 'C', description: 'Has desc' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, description: '' },
        respond,
      });
      expect(getResult().payload.strand.description).toBe('');
    });

    it('advances updatedAtMs without touching createdAtMs', () => {
      const strand = createStrand(handlers, { name: 'Timestamped' });
      const originalCreated = strand.createdAtMs;
      const originalUpdated = strand.updatedAtMs;

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, description: 'changed' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.createdAtMs).toBe(originalCreated);
      expect(updated.updatedAtMs).toBeGreaterThanOrEqual(originalUpdated);
    });

    it('ignores internal fields in patch (createdAtMs, id)', () => {
      const strand = createStrand(handlers, { name: 'Strand' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, createdAtMs: 0, name: 'Safe' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.name).toBe('Safe');
      expect(updated.createdAtMs).toBe(strand.createdAtMs);
      expect(updated.id).toBe(strand.id);
    });

    it('ignores unknown fields in patch', () => {
      const strand = createStrand(handlers, { name: 'Strand' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, malicious: 'payload', __proto__: 'bad', name: 'Fine' },
        respond,
      });
      const updated = getResult().payload.strand;
      expect(updated.name).toBe('Fine');
      expect(updated).not.toHaveProperty('malicious');
    });

    it('trims name on update', () => {
      const strand = createStrand(handlers, { name: 'C' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({ params: { id: strand.id, name: '  Trimmed  ' }, respond });
      expect(getResult().payload.strand.name).toBe('Trimmed');
    });

    it('rejects empty name after trim', () => {
      const strand = createStrand(handlers, { name: 'C' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({ params: { id: strand.id, name: '   ' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('rejects non-string name', () => {
      const strand = createStrand(handlers, { name: 'C' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({ params: { id: strand.id, name: 123 }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('rejects empty string name', () => {
      const strand = createStrand(handlers, { name: 'C' });

      const { respond, getResult } = makeResponder();
      handlers['strands.update']({ params: { id: strand.id, name: '' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('name is required');
    });

    it('returns error for missing strand', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.update']({ params: { id: 'strand_nonexistent', name: 'X' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Strand not found');
    });

    it('applies multiple sequential updates correctly', () => {
      const strand = createStrand(handlers, { name: 'Alpha' });

      const r2 = makeResponder();
      handlers['strands.update']({ params: { id: strand.id, name: 'Beta' }, respond: r2.respond });
      expect(r2.getResult().payload.strand.name).toBe('Beta');

      const r3 = makeResponder();
      handlers['strands.update']({ params: { id: strand.id, name: 'V3', color: '#abc' }, respond: r3.respond });
      expect(r3.getResult().payload.strand.name).toBe('V3');
      expect(r3.getResult().payload.strand.color).toBe('#abc');

      // Verify via get
      const rg = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond: rg.respond });
      expect(rg.getResult().payload.strand.name).toBe('V3');
      expect(rg.getResult().payload.strand.color).toBe('#abc');
    });

    it('does not affect other strands', () => {
      const c1 = createStrand(handlers, { name: 'Target' });
      const c2 = createStrand(handlers, { name: 'Bystander' });

      handlers['strands.update']({
        params: { id: c1.id, name: 'Changed' },
        respond: makeResponder().respond,
      });

      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: c2.id }, respond });
      expect(getResult().payload.strand.name).toBe('Bystander');
    });

    it('patches keywords', () => {
      const strand = createStrand(handlers, { name: 'C' });
      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, keywords: ['new', 'words'] },
        respond,
      });
      expect(getResult().payload.strand.keywords).toEqual(['new', 'words']);
    });

    it('patches telegramTopicIds', () => {
      const strand = createStrand(handlers, { name: 'C' });
      const { respond, getResult } = makeResponder();
      handlers['strands.update']({
        params: { id: strand.id, telegramTopicIds: [100] },
        respond,
      });
      expect(getResult().payload.strand.telegramTopicIds).toEqual([100]);
    });

    it('keywords persist across reload', () => {
      const strand = createStrand(handlers, { name: 'Persist', keywords: ['alpha'] });
      const freshStore = createGoalsStore(TEST_DIR);
      const freshHandlers = createStrandHandlers(freshStore);
      const { respond, getResult } = makeResponder();
      freshHandlers['strands.get']({ params: { id: strand.id }, respond });
      expect(getResult().payload.strand.keywords).toEqual(['alpha']);
    });

    it('persists updates across store reload', () => {
      const strand = createStrand(handlers, { name: 'Before' });

      handlers['strands.update']({
        params: { id: strand.id, name: 'After', description: 'Updated' },
        respond: makeResponder().respond,
      });

      const freshStore = createGoalsStore(TEST_DIR);
      const freshHandlers = createStrandHandlers(freshStore);
      const { respond, getResult } = makeResponder();
      freshHandlers['strands.get']({ params: { id: strand.id }, respond });
      expect(getResult().payload.strand.name).toBe('After');
      expect(getResult().payload.strand.description).toBe('Updated');
    });
  });

  // ─── strands.delete ────────────────────────────────────────────────

  describe('strands.delete', () => {
    it('deletes a strand and cascade-deletes linked goals', () => {
      const strand = createStrand(handlers, { name: 'Doomed' });
      const goal = createGoal(goalHandlers, { title: 'Linked Goal', strandId: strand.id });

      const { respond, getResult } = makeResponder();
      handlers['strands.delete']({ params: { id: strand.id }, respond });
      expect(getResult().ok).toBe(true);

      // Verify strand is gone
      const r2 = makeResponder();
      handlers['strands.list']({ params: {}, respond: r2.respond });
      expect(r2.getResult().payload.strands).toHaveLength(0);

      // Verify linked goal is deleted (not just nullified)
      const r3 = makeResponder();
      goalHandlers['goals.get']({ params: { id: goal.id }, respond: r3.respond });
      expect(r3.getResult().ok).toBe(false);
      expect(r3.getResult().error.message).toBe('Goal not found');
    });

    it('cascade-deletes multiple linked goals', () => {
      const strand = createStrand(handlers, { name: 'Hub' });
      const g1 = createGoal(goalHandlers, { title: 'G1', strandId: strand.id });
      const g2 = createGoal(goalHandlers, { title: 'G2', strandId: strand.id });
      const g3 = createGoal(goalHandlers, { title: 'G3', strandId: strand.id });

      handlers['strands.delete']({ params: { id: strand.id }, respond: makeResponder().respond });

      // All linked goals should be deleted
      for (const gid of [g1.id, g2.id, g3.id]) {
        const { respond, getResult } = makeResponder();
        goalHandlers['goals.get']({ params: { id: gid }, respond });
        expect(getResult().ok).toBe(false);
      }

      // goals.list should be empty
      const r = makeResponder();
      goalHandlers['goals.list']({ params: {}, respond: r.respond });
      expect(r.getResult().payload.goals).toHaveLength(0);
    });

    it('does not affect goals linked to other strands', () => {
      const doomed = createStrand(handlers, { name: 'Doomed' });
      const safe = createStrand(handlers, { name: 'Safe' });

      createGoal(goalHandlers, { title: 'Doomed Goal', strandId: doomed.id });
      const safeGoal = createGoal(goalHandlers, { title: 'Safe Goal', strandId: safe.id });

      handlers['strands.delete']({ params: { id: doomed.id }, respond: makeResponder().respond });

      const { respond, getResult } = makeResponder();
      goalHandlers['goals.get']({ params: { id: safeGoal.id }, respond });
      expect(getResult().payload.goal.strandId).toBe(safe.id);
    });

    it('does not affect unlinked goals', () => {
      const strand = createStrand(handlers, { name: 'Doomed' });
      const orphan = createGoal(goalHandlers, { title: 'Orphan' });

      handlers['strands.delete']({ params: { id: strand.id }, respond: makeResponder().respond });

      const { respond, getResult } = makeResponder();
      goalHandlers['goals.get']({ params: { id: orphan.id }, respond });
      expect(getResult().payload.goal.strandId).toBeNull();
      expect(getResult().payload.goal.title).toBe('Orphan');
    });

    it('cascade-deletes goals with tasks and cleans up session index', () => {
      const strand = createStrand(handlers, { name: 'Full' });
      const goal = createGoal(goalHandlers, { title: 'With Tasks', strandId: strand.id });

      // Add a task and simulate a spawned session
      goalHandlers['goals.addTask']({
        params: { id: goal.id, text: 'Task 1' },
        respond: makeResponder().respond,
      });
      goalHandlers['goals.addSession']({
        params: { id: goal.id, sessionKey: 'agent:main:subagent:t1' },
        respond: makeResponder().respond,
      });

      // Verify session is tracked
      const r1 = makeResponder();
      goalHandlers['goals.sessionLookup']({
        params: { sessionKey: 'agent:main:subagent:t1' },
        respond: r1.respond,
      });
      expect(r1.getResult().payload.goalId).toBe(goal.id);

      // Delete strand
      handlers['strands.delete']({ params: { id: strand.id }, respond: makeResponder().respond });

      // Goal should be gone
      const r2 = makeResponder();
      goalHandlers['goals.get']({ params: { id: goal.id }, respond: r2.respond });
      expect(r2.getResult().ok).toBe(false);

      // Session index should be cleaned up
      const r3 = makeResponder();
      goalHandlers['goals.sessionLookup']({
        params: { sessionKey: 'agent:main:subagent:t1' },
        respond: r3.respond,
      });
      expect(r3.getResult().payload.goalId).toBeNull();
    });

    it('does not affect other strands', () => {
      const c1 = createStrand(handlers, { name: 'First' });
      const c2 = createStrand(handlers, { name: 'Second' });
      const c3 = createStrand(handlers, { name: 'Third' });

      handlers['strands.delete']({ params: { id: c2.id }, respond: makeResponder().respond });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const names = getResult().payload.strands.map(c => c.name);
      expect(names).toHaveLength(2);
      expect(names).toContain('First');
      expect(names).toContain('Third');
      expect(names).not.toContain('Second');
    });

    it('deleted strand is no longer fetchable by get', () => {
      const strand = createStrand(handlers, { name: 'Gone' });
      handlers['strands.delete']({ params: { id: strand.id }, respond: makeResponder().respond });

      const { respond, getResult } = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Strand not found');
    });

    it('returns error for missing strand', () => {
      const { respond, getResult } = makeResponder();
      handlers['strands.delete']({ params: { id: 'strand_nonexistent' }, respond });
      expect(getResult().ok).toBe(false);
      expect(getResult().error.message).toBe('Strand not found');
    });

    it('double-delete returns error on second attempt', () => {
      const strand = createStrand(handlers, { name: 'Once' });

      const r1 = makeResponder();
      handlers['strands.delete']({ params: { id: strand.id }, respond: r1.respond });
      expect(r1.getResult().ok).toBe(true);

      const r2 = makeResponder();
      handlers['strands.delete']({ params: { id: strand.id }, respond: r2.respond });
      expect(r2.getResult().ok).toBe(false);
      expect(r2.getResult().error.message).toBe('Strand not found');
    });

    it('persists deletion across store reload', () => {
      const strand = createStrand(handlers, { name: 'Ephemeral' });
      handlers['strands.delete']({ params: { id: strand.id }, respond: makeResponder().respond });

      const freshStore = createGoalsStore(TEST_DIR);
      const freshHandlers = createStrandHandlers(freshStore);
      const { respond, getResult } = makeResponder();
      freshHandlers['strands.list']({ params: {}, respond });
      expect(getResult().payload.strands).toHaveLength(0);
    });

    it('cleans up sessionStrandIndex entries pointing to deleted strand', () => {
      const strand = createStrand(handlers, { name: 'Doomed' });
      const otherStrand = createStrand(handlers, { name: 'Survivor' });

      // Map sessions to the strands
      const goalH = createGoalHandlers(store);
      goalH['goals.setSessionStrand']({
        params: { sessionKey: 'agent:main:main', strandId: strand.id },
        respond: makeResponder().respond,
      });
      goalH['goals.setSessionStrand']({
        params: { sessionKey: 'agent:other:main', strandId: otherStrand.id },
        respond: makeResponder().respond,
      });

      // Delete the strand
      handlers['strands.delete']({ params: { id: strand.id }, respond: makeResponder().respond });

      // Session mapped to deleted strand should be gone
      const r1 = makeResponder();
      goalH['goals.getSessionStrand']({ params: { sessionKey: 'agent:main:main' }, respond: r1.respond });
      expect(r1.getResult().payload.strandId).toBeNull();

      // Session mapped to other strand should be untouched
      const r2 = makeResponder();
      goalH['goals.getSessionStrand']({ params: { sessionKey: 'agent:other:main' }, respond: r2.respond });
      expect(r2.getResult().payload.strandId).toBe(otherStrand.id);
    });
  });

  // ─── Cross-cutting: goal-strand relationship integrity ─────────────

  describe('goal-strand relationship integrity', () => {
    it('goalCount updates when a goal is reassigned to a different strand', () => {
      const c1 = createStrand(handlers, { name: 'Source' });
      const c2 = createStrand(handlers, { name: 'Dest' });
      const goal = createGoal(goalHandlers, { title: 'Movable', strandId: c1.id });

      // Move goal from c1 to c2
      goalHandlers['goals.update']({
        params: { id: goal.id, strandId: c2.id },
        respond: makeResponder().respond,
      });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      const strands = getResult().payload.strands;
      const byName = Object.fromEntries(strands.map(c => [c.name, c.goalCount]));
      expect(byName['Source']).toBe(0);
      expect(byName['Dest']).toBe(1);
    });

    it('goalCount updates when a goal is unlinked (strandId set to null)', () => {
      const strand = createStrand(handlers, { name: 'Shrinking' });
      const goal = createGoal(goalHandlers, { title: 'Leaving', strandId: strand.id });

      goalHandlers['goals.update']({
        params: { id: goal.id, strandId: null },
        respond: makeResponder().respond,
      });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      expect(getResult().payload.strands[0].goalCount).toBe(0);
    });

    it('goalCount updates when a linked goal is deleted', () => {
      const strand = createStrand(handlers, { name: 'Stable' });
      const g1 = createGoal(goalHandlers, { title: 'Stay', strandId: strand.id });
      const g2 = createGoal(goalHandlers, { title: 'Go', strandId: strand.id });

      goalHandlers['goals.delete']({ params: { id: g2.id }, respond: makeResponder().respond });

      const { respond, getResult } = makeResponder();
      handlers['strands.list']({ params: {}, respond });
      expect(getResult().payload.strands[0].goalCount).toBe(1);
    });

    it('strands.get reflects goals added after strand creation', () => {
      const strand = createStrand(handlers, { name: 'Growing' });

      // Initially empty
      const r1 = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond: r1.respond });
      expect(r1.getResult().payload.goals).toHaveLength(0);

      // Add goals
      createGoal(goalHandlers, { title: 'New Goal', strandId: strand.id });

      const r2 = makeResponder();
      handlers['strands.get']({ params: { id: strand.id }, respond: r2.respond });
      expect(r2.getResult().payload.goals).toHaveLength(1);
    });
  });
});
