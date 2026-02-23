# Helix Goals Plugin (`helix-goals`)

An OpenClaw plugin that manages goals, tasks, strands, and session-goal mappings for the Helix dashboard. Provides native gateway RPC methods, lifecycle hooks, and agent tools for autonomous goal-driven orchestration.

## Architecture

```
┌──────────────────────────┐
│  Helix Frontend          │
│  (index.html)            │
│  WebSocket RPC calls     │
└──────────┬───────────────┘
           │ goals.*, strands.*
           ▼
┌──────────────────────────┐
│  OpenClaw Gateway        │
│  (port 18789)            │
│                          │
│  ┌────────────────────┐  │
│  │ helix-goals        │  │
│  │ plugin             │  │
│  │                    │  │
│  │  26 RPC methods    │  │
│  │  2 lifecycle hooks │  │
│  │  9 agent tools     │  │
│  └────────┬───────────┘  │
│           │               │
│  ┌────────▼───────────┐  │
│  │  goals.json        │  │
│  │  (file-backed)     │  │
│  └────────────────────┘  │
└──────────────────────────┘
```

### Data Model

All data lives in a single JSON file (`plugins/helix-goals/.data/goals.json`). The store schema:

```json
{
  "version": 2,
  "goals": [],
  "strands": [],
  "sessionIndex": {},
  "sessionStrandIndex": {}
}
```

**Goals** are the primary entity. Each goal has:
- `id`, `title`, `description`, `notes`, `status` (`active`/`done`), `completed` (boolean, synced with status)
- `strandId` (nullable reference to a strand)
- `priority`, `deadline` (optional metadata)
- `tasks[]` (embedded task objects)
- `sessions[]` (assigned session keys)
- `createdAtMs`, `updatedAtMs`

**Tasks** are embedded in goals. Each task has:
- `id`, `text`, `description`, `status` (`pending`/`in-progress`/`blocked`/`done`), `done` (boolean, synced with status)
- `sessionKey` (the subagent session assigned to this task, set by `spawnTaskSession`)
- `priority`, `dependsOn[]`, `summary`
- `createdAtMs`, `updatedAtMs`

**Goals** additionally have:
- `worktree` (nullable `{ path, branch, createdAtMs }` — present when parent strand has a workspace)

**Strands** group goals. Each strand has:
- `id`, `name`, `description`, `color`
- `keywords` (array of strings for auto-classification)
- `telegramTopicIds` (array of strings for topic-based routing)
- `workspace` (nullable `{ path, repoUrl, createdAtMs }` — present when `HELIX_WORKSPACES_DIR` is set)
- `createdAtMs`, `updatedAtMs`

**Indexes** provide fast lookups:
- `sessionIndex`: `{ [sessionKey]: { goalId } }` — maps sessions to their goal
- `sessionStrandIndex`: `{ [sessionKey]: strandId }` — maps sessions to their strand

### File Structure

```
plugins/helix-goals/
  index.js                  # Plugin entry point (registers everything)
  openclaw.plugin.json      # Plugin manifest
  package.json              # Node.js package metadata
  migrate.js                # Migration from .registry/goals.json
  lib/
    goals-store.js          # File-backed JSON store with atomic writes
    goals-handlers.js       # Goals + tasks + sessions RPC handlers
    strands-handlers.js      # Strands RPC handlers
    context-builder.js      # Builds goal context for agent prompt injection
    goal-update-tool.js     # Agent tool executor for reporting task status
    strand-tools.js          # Agent tools for strand binding, goal creation, task management
    task-spawn.js           # Spawn subagent session for a task
    workspace-manager.js    # Git workspace/worktree management for strands and goals
    skill-injector.js       # Reads skill files and builds context for PM/worker agents
    classifier.js           # Tier 1 pattern-based session classifier
    classification-log.js   # Classification attempt logging with feedback
    learning.js             # Correction analysis and keyword suggestions
  scripts/
    populate-strands.js      # Populate strands from goal references
    seed-keywords.js        # Seed strand keywords from goal content
    weekly-learn.js         # Weekly learning pipeline (--dry-run/--apply)
  .data/
    goals.json              # Data file (gitignored)
    classification-log.json # Classification log (gitignored)
```

## Gateway RPC Methods

All methods follow the standard OpenClaw JSON-RPC protocol over WebSocket.

