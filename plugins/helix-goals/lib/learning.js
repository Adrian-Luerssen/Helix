// learning.js — Classification correction analysis

/**
 * Analyze corrections to find frequently-corrected-to strands.
 * Returns suggestions for new keywords per strand.
 */
export function analyzeCorrections(classificationLog, sinceMs = 0) {
  const corrections = classificationLog.getCorrections(sinceMs);

  // Group by corrected-to strand, count frequency
  const byTarget = new Map();
  for (const entry of corrections) {
    const target = entry.correctedTo;
    byTarget.set(target, (byTarget.get(target) || 0) + 1);
  }

  return [...byTarget.entries()]
    .filter(([, count]) => count >= 2) // Only suggest if corrected 2+ times
    .map(([strandId, correctionCount]) => ({
      strandId,
      correctionCount,
      suggestedKeywords: [], // Would need message content for keyword extraction
    }));
}

/**
 * Apply keyword suggestions to strands in the store.
 */
export function applyLearning(store, suggestions, dryRun = false) {
  const data = store.load();
  const applied = [];

  for (const suggestion of suggestions) {
    const strand = data.strands.find(c => c.id === suggestion.strandId);
    if (!strand) continue;

    const existing = new Set(strand.keywords || []);
    const added = [];

    for (const kw of (suggestion.suggestedKeywords || [])) {
      if (kw && !existing.has(kw)) {
        existing.add(kw);
        added.push(kw);
      }
    }

    if (added.length > 0) {
      if (!dryRun) {
        strand.keywords = [...existing].slice(0, 25);
        strand.updatedAtMs = Date.now();
      }
      applied.push({ strandId: strand.id, strandName: strand.name, addedKeywords: added });
    }
  }

  if (!dryRun && applied.length > 0) {
    store.save(data);
  }

  return applied;
}
