#!/usr/bin/env node
// plugins/helix-goals/scripts/weekly-learn.js
//
// Analyze classification corrections and optionally apply keyword suggestions.
// Usage:
//   node scripts/weekly-learn.js                    # dry-run (default)
//   node scripts/weekly-learn.js --apply            # apply suggestions
//   node scripts/weekly-learn.js --since 7d         # only corrections from last 7 days
//   node scripts/weekly-learn.js --data-dir /path   # custom data directory

import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createGoalsStore } from '../lib/goals-store.js';
import { createClassificationLog } from '../lib/classification-log.js';
import { analyzeCorrections, applyLearning } from '../lib/learning.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultDataDir = join(__dirname, '..', '.data');

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dataDir = args.includes('--data-dir')
  ? args[args.indexOf('--data-dir') + 1]
  : defaultDataDir;

let sinceMs = 0;
const sinceIdx = args.indexOf('--since');
if (sinceIdx !== -1) {
  const val = args[sinceIdx + 1];
  const match = val?.match(/^(\d+)([dhm])$/);
  if (match) {
    const num = parseInt(match[1], 10);
    const unit = { d: 86400000, h: 3600000, m: 60000 }[match[2]];
    sinceMs = Date.now() - (num * unit);
  }
}

const store = createGoalsStore(dataDir);
const log = createClassificationLog(dataDir);

console.log(`Data directory: ${dataDir}`);
console.log(`Mode: ${apply ? 'APPLY' : 'DRY RUN'}`);
if (sinceMs > 0) console.log(`Since: ${new Date(sinceMs).toISOString()}`);
console.log('');

// Stats
const stats = log.getStats();
console.log('Classification Stats:');
console.log(`  Total entries: ${stats.total}`);
console.log(`  With feedback: ${stats.withFeedback}`);
console.log(`  Accepted: ${stats.accepted}`);
console.log(`  Corrected: ${stats.corrected}`);
console.log(`  Accuracy: ${stats.accuracy != null ? (stats.accuracy * 100).toFixed(1) + '%' : 'N/A'}`);
console.log('');

// Analyze
const suggestions = analyzeCorrections(log, sinceMs);
if (suggestions.length === 0) {
  console.log('No learning suggestions (need 2+ corrections to same strand).');
  process.exit(0);
}

console.log(`Found ${suggestions.length} suggestion(s):`);
for (const s of suggestions) {
  console.log(`  ${s.strandId}: ${s.correctionCount} corrections`);
  if (s.suggestedKeywords?.length) {
    console.log(`    Keywords: ${s.suggestedKeywords.join(', ')}`);
  }
}
console.log('');

// Apply
const applied = applyLearning(store, suggestions, !apply);
if (applied.length === 0) {
  console.log('No changes to apply (strands may not exist or keywords already present).');
} else {
  console.log(`${apply ? 'Applied' : 'Would apply'} ${applied.length} change(s):`);
  for (const a of applied) {
    console.log(`  ${a.strandName} (${a.strandId}): +${a.addedKeywords.join(', ')}`);
  }
}