### Goals CRUD

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `goals.list` | — | `{ goals }` | All goals |
| `goals.create` | `title`, `strandId?`, `description?`, `status?`, `priority?`, `deadline?`, `notes?` | `{ goal }` | Tasks always start empty (use `addTask`). If `strandId` references a strand with a workspace, a git worktree is created automatically. |
| `goals.get` | `id` | `{ goal }` | |
| `goals.update` | `id`, plus any of: `title`, `description`, `status`, `completed`, `strandId`, `priority`, `deadline`, `notes`, `tasks` | `{ goal }` | Whitelist prevents overwriting `id`, `sessions`, `createdAtMs`. Title validated. Status/completed synced. |
| `goals.delete` | `id` | `{ ok }` | Cleans up sessionIndex entries |

### Session Management

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `goals.addSession` | `id`, `sessionKey` | `{ ok, goal }` | Move semantics: removes session from any prior goal first |
| `goals.removeSession` | `id`, `sessionKey` | `{ ok, goal }` | Validates sessionKey, cleans up sessionIndex |
| `goals.sessionLookup` | `sessionKey` | `{ goalId }` | Returns `null` if not assigned |

### Session-Strand Mapping

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `goals.setSessionStrand` | `sessionKey`, `strandId` | `{ ok }` | |
| `goals.getSessionStrand` | `sessionKey` | `{ strandId }` | |
| `goals.listSessionStrands` | — | `{ sessionStrandIndex }` | |

### Task CRUD

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `goals.addTask` | `goalId`, `text`, `description?`, `priority?`, `dependsOn?` | `{ task }` | Generates ID, validates text |
| `goals.updateTask` | `goalId`, `taskId`, plus any of: `text`, `description`, `status`, `done`, `priority`, `dependsOn`, `summary` | `{ task }` | Whitelist prevents overwriting `id`, `sessionKey`, `createdAtMs`. Status/done synced. |
| `goals.deleteTask` | `goalId`, `taskId` | `{ ok }` | |

### Task Spawning

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `goals.spawnTaskSession` | `goalId`, `taskId`, `agentId?`, `model?` | `{ sessionKey, taskContext, agentId, model, goalId, taskId, workspacePath }` | Generates session key, links to goal, builds context with workspace path, guards against re-spawning |

### Classification

| Method | Params | Returns | Notes |
|--------|--------|---------|-------|
| `classification.stats` | — | `{ stats }` | Returns `{ total, withFeedback, accepted, corrected, accuracy }` |
| `classification.learningReport` | — | `{ suggestions }` | Analyzes corrections and suggests keyword updates |
| `classification.applyLearning` | `dryRun?` | `{ dryRun, applied }` | Applies keyword suggestions to strands (`dryRun` defaults to `true`) |

## Lifecycle Hooks

### `before_agent_start`

Fires before an agent processes a message. Checks in order:

1. **Strand-bound session** — If `sessionStrandIndex[sessionKey]` exists, injects strand context with all goals
2. **Goal-bound session** — If `sessionIndex[sessionKey]` exists, injects goal context (with project summary if in a strand)
3. **Auto-classification** — For unbound sessions (when `HELIX_CLASSIFICATION !== 'off'`):
   - Extracts the last user message and parses Telegram context (topic ID) from the session key
   - Runs tier 1 pattern matching: `@strand:name` mentions (1.0), topic ID match (0.95), keyword match (0.15 each, max 0.45), strand name match (0.3)
   - High confidence (>=0.8) → auto-binds session to strand, injects strand context. Also checks for goal intent and appends a hint if detected.
   - Low confidence → injects a strand menu listing available projects for agent-mediated selection via `strand_bind`
   - All classification attempts are logged to `classification-log.json`

The injected goal context includes:
- Goal title, description, status, priority, deadline
- Workspace path and branch (if goal has a worktree)
- Task checklist with completion markers (`[x]` / `[ ]`)
- Session assignments (marks tasks as "you", "assigned: <key>", or "unassigned")
- Completed task summaries
- Reminder to use `goal_update` tool when tasks remain

The injected strand context includes workspace path if the strand has a workspace.

### `agent_end`

Fires after a successful agent response. Updates `goal.updatedAtMs` or `strand.updatedAtMs` to track last activity. Wrapped in try-catch so errors don't break the agent lifecycle.

## Agent Tools

### `goal_update`

Agents call this tool to report task progress. Available to any session with a `sessionKey`.

