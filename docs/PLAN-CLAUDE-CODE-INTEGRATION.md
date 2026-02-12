# Claude Code Plan Integration — Design Document

## Overview

This feature adds visibility into Claude Code's plan mode within the ClawCondos task UI. When a task's spawned subagent runs Claude Code and enters plan mode, the dashboard will:

1. **Detect Claude Code availability** — verify the `claude` CLI is installed; guide the user through installation if missing
2. **Display the plan.md** — render the generated plan inline within the task's detail view
3. **Show current progress** — highlight which step is in-progress, completed, or pending
4. **Stream real-time logs** — show live tool calls, file edits, and agent output as the plan executes
5. **Provide feedback/approval controls** — let the user approve, reject, or comment on the plan before execution begins
6. **Configurable autonomy modes** — per-task or per-condo control over how much the agent asks before acting
7. **Notification system** — push/toast alerts for agent questions, plan approvals, phase completions, and errors

---

## Prerequisite Fixes (Applied)

### Fix 1: WebSocket Authentication Key
- **Files:** `public/index.html`, `lib/gateway-client.js`
- **Change:** `{ password: token }` → `{ token: token }`

### Fix 2: Static File Serving
- Already correct - serves from `public/`

### Fix 3: Token from URL Parameter
- **File:** `public/index.html`
- **Change:** Added URL param support: `?token=XXX`

---

## Claude Code Detection

The integration is **conditional** — only activates if Claude Code is present.

### RPC Method: `claude-code.status`
```js
// Response
{
  available: boolean,
  version: string | null,
  path: string | null
}
```

### Detection Flow
1. `which claude` (or `where claude` on Windows)
2. If found → `claude --version`
3. Cache result, re-check on demand (debounced 60s)

---

## Autonomy Modes

| Mode | Behavior | Plan Approval | Design Questions | All Questions |
|------|----------|---------------|------------------|---------------|
| **Full Auto** | Agent executes without stopping | Auto-approved | Auto-answered | Auto-answered |
| **Ask Design** | Pauses for architecture decisions | Required | Prompted | Auto-answered |
| **Ask Everything** | Pauses for any decision | Required | Prompted | Prompted |

**Default:** `Ask Design`

**Inheritance:** `task.autonomyMode ?? condo.autonomyMode ?? 'ask-design'`

---

## Notification System

### Notification Types
| Type | Trigger |
|------|---------|
| `plan_ready` | Plan status → `awaiting_approval` |
| `agent_question` | Agent calls `AskUserQuestion` |
| `phase_completed` | Plan step group completes |
| `error` | Agent encounters error |
| `task_done` | Task marked done |

### Storage
- Stored in `goals.json` under `notifications[]`
- Capped at 200 entries (FIFO eviction)

---

## Data Model Changes

### Task Object — New Fields
```js
{
  autonomyMode: 'full-auto' | 'ask-design' | 'ask-everything' | null,
  plan: {
    status: 'none' | 'draft' | 'awaiting_approval' | 'approved' | 'rejected' | 'executing' | 'completed',
    filePath: String | null,
    content: String | null,
    steps: [{
      index: Number,
      title: String,
      status: 'pending' | 'in-progress' | 'done' | 'skipped',
      startedAtMs: Number | null,
      completedAtMs: Number | null,
    }],
    approvedAtMs: Number | null,
    rejectedAtMs: Number | null,
    feedback: String | null,
    updatedAtMs: Number,
  }
}
```

### Condo Object — New Fields
```js
{
  autonomyMode: 'full-auto' | 'ask-design' | 'ask-everything',  // default: 'ask-design'
}
```

---

## Backend Changes (Plugin)

### New Files
1. **`lib/notification-manager.js`** — Notification lifecycle management
2. **`lib/autonomy.js`** — Autonomy mode resolution and directive generation
3. **`lib/plan-manager.js`** — Plan parsing and lifecycle
4. **`lib/plan-handlers.js`** — RPC handlers for plans.*

