# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Helix is a goals-first multi-agent orchestration platform. It's a web UI for managing AI agent sessions organized into projects ("Strands") with goals and tasks, connecting to an OpenClaw gateway via WebSocket.

**Fork:** Helix is a fork of [Helix](https://github.com/acastellana/helix), building on infrastructure originally created by Albert Castellana. Now maintained by Adrian Luerssen Medina.

## Commands

### Quick start
```bash
npm install
cp config.example.json config.json   # edit with your gateway URL
node serve.js                         # http://localhost:9000
```

See `docs/SETUP.md` for full setup instructions (Caddy, Tailscale, etc.).

### Development
```bash
# Run development server (default port 9000)
node serve.js [port]

# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run a single test file
npx vitest run tests/config.test.js

# Run E2E tests (Playwright)
npm run test:e2e
```

## Architecture

### No build step
The frontend is vanilla JS with no framework and no build pipeline. Edit files and refresh the browser.

### Key files

- **`index.html`** — Main dashboard UI. Single-file monolith (~7700 lines) containing all dashboard HTML, CSS, and JS inline. This is the primary file you'll edit for UI changes.
- **`app.html`** — Separate page (~776 lines) for the app viewer with AI assistant panel, iframe sandboxing, and error capture.
- **`serve.js`** — Node.js HTTP/WebSocket server (~1483 lines). Serves static files, proxies WebSocket and HTTP requests to the OpenClaw gateway (with auth injection), handles media upload, Whisper transcription, agent/skill introspection, search (fast + deep/embedding modes), and local service config RPC.
- **`plugins/helix-goals/`** — OpenClaw plugin for goals/tasks/strands management (see below).
- **`lib/config.js`** — Configuration loader (~137 lines) used by both browser and server. Priority: `window.HELIX_CONFIG` (or `window.HELIX_CONFIG`) > `/config.json` > auto-detect from hostname. Exports `getConfig()` (sync), `initConfig()` and `loadConfig()` (async).
- **`lib/message-shaping.js`** — Message formatting and reply tag extraction (~73 lines). Browser IIFE attaching to `window.messageShaping`. Extracts `[[reply_to_current]]` / `[[reply_to:<id>]]` tags, strips them from display text, detects sentinel messages (`NO_REPLY`, `HEARTBEAT_OK`).
- **`lib/serve-helpers.js`** — Server security utilities (~101 lines). `rewriteConnectFrame()` (auth injection), `filterProxyHeaders()` (allowlist), `stripSensitiveHeaders()`, `validateStaticPath()`, `isDotfilePath()`.
- **`js/media-upload.js`** — Browser file upload handler (~523 lines). IIFE module `MediaUpload` with drag-drop, paste, base64 conversion, progress tracking. 20MB max, 5 file limit.
- **`js/voice-recorder.js`** — In-browser voice recording (~361 lines). IIFE module `VoiceRecorder` via MediaRecorder API with audio level meter, auto-stop at 5 min, webm/opus format.
- **`styles/`** — CSS files:
  - `main.css` (5300+ lines) — Full design system: CSS variables, Apple glassmorphism aesthetic, all component styles
  - `agents.css` (1123 lines) — Agents page: split layout, file browser, heartbeat display, cron jobs
  - `media-upload.css` (259 lines) — Upload UI: drop overlay, thumbnails, progress bars
  - `voice-recorder.css` (83 lines) — Recording UI: mic button, timer, level meter
- **`public/`** — Production-served copies of assets. Also contains:
  - `public/styles/plans.css` — Plan integration UI (status pills, plan cards)
  - `public/styles/roles.css` — Role assignment UI (badges, role cards)
  - `public/app.css`, `public/app.js` — Compiled app viewer assets
  - `public/dashboard-overrides.css` — Production dashboard CSS overrides
  - `public/media/` — Logo SVG, screenshots

### Data flow

```
Browser (index.html)
  -> WebSocket -> serve.js -> WebSocket proxy (auth injected) -> OpenClaw Gateway (port 18789)
  -> HTTP      -> serve.js -> /api/gateway/* proxy            -> OpenClaw Gateway
```

The server injects `GATEWAY_AUTH` bearer tokens into proxied requests so credentials stay server-side.

### Server routes (serve.js)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/ws`, `/helix-ws` | WS | WebSocket proxy to gateway (also accepts legacy `/helix-ws`) |
| `/api/gateway/*` | GET/POST | HTTP proxy to gateway (auth injected) |
| `/api/export` | POST | Download markdown content as file |
| `/api/agents/summary` | GET | Agent summary (mission + heartbeat headings) |
| `/api/agents/files` | GET | List files in agent workspace |
| `/api/agents/file` | GET | Read single file from agent workspace |
| `/api/skills/resolve` | GET | Resolve skill metadata by IDs |
| `/api/search` | GET | Search goals/sessions/files (fast or deep mode) |
| `/api/search/status` | GET | Search backend status (chat index, memory DBs) |
| `/api/search/reindex` | POST | Force chat index reindex |
| `/api/apps` | GET | Return registered apps array |
| `/api/whisper/health` | GET | Whisper service health check |
| `/api/whisper/transcribe` | GET | Transcribe audio file using Whisper |
| `/media-upload/upload` | POST | Upload file (multipart) |
| `/media/*` | GET | Serve uploaded media |
| `/{appId}/*` | GET/POST | Proxy to registered embedded app |
| `/` | GET | Serve main dashboard |

**Local RPC handlers** (intercepted at WebSocket level, not proxied to gateway):
- `config.getServices` — Retrieve service configs (global or per-strand)
- `config.setService` — Update service configuration
- `config.deleteService` — Remove service configuration
- `config.verifyGitHub` — Verify GitHub token + check repo access

### WebSocket RPC protocol

All communication uses JSON-RPC-style messages over WebSocket:
- Requests: `{"type":"req", "id":"r1", "method":"sessions.list", "params":{...}}`
- Responses: `{"type":"res", "id":"r1", "ok":true, "payload":{...}}`
- Events (server-push): `{"type":"event", "event":"chat", "payload":{...}}`

See `docs/BACKEND-API.md` for the full protocol spec.

### Session key format

Sessions are identified by structured keys:
- `agent:main:main` — Primary agent
- `agent:app-assistant:app:<appId>` — App assistant
- `agent:main:subagent:<taskId>` — Background task
- `agent:<agentId>:webchat:task-<suffix>` — Spawned worker task
- `agent:<agentId>:webchat:pm-<strandId>` — PM session
- `agent:main:telegram:group:<groupId>:topic:<topicId>` — Telegram topic session
- `cron:<jobId>` — Scheduled job

### Frontend state management

The frontend uses a single global `state` object with key fields:
- **Data:** `sessions`, `goals`, `strands`, `apps`, `agents`, `chatHistory`
- **Navigation:** `currentView`, `currentSession`, `currentGoalOpenId`, `detailPanelSessionKey`
- **WebSocket:** `ws`, `connected`, `rpcPending` (Map), `rpcIdCounter`
- **Agent tracking:** `activeRuns` (Map), `sessionAgentStatus`, `sessionBriefStatus`
- **UI state:** `multiSelectMode`, `selectedSessions`, `pinnedSessions`, `sessionNames`, `goalTab`

WebSocket events drive UI updates. No reactive framework — DOM manipulation is direct via `getElementById` and innerHTML. localStorage persists pins, custom names, read state, and model overrides.

### Frontend views and major functions

**Views** (toggled via `navigateTo(view)` + URL hash routing):
- Overview — stats grid, recent activity, strand status board
- Goal View — split layout with chat left, tasks/files/context tabs right
- Chat View — session messages + input composer
- Search View — full-page search (Cmd+K)
- Agents Overview — agent cards with workload, file browser
- Strand Context — goals graph, timeline, workspace info

**Key function categories in index.html:**
- Session management: `openSession()`, `renderSessions()`, `generateSessionTitle()`, `togglePinSession()`
- Goal management: `openGoal()`, `renderGoalView()`, `addGoalTask()`, `cycleTaskStatus()`, `kickOffGoal()`
- Chat/streaming: `handleChatEvent()`, `updateStreamingMessage()`, `finalizeStreamingMessage()`
- Tool activity: `trackToolStart()`, `trackToolEnd()`, `renderToolActivity()`
- WebSocket: `connectWebSocket()`, `rpcCall()`, `scheduleReconnect()`, `startKeepalive()`
- Modals: create goal, attach session, spawn task, organize wizard, search palette
- Strand views: `showStrandContext()`, `renderStrandStatusBoard()`, `renderTaskGraph()`

### Real-time goal refresh

The frontend receives agent tool events via WebSocket (`{ stream: 'tool', data: { phase: 'end', name: '...' } }`). When `handleAgentEvent()` detects a goal-related tool completing, it triggers a debounced `loadGoals()` refresh (500ms debounce).

**Watched tool names** (`GOAL_TOOL_NAMES`): `goal_update`, `strand_bind`, `strand_create_goal`, `strand_add_task`, `strand_spawn_task`.

**Refresh pipeline:** `debouncedGoalRefresh()` → (500ms) → `loadGoals()` → `renderGoalView()`. The 30s `refresh()` poll also calls `loadGoals()` as a fallback.

### Tracked files

Goals can have files attached via `goal.files[]`. Agents report files through the `goal_update` tool, and users can add files via `goals.addFiles` RPC. Each file entry contains `{ path, taskId, sessionKey, addedAtMs, source }`.

### Strand Workspaces & Goal Worktrees

When `HELIX_WORKSPACES_DIR` (or `HELIX_WORKSPACES_DIR`) is set, each strand gets a git-initialized workspace directory and each goal gets a git worktree for isolated parallel development.

**Layout:**
```
$HELIX_WORKSPACES_DIR/
  my-project-a1b2c3d4/          <- strand workspace (main git repo)
    goals/
      goal_abc123/              <- worktree (branch: goal/goal_abc123)
      goal_def456/              <- worktree (branch: goal/goal_def456)
    src/                        <- shared project files (main branch)
```

**Data model additions:**
- **Strand** — `workspace: { path, repoUrl, createdAtMs }` (null if workspaces disabled)
- **Goal** — `worktree: { path, branch, createdAtMs }` (null if parent strand has no workspace)

**Behavior:**
- Strand creation → `git init` (or `git clone` if `repoUrl` provided) + `goals/` subdir
- Goal creation → `git worktree add goals/<goalId> -b goal/<goalId>`
- Goal completion → auto-commit + push + merge to main + push main
- Goal deletion → `git worktree remove --force` + branch cleanup
- Strand deletion → kill all sessions + `rm -rf` the workspace directory
- All workspace ops are best-effort — failures are logged but never block strand/goal CRUD
- When disabled (`HELIX_WORKSPACES_DIR` not set), all workspace code is completely skipped

**Agent awareness:**
- Context injection includes `Workspace: <path>` in goal and strand context blocks
- Spawned task agents receive a `**Working Directory:**` header with explicit `cd` instruction
- The `workspacePath` is included in the `goals.spawnTaskSession` response payload

### OpenClaw Plugin (helix-goals)

Goals, tasks, and session-goal mappings are managed by an OpenClaw plugin at `plugins/helix-goals/`. The plugin registers gateway RPC methods that the frontend calls over WebSocket.

**Plugin files:**
- `index.js` — Plugin entry point (~1800+ lines). Registers 60+ gateway methods, 3 hooks, 9 tools. Orchestrates PM cascade, auto-merge, error recovery, phase-based kickoff, plan file watching.
- `lib/goals-store.js` — File-backed JSON storage with atomic writes, data migration, ID generation
- `lib/goals-handlers.js` — Goals CRUD, session management, task CRUD, file management, plan updates, conflict checks (~19 methods)
- `lib/strands-handlers.js` — Strands CRUD with workspace lifecycle, GitHub repo auto-creation, cascade delete (~5 methods)
- `lib/context-builder.js` — Builds goal/strand context for agent prompt injection. Functions: `buildGoalContext()`, `buildProjectSummary()`, `buildStrandContext()`, `buildStrandMenuContext()`
- `lib/goal-update-tool.js` — Agent tool executor for task status, plan management, file tracking, goal completion
- `lib/strand-tools.js` — 9 executor factories: bind, create goal, add task, spawn task, list, status, pm chat, pm kickoff
- `lib/task-spawn.js` — Spawns subagent sessions with full context (worker skill, project summary, services, autonomy, plan file path)
- `lib/workspace-manager.js` — Git operations: init/clone, worktree add/remove, commit, push, merge, branch status check. All return `{ ok, error? }`, never throw.
- `lib/skill-injector.js` — Reads skill files (SKILL-PM.md, SKILL-WORKER.md, SKILL-AGENT.md) and builds context strings with session headers, role descriptions
- `lib/classifier.js` — Tier 1 pattern-based session classifier. Scoring: @strand mention (1.0), topic ID (0.95), keyword hits (0.15 each, max 0.45), name match (0.3). Ambiguity gap enforcement.
- `lib/classification-log.js` — Classification attempt logging with feedback tracking (max 1000 entries)
- `lib/learning.js` — Analyzes corrections, suggests keyword updates for strands corrected 2+ times
- `migrate.js` — Migration script from `.registry/goals.json`

**Data model (goals.json):**
```json
{
  "version": 2,
  "goals": [{
    "id": "goal_...", "title": "", "description": "", "notes": "",
    "status": "active|done", "completed": false,
    "strandId": null, "priority": null, "deadline": null,
    "autonomyMode": null,
    "tasks": [{ "id": "task_...", "text": "", "status": "pending|in-progress|blocked|done",
                "done": false, "sessionKey": null, "dependsOn": [], "assignedAgent": null,
                "plan": { "status": "", "content": "", "steps": [] } }],
    "sessions": [], "files": [],
    "worktree": { "path": "", "branch": "" },
    "plan": { "status": "", "content": "", "steps": [] },
    "createdAtMs": 0, "updatedAtMs": 0
  }],
  "strands": [{
    "id": "strand_...", "name": "", "description": "", "color": "",
    "keywords": [], "telegramTopicIds": [],
    "workspace": { "path": "", "repoUrl": "" },
    "autonomyMode": null, "services": {},
    "createdAtMs": 0, "updatedAtMs": 0
  }],
  "sessionIndex": { "sessionKey": { "goalId": "..." } },
  "sessionStrandIndex": { "sessionKey": "strandId" },
  "notifications": [],
  "config": {}
}
```

**Gateway methods (60+):**
- Goals: `goals.list`, `goals.create`, `goals.get`, `goals.update`, `goals.delete`
- Sessions: `goals.addSession`, `goals.removeSession`, `goals.sessionLookup`
- Session-strand mapping: `goals.setSessionStrand`, `goals.getSessionStrand`, `goals.listSessionStrands`, `goals.removeSessionStrand`
- Tasks: `goals.addTask`, `goals.updateTask`, `goals.deleteTask`
- Files: `goals.addFiles`, `goals.removeFile`
- Plans: `goals.updatePlan`, `goals.checkConflicts`
- Strands: `strands.create`, `strands.list`, `strands.get`, `strands.update`, `strands.delete`
- Spawning: `goals.spawnTaskSession`, `goals.kickoff`, `goals.close`
- Git ops: `goals.branchStatus`, `goals.createPR`, `goals.retryPush`, `goals.retryMerge`, `goals.pushMain`
- Classification: `classification.stats`, `classification.learningReport`, `classification.applyLearning`
- PM methods, config handlers, team handlers, roles handlers, notification handlers, autonomy handlers, session lifecycle handlers

**Plugin hooks:**
- `before_agent_start` — Injects goal/strand context when a session belongs to a goal or strand. For unbound sessions, auto-classifies via tier 1 pattern matching and either auto-routes (>=0.8 confidence) or injects a strand menu.
- `agent_end` — Tracks activity timestamps, auto-completes tasks, auto-merges goal branches, triggers phase cascade kickoff, handles error recovery with retry.
- `agent_stream` — Logs plan updates and tool calls to plan buffer, matches to plan steps.

**Plugin tools (9):**
- `goal_update` — Report task status, create tasks, set next task, mark goals done, append notes, track files, manage plans
- `strand_bind` — Bind session to existing or new strand
- `strand_create_goal` — Create goals in bound strand with optional initial tasks
- `strand_add_task` — Add tasks to goals in bound strand
- `strand_spawn_task` — Spawn subagent sessions for tasks
- `strand_list` — List all strands with goal counts
- `strand_status` — Full project status: goals, tasks, assignments, progress
- `strand_pm_chat` — Send work request to PM, poll for response (3min timeout), auto-create goals
- `strand_pm_kickoff` — Approve goal and spawn workers (or trigger PM cascade if no tasks)

**PM cascade flow:**
1. User sends work request → `strand_pm_chat` → PM session processes
2. PM creates plan with goals/tasks → auto-creates in store
3. User approves → `strand_pm_kickoff` → spawns worker agents
4. Workers execute tasks, report via `goal_update`
5. Task completion → auto-merge goal branch → kick off dependent tasks
6. All tasks done → goal auto-completes → kick off next phase goals

### File-backed storage

App registrations persist in `.registry/` (gitignored):
- `.registry/apps.json` — Registered embedded applications

Goals data lives in the plugin:
- `plugins/helix-goals/.data/goals.json` — Goals storage (gitignored)
- `plugins/helix-goals/.data/classification-log.json` — Classification log (gitignored)

### Skill files (docs/)

Skill docs injected into agent context by the plugin:
- `docs/SKILL-AGENT.md` — Agent interaction guide (tools, workflows, session context)
- `docs/SKILL-WORKER.md` — Worker protocol (status updates, plan management, autonomy levels)
- `docs/SKILL-PM.md` — PM planner role (propose plans, assign roles, wait for approval)
- `docs/SKILL-PM-STRAND.md` — Strand PM (propose vertical-slice goals, not tasks)
- `docs/SKILL-PM-GOAL.md` — Goal PM (propose tasks for one goal)

## Testing

Tests use **Vitest 2.0** in Node environment. **35 test files, 848+ tests**. Test files live in `tests/` and match `tests/**/*.test.js`.

`tests/setup.js` provides browser API mocks (MockWebSocket, localStorage, document, fetch) since tests run in Node.

**Test coverage areas:**
- Plugin: goals-handlers, strands-handlers, goal-update-tool, strand-tools, task-spawn, context-builder, goals-store, workspace-manager, skill-injector, classifier, classification-log, learning, plugin-index, pm-handlers, config-handlers, cascade-processor, error-recovery, session-lifecycle, agent-roles, roles-handlers, autonomy, notification-manager, github, plan-parser, project-snapshot, lifecycle-strand-pipeline
- Server: serve-helpers, config, message-shaping, gateway-client, chat-index, memory-search, search, embedding-provider
- Frontend: frontend-goals (pure functions extracted from index.html)

## Code Conventions

- **Vanilla JS (ES6+)** — No frameworks. Server uses ES modules (`import`/`export`); browser code uses IIFEs and globals (no module bundler).
- **`escapeHtml()`** — Must be used for all user-generated content rendered as HTML to prevent XSS. Defined in `js/media-upload.js` and `app.html`; `index.html` handles escaping inline.
- **CSS variables** — Theming via custom properties in `styles/main.css`. Apple glassmorphism aesthetic with frosted glass effects, soft depth shadows, Inter font.
- **Inline event handlers** — The dashboard uses `onclick=`, `onkeypress=` patterns in generated HTML.
- **Naming** — Functions: camelCase. CSS classes/IDs: kebab-case.

## CSS Design System

Key variable groups in `styles/main.css`:
- **Colors:** `--bg` (#0d0d12), `--accent` (#818CF8 indigo), `--green` (#30D158), `--yellow` (#FFD60A), `--red` (#FF453A)
- **Glass effects:** `--glass-bg`, `--glass-border`, `--glass-blur` (20px backdrop-filter)
- **Text hierarchy:** `--text` (0.92 opacity), `--text-secondary` (0.60), `--text-dim` (0.40), `--text-muted` (0.22)
- **Spacing:** `--space-xs` (4px) through `--space-2xl` (32px)
- **Radius:** `--radius-sm` (8px) through `--radius-xl` (20px)
- **Typography:** Inter (sans), IBM Plex Mono (mono)
- **Transitions:** `--transition-fast` (0.15s), `--spring-easing` (cubic-bezier(0.34, 1.56, 0.64, 1))

## Environment Variables (serve.js)

All `HELIX_*` env vars are preferred; `HELIX_*` equivalents are supported as backwards-compatible aliases.

- `GATEWAY_HTTP_HOST` / `GATEWAY_HTTP_PORT` — Gateway location (default: localhost:18789)
- `GATEWAY_AUTH` — Bearer token injected into proxied requests
- `GATEWAY_WS_URL` — Custom WebSocket URL for gateway
- `GATEWAY_PASSWORD` — Gateway password (fallback: reads from ~/.openclaw/openclaw.json)
- `MEDIA_UPLOAD_HOST` / `MEDIA_UPLOAD_PORT` — Media upload service
- `HELIX_DEV_CORS` — Set to `1` to enable CORS for local development
- `ENABLE_MEDIA_UPLOAD_PROXY` — Set to `1` to enable legacy proxy to external media-upload service
- `HELIX_WHISPER_MODEL` — Whisper model name (default: `base`)
- `HELIX_WHISPER_DEVICE` — Whisper device (default: `cpu`)
- `HELIX_WHISPER_TIMEOUT_MS` — Whisper transcription timeout in ms (default: `120000`)
- `HELIX_AGENT_WORKSPACES` — JSON mapping agent IDs to workspace paths for introspection (default: `{}`)
- `HELIX_SKILLS_DIRS` — Colon-separated skill directory paths (default: empty)
- `HELIX_UPLOAD_DIR` — Additional upload directory allowed for Whisper transcription
- `HELIX_CLASSIFICATION` — Set to `off` to disable auto-classification of unbound sessions (default: enabled)
- `HELIX_WORKSPACES_DIR` — Base directory for strand git workspaces (disabled if not set)
- `HELIX_EMBEDDING_PROVIDER` — Embedding provider for deep search (default: `openai`)
- `OPENAI_API_KEY` — API key for OpenAI embeddings (required for deep search)
- `HELIX_SEARCH_SYNC_INTERVAL_MS` — Chat index background sync interval (default: `300000`)
- `OPENCLAW_STATE_DIR` — OpenClaw state directory for memory search (default: ~/.openclaw)

**Env file:** Reads `~/.config/helix.env` on startup (falls back to `~/.config/helix.env`; fills only unset vars).

## Dependencies

**Production:** `ws` (WebSocket), `better-sqlite3` + `sqlite-vec` (chat index / vector search)
**Dev:** `vitest` + `@vitest/coverage-v8` + `@vitest/ui` (testing), `@playwright/test` (E2E)

## Reference Files

- `config.example.json` — Example config (copy to `config.json`)
- `start.example.sh` — Example startup script with Caddy
- `Caddyfile.example` — Example reverse proxy config
- `docs/SETUP.md` — Full setup guide
- `docs/BUILDING-APPS.md` — Guide for building embedded apps
- `docs/BACKEND-API.md` — Gateway WebSocket/HTTP protocol spec
- `docs/GOALS-PLUGIN.md` — Goals plugin specification (data model, all RPC methods, hooks, tools)