**Parameters:**
- `goalId` (string, optional) — explicit goal to update (required for strand-bound sessions updating non-own goals)
- `taskId` (string, optional) — task to update
- `status` (`done` | `in-progress` | `blocked`) — required when `taskId` is set
- `summary` (string, optional) — what was accomplished or what's blocking
- `addTasks` (array, optional) — new tasks to create on the goal
- `nextTask` (string, optional) — set the goal's next task hint
- `goalStatus` (`done` | `active`, optional) — mark goal as done or reactivate
- `notes` (string, optional) — append notes to the goal

**Cross-goal boundaries:** Sessions bound to a strand can update sibling goals, but only `addTasks` and `notes` are allowed cross-goal. Task status updates, `goalStatus`, and `nextTask` are restricted to the session's own goal.

### `strand_bind`

Binds the current session to a strand. Available when the session is not yet bound.

**Parameters:**
- `strandId` (string, optional) — bind to existing strand
- `name` (string, optional) — create a new strand and bind to it
- `description` (string, optional) — description for new strand

### `strand_create_goal`

Creates a goal in the bound strand. Available when session is bound to a strand.

**Parameters:**
- `title` (string, required) — goal title
- `description` (string, optional) — goal description
- `priority` (string, optional) — priority level
- `tasks` (array, optional) — initial tasks (strings or `{text, description, priority}` objects)

### `strand_add_task`

Adds a task to a goal in the bound strand.

**Parameters:**
- `goalId` (string, required) — goal to add the task to
- `text` (string, required) — task description
- `description` (string, optional) — detailed description
- `priority` (string, optional) — priority level

### `strand_spawn_task`

Spawns a subagent session for a task in the bound strand.

**Parameters:**
- `goalId` (string, required) — goal containing the task
- `taskId` (string, required) — task to spawn for
- `agentId` (string, optional) — agent to use (default: `main`)
- `model` (string, optional) — model override

### `strand_list`

Lists all strands with IDs, descriptions, and goal counts. Available to any session.

**Parameters:** *(none)*

### `strand_status`

Returns full project status for a strand: goals, tasks, assignments, and progress.

**Parameters:**
- `strandId` (string, required) — strand to get status for

### `strand_pm_chat`

Sends a work request to the PM for a strand. Blocks up to 3 minutes while the PM processes. Returns the PM's response (plan, questions, or created goals).

**Parameters:**
- `strandId` (string, required) — strand to send the request to
- `message` (string, required) — the work request or follow-up message

### `strand_pm_kickoff`

Approves a goal and spawns worker agents. If the goal has no tasks yet, triggers PM goal cascade to plan tasks first, then auto-spawns workers.

**Parameters:**
- `strandId` (string, required) — strand containing the goal
- `goalId` (string, required) — goal to kick off

## Strand Workspaces & Goal Worktrees

When `HELIX_WORKSPACES_DIR` is set, the plugin creates git workspaces for strands and git worktrees for goals, enabling agents to work on multiple goals in parallel without conflicts.

### Setup

Set the environment variable to enable:

```bash
export HELIX_WORKSPACES_DIR=/path/to/workspaces
```

When not set, all workspace functionality is completely disabled — full backward compatibility.

### Workspace Layout

```
$HELIX_WORKSPACES_DIR/
  my-project-a1b2c3d4/          <- strand workspace (git init or git clone)
    .git/
    goals/
      goal_abc123/              <- worktree (branch: goal/goal_abc123)
      goal_def456/              <- worktree (branch: goal/goal_def456)
    src/                        <- shared project files (main branch)
```

### Lifecycle

| Event | Action |
|-------|--------|
| `strands.create` | `git init` (or `git clone <repoUrl>`) → empty initial commit → `goals/` subdir |
| `strands.create` with `repoUrl` | `git clone <repoUrl>` into workspace path |
| `goals.create` (in strand with workspace) | `git worktree add goals/<goalId> -b goal/<goalId>` |
| `goals.delete` (with worktree) | `git worktree remove --force` + `git branch -D` + prune |
| `strands.delete` (with workspace) | `rm -rf` the workspace directory |
| `strand_bind` (new strand via name) | Same as `strands.create` workspace flow |
| `strand_create_goal` | Same as `goals.create` worktree flow |
| `pm.strandCreateGoals` | Creates worktrees for each goal in bulk |

### Error Handling

All workspace operations are best-effort. Failures are logged but never block strand/goal CRUD:
- Workspace creation fails → strand created with `workspace: null`
- Worktree creation fails → goal created with `worktree: null`
- Removal fails → deletion still proceeds

