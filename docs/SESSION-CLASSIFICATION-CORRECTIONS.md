# Session Classification - Swarm Review Corrections

> **Date:** 2026-02-07  
> **Source:** 6-agent parallel review (architecture, security, edge cases, feasibility, testing, UX)

This document summarizes critical corrections needed before implementing the SESSION-CLASSIFICATION-PROPOSAL.md.

---

## 🔴 Critical Issues (Must Fix Before Phase 1)

### 1. File Path Corrections

**Proposal had wrong paths. Correct paths:**

| Proposal Path | Actual Path |
|---------------|-------------|
| `condo-management/store.js` | `clawcondos/condo-management/lib/goals-store.js` |
| `condo-management/handlers.js` | `clawcondos/condo-management/lib/condos-handlers.js` |
| `condo-management/index.js` | `clawcondos/condo-management/index.js` |

**New files to create (in correct locations):**
- `clawcondos/condo-management/lib/classifier.js`
- `clawcondos/condo-management/lib/classification-log.js`
- `clawcondos/condo-management/lib/sanitize.js` (security)
- `clawcondos/condo-management/scripts/seed-keywords.js`

### 2. ESM Not CommonJS

**Proposal used CommonJS. Codebase uses ESM.**

Wrong:
```javascript
const { join } = require('path');
module.exports = { classifySession };
```

Correct:
```javascript
import { join } from 'path';
export { classifySession };
```

### 3. Factory Pattern Required

**Proposal created standalone modules. Codebase uses factory pattern.**

Wrong:
```javascript
// classifier.js
const store = require('./store');
function classify() { store.load()... }
```

Correct:
```javascript
// classifier.js
export function createClassifier(store) {
  return {
    classify(message, context) {
      const data = store.load();
      // ...
    }
  };
}
```

### 4. Hook Return Format Limited

**Proposal returns unsupported fields.**

Supported:
```javascript
return { prependContext: 'context string' };
```

NOT supported (need gateway changes):
```javascript
return { 
  buttons: {...},      // ❌ Not supported
  systemNote: '📁...',  // ❌ Not supported  
  classificationId: '' // ❌ Not supported
};
```

**Workaround for Phase 1:** Embed routing indicator in `prependContext`:
```javascript
return {
  prependContext: `📁 Routed to: ${condoName}\n\n${condoContext}`
};
```

### 5. Race Condition - File Locking Required

**Issue:** Concurrent sessions corrupt JSON files.

**Fix:** Add atomic writes + file locking to `goals-store.js`:

```javascript
import { writeFileSync, renameSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

export function createGoalsStore(dataDir) {
  const storePath = join(dataDir, 'goals.json');
  const lockPath = join(dataDir, '.goals.lock');
  
  function save(data) {
    const tmpPath = `${storePath}.tmp`;
    const bakPath = `${storePath}.bak`;
    
    // Atomic write: tmp → backup → rename
    writeFileSync(tmpPath, JSON.stringify(data, null, 2));
    if (existsSync(storePath)) {
      renameSync(storePath, bakPath);
    }
    renameSync(tmpPath, storePath);
  }
  
  function load() {
    try {
      return JSON.parse(readFileSync(storePath, 'utf8'));
    } catch (err) {
      // Try backup
      const bakPath = `${storePath}.bak`;
      if (existsSync(bakPath)) {
        return JSON.parse(readFileSync(bakPath, 'utf8'));
      }
      throw err;
    }
  }
  
  // ... rest
}
```

---

## 🟡 Security Fixes Required

### 6. Input Sanitization for LLM Prompts

**Create `lib/sanitize.js`:**

```javascript
/**
 * Sanitize user message before sending to LLM classifier
 * Prevents prompt injection attacks
 */
export function sanitizeForPrompt(text) {
  if (!text) return '';
  
  return text
    // Remove NUL bytes
    .replace(/\x00/g, '')
    // Filter injection attempts
    .replace(/^[\s\S]*?(ignore|forget|disregard).*instructions/gi, '[FILTERED]')
    .replace(/respond\s+(only\s+)?with\s+json/gi, '')
    .replace(/\{[\s\S]*"condo"[\s\S]*\}/g, '[JSON FILTERED]')
    // Truncate
    .slice(0, 500);
}

/**
 * Sanitize message before storing in logs
 * Don't store sensitive content - hash only
 */
export function hashForLog(message) {
  const crypto = await import('crypto');
  return crypto.createHash('sha256').update(message).digest('hex').slice(0, 16);
}
```

### 7. Rate Limiting for Tier 2

**Add to classifier:**