### Modified Files
1. **`index.js`** — Register new RPC methods
2. **`lib/goal-update-tool.js`** — Add plan-related parameters
3. **`lib/task-spawn.js`** — Initialize task.plan on spawn
4. **`serve.js`** — File watcher + log relay

### New RPC Methods
- `claude-code.status` — Check if Claude Code is installed
- `plans.get` — Get plan for a task
- `plans.approve` — Approve a plan
- `plans.reject` — Reject with feedback
- `plans.updateStep` — Manual step status update
- `notifications.list` — Get notifications
- `notifications.markRead` — Mark as read
- `notifications.dismiss` — Delete notification

### New WebSocket Events
- `plan.update` — Plan status/content changed
- `plan.log` — Real-time log entry
- `notification.new` — New notification created

---

## Frontend Changes

### Task Row
- Plan badge showing status (📋 draft, ⏳ awaiting, ✅ approved, etc.)

### Plan Detail Panel (Expandable)
- Step list with status indicators
- Raw plan markdown content
- Approve/Reject buttons
- Comment input
- Live log viewer

### Plans Tab in Goal Detail
- Aggregate view of all task plans
- Overall progress bar

### Notification System
- Toast notifications for new events
- Bell icon with unread count
- Notification dropdown/panel

---

## Implementation Plan

### Phase 1: Data Model & Basic RPC (Backend) — Blake
1. Add `plan` field to task schema
2. Create `lib/plan-manager.js`
3. Create `lib/plan-handlers.js`
4. Register RPC methods in `index.js`
5. Extend `goal_update` tool

### Phase 2: Approval/Reject & Agent Communication — Blake
6. Implement `plans.approve` handler
7. Implement `plans.reject` handler
8. Implement `plans.updateStep` handler
9. Extend `task-spawn.js` with plan init

### Phase 3: Real-Time Events (Backend) — Blake
10. Add plan log buffer
11. Add file watcher to `serve.js`
12. Emit `plan.update` events
13. Intercept agent stream for `plan.log` events

### Phase 4: Frontend — Plan Display — Félix + Dana
14. Add plan badge to task row
15. Build plan detail panel
16. Add CSS for plan components
17. Handle `plan.update` WebSocket event

### Phase 5: Frontend — Interactions — Félix
18. Approve/Reject buttons
19. Comment/feedback input
20. Live log viewer
21. Plans tab in goal detail

### Phase 6: Notifications — Félix + Blake
22. Create `lib/notification-manager.js`
23. Create `lib/autonomy.js`
24. Frontend notification UI (toast + bell)
25. Notification dropdown panel

### Phase 7: Testing & Polish — Quinn + Victor
26. Write backend tests
27. Write frontend tests
28. Integration testing
29. Code review and validation

---

## Complexity Estimate

| Component | Files | Lines | Complexity |
|-----------|-------|-------|------------|
| Data model | 1 | ~15 | Low |
| plan-manager.js | 1 | ~150 | Medium |
| plan-handlers.js | 1 | ~200 | Medium |
| notification-manager.js | 1 | ~100 | Medium |
| autonomy.js | 1 | ~80 | Low |
| serve.js changes | 1 | ~180 | Medium-High |
| Frontend plan UI | 1 | ~400 | High |
| Frontend notifications | 1 | ~150 | Medium |
| CSS | 1 | ~150 | Low |
| Tests | 3 | ~400 | Medium |
| **Total** | **~12** | **~1,825** | **Medium-High** |

---

## Agent Assignments

| Agent | Branch | Tasks |
|-------|--------|-------|
| Blake ⚙️ | `feat/blake-backend` | Phases 1-3, 6 (backend) |
| Félix 🎨 | `feat/felix-frontend` | Phases 4-5, 6 (frontend) |
| Dana ✨ | `feat/dana-css` | CSS components |
| Quinn 🔍 | `qa/quinn-validation` | Testing Phase 7, round 1 |
| Victor 🔍 | `qa/victor-validation` | Testing Phase 7, round 2 |