### Agent Awareness

- `context-builder.js` adds `Workspace: <path>` to goal context (with branch) and strand context
- `skill-injector.js` adds `**Working Directory:** <path>` to worker task headers
- `task-spawn.js` includes `cd <path>` instruction in task context and `workspacePath` in response payload

### workspace-manager.js Functions

| Function | Purpose |
|----------|---------|
| `sanitizeDirName(name)` | Slug a strand name for directory use |
| `strandWorkspacePath(baseDir, strandId, name)` | `<baseDir>/<slug>-<id-suffix>/` |
| `goalWorktreePath(strandWs, goalId)` | `<strandWs>/goals/<goalId>/` |
| `goalBranchName(goalId)` | `goal/<goalId>` |
| `createStrandWorkspace(baseDir, strandId, name, repoUrl?)` | mkdir + git init/clone + empty commit + goals/ |
| `createGoalWorktree(strandWs, goalId)` | `git worktree add` with new branch |
| `removeGoalWorktree(strandWs, goalId)` | `git worktree remove --force` + prune + branch delete |
| `removeStrandWorkspace(strandWs)` | `rm -rf` the workspace |

All functions return `{ ok, path?, error? }` result objects and never throw.

## Storage Layer

`goals-store.js` provides a simple file-backed JSON store:

- **Atomic writes**: Writes to a `.tmp` file then renames (prevents corruption on crash)
- **Data migration**: Normalizes legacy data (adds `strandId`, `completed`, `sessions`, `tasks` defaults)
- **Safety**: Refuses to save if the store was loaded with parse errors (`_loadError` flag)
- **ID generation**: `newId(prefix)` returns `<prefix>_<24 hex chars>` using `crypto.randomBytes`

### Concurrency

The store is designed for single-process use. Concurrent writes from multiple processes would race. This is fine for OpenClaw's architecture where the gateway is a single process.

## Validation Patterns

All handlers follow consistent validation:

1. **Required fields**: Checked with `if (!field)` at handler start, returns error before loading data
2. **Title/name validation**: `typeof x !== 'string' || !x.trim()` — rejects empty, whitespace-only, and non-string values
3. **Whitelist pattern**: Update handlers iterate over allowed field names, preventing writes to internal fields (`id`, `createdAtMs`, `sessions`, `sessionKey`)
4. **Trim on save**: String fields are trimmed after whitelist application
5. **Status sync**: `status` and `done`/`completed` booleans are kept in sync bidirectionally

## Testing

Tests across 15+ test files. Run with `npm test`.

| Test File | Coverage |
|-----------|----------|
| `goals-handlers.test.js` | Goals CRUD, session management, task CRUD, validation |
| `strands-handlers.test.js` | Strands CRUD, goalCount enrichment, cascade delete, sessionStrandIndex cleanup |
| `goal-update-tool.test.js` | Status sync, cross-goal boundaries, goal-level update, error cases |
| `strand-tools.test.js` | strand_bind, strand_create_goal, strand_add_task, strand_spawn_task |
| `task-spawn.test.js` | Spawn config, session linking, project summary, re-spawn guard |
| `context-builder.test.js` | Goal context, project summary, strand context, null safety |
| `goals-store.test.js` | Load/save, atomic writes, data migration, ID generation, strands array |
| `classifier.test.js` | Tier 1 classification, topic/keyword/name scoring, ambiguity detection, goal intent |
| `classification-log.test.js` | Append, feedback, corrections, stats, reclassification, load error safety |
| `learning.test.js` | Correction analysis, keyword suggestion, apply learning with dry run |
| `workspace-manager.test.js` | Workspace creation, worktree creation/removal, idempotency, path builders |
| `plugin-index.test.js` | Plugin registration, hook integration, tool factory, classification wiring |
| `config.test.js` | Config loader (not plugin-specific) |
| `message-shaping.test.js` | Message formatting (not plugin-specific) |
| `serve-helpers.test.js` | Server helpers (not plugin-specific) |

## Installation

The plugin lives in the Helix repo at `plugins/helix-goals/`. Install it into OpenClaw using the link flag (recommended for development — edits take effect on gateway restart):

```bash
cd /path/to/helix
openclaw plugins install -l ./helix/strand-management
```

This registers the plugin, creates the config entries, and symlinks to the source directory. Restart the gateway to load it.

Optional: set `dataDir` in plugin config to override the default `.data/` directory.