```javascript
const RATE_LIMIT = {
  tier2PerMinute: 20,
  counts: new Map(),
};

function checkRateLimit() {
  const minute = Math.floor(Date.now() / 60000);
  const key = `t2:${minute}`;
  const count = RATE_LIMIT.counts.get(key) || 0;
  
  if (count >= RATE_LIMIT.tier2PerMinute) {
    return false; // Rate limited
  }
  
  RATE_LIMIT.counts.set(key, count + 1);
  // Clean old entries
  for (const k of RATE_LIMIT.counts.keys()) {
    if (!k.endsWith(`:${minute}`)) RATE_LIMIT.counts.delete(k);
  }
  return true;
}
```

### 8. Don't Store Message Content in Logs

**Wrong:**
```javascript
message: message.slice(0, 500),
```

**Correct:**
```javascript
messageHash: hashForLog(message),
messageLength: message.length,
// No message content stored
```

---

## 🟡 Edge Case Handling

### 9. Empty Keyword Filter

**Issue:** Empty string in keywords matches everything.

```javascript
// Filter empty keywords
const keywords = (condo.keywords || []).filter(k => k && k.length > 0);
```

### 10. Regex Error Handling

**Issue:** Malformed regex throws.

```javascript
function parseRegex(str) {
  try {
    const match = str.match(/^\/(.+)\/([gimsu]*)$/);
    if (match) return new RegExp(match[1], match[2]);
    return new RegExp(str, 'i');
  } catch (err) {
    console.warn(`[classifier] Invalid regex: ${str}`);
    return null;
  }
}

// Filter nulls when using
const triggers = (condo.triggers || [])
  .map(parseRegex)
  .filter(Boolean);
```

### 11. Expiry Cleanup on Load

**Add to store load:**

```javascript
function cleanupExpired(data) {
  const now = Date.now();
  
  // Clean pending classifications
  for (const [key, pending] of Object.entries(data.pendingClassifications || {})) {
    if (pending.expiresAt < now) {
      delete data.pendingClassifications[key];
    }
  }
  
  // Clean pending goal suggestions
  for (const [key, suggestion] of Object.entries(data.pendingGoalSuggestions || {})) {
    if (suggestion.expiresAt < now) {
      delete data.pendingGoalSuggestions[key];
    }
  }
  
  return data;
}
```

---

## 🟡 UX Improvements

### 12. Increase Auto-Accept Timer

**Change from 5s to 10s:**

```javascript
const CONFIG = {
  // ...
  softConfirmAutoAcceptMs: 10000,  // Was 5000
};
```

### 13. Goal Suggestion Threshold

**Only suggest goals for substantial messages:**

```javascript
function shouldSuggestGoal(message) {
  // Skip short messages
  if (message.length < 80) return false;
  
  // Check for task indicators
  const score = detectGoalIntent(message);
  return score.isGoal && score.score >= 0.6;
}
```

### 14. Clearer Button Labels

If/when buttons are supported:

```javascript
// Instead of [✓] [Change]
// Use: [Route here] [Pick different]
```

---

## 🟢 Architecture Improvements

### 15. Pre-filter Tier 2 Candidates

**Issue:** Tier 2 prompt includes all condos (expensive at scale).

**Fix:** Only send top-5 candidates from Tier 1:

```javascript
async function tier2Classify(message, context, condos, goals, llmClient, tier1Result) {
  // Only include top candidates, not all condos
  const candidateIds = new Set([
    tier1Result.condo,
    ...(tier1Result.alternatives || []).map(a => a.condo)
  ].filter(Boolean).slice(0, 5));
  
  const candidates = condos.filter(c => candidateIds.has(c.id));
  
  // Build prompt with only candidates
  // ...
}
```

### 16. Gateway URL Configurable

```javascript
const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'http://127.0.0.1:18200';
```

---

## Updated File List

| File | Action | Purpose |
|------|--------|---------|
| `lib/classifier.js` | Create | Classification logic (ESM, factory) |
| `lib/classification-log.js` | Create | Log storage (ESM) |
| `lib/sanitize.js` | Create | Input sanitization |
| `lib/goals-store.js` | Modify | Add atomic writes, expiry cleanup |
| `lib/condos-handlers.js` | Modify | Add keyword fields to schema |
| `index.js` | Modify | Wire classifier into hook |
| `scripts/seed-keywords.js` | Create | Initial keyword seeding |

---

## Revised Implementation Order

1. **Pre-Phase 1:** Fix file locking in goals-store.js (prevents data loss)
2. **Phase 1:** Tier 1 classification with all security fixes
3. **Phase 2:** Tier 2 LLM with rate limiting
4. **Phase 3:** Goal creation
5. **Phase 4:** Learning

---

## Gateway Changes Needed (Future)

For full button/systemNote support, OpenClaw gateway needs:

1. `before_agent_start` hook to support `{ buttons, systemNote }` return
2. Button callback mechanism
3. Auto-accept timer infrastructure

These are **not required for Phase 1** - use `prependContext` workaround.
