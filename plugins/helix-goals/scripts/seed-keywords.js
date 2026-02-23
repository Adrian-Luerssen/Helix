#!/usr/bin/env node
// plugins/helix-goals/scripts/seed-keywords.js
import { createGoalsStore } from '../lib/goals-store.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.STRAND_DATA_DIR || join(__dirname, '..', '.data');

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'this', 'that', 'these', 'those', 'it', 'its', 'they', 'them',
  'we', 'us', 'our', 'you', 'your', 'i', 'me', 'my', 'he', 'she',
  'his', 'her', 'not', 'all', 'some', 'any', 'each', 'every',
]);

// Action verbs too generic to be keywords
const GENERIC_VERBS = new Set([
  'test', 'testing', 'add', 'create', 'update', 'fix', 'implement',
  'build', 'make', 'get', 'set', 'use', 'using', 'work', 'working',
  'check', 'look', 'see', 'try', 'want', 'like', 'new', 'run',
]);

function extractKeywords(text) {
  if (!text) return [];
  return text.toLowerCase()
    .replace(/[^a-z0-9\s\-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w) && !GENERIC_VERBS.has(w));
}

const store = createGoalsStore(dataDir);
const data = store.load();
const dryRun = process.argv.includes('--dry-run');

for (const strand of data.strands) {
  const strandGoals = data.goals.filter(g => g.strandId === strand.id);
  const texts = [strand.name, strand.description];
  for (const goal of strandGoals) {
    texts.push(goal.title, goal.description);
    for (const task of (goal.tasks || [])) {
      texts.push(task.text);
    }
  }

  const allWords = texts.flatMap(extractKeywords);
  // Count frequency
  const freq = {};
  for (const w of allWords) freq[w] = (freq[w] || 0) + 1;

  // Top keywords by frequency, deduplicate with existing
  const existing = new Set(strand.keywords || []);
  const candidates = Object.entries(freq)
    .filter(([w]) => !existing.has(w))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([w]) => w);

  const merged = [...existing, ...candidates].slice(0, 20);

  console.log(`\n${strand.name} (${strand.id})`);
  console.log(`  Goals: ${strandGoals.length}`);
  console.log(`  Existing: [${[...existing].join(', ')}]`);
  console.log(`  Adding:   [${candidates.join(', ')}]`);
  console.log(`  Final:    [${merged.join(', ')}]`);

  if (!dryRun) {
    strand.keywords = merged;
    strand.updatedAtMs = Date.now();
  }
}

if (!dryRun) {
  store.save(data);
  console.log('\nKeywords seeded and saved.');
} else {
  console.log('\n(dry run - no changes saved)');
}
