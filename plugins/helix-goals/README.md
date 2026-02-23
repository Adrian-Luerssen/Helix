# Helix Goals Plugin (`helix-goals`)

An [OpenClaw](https://github.com/acastellana/openclaw) plugin for managing goals, tasks, and strands (projects). Provides 26 gateway RPC methods, 2 lifecycle hooks, and 9 agent tools.

## Features

- **Goals** — Create, track, and complete goals with tasks and deadlines
- **Strands** — Group goals into projects ("strands") for multi-goal orchestration
- **Strand Workspaces** — Git-initialized workspace per strand with worktrees per goal for isolated parallel development (optional, enabled via `HELIX_WORKSPACES_DIR`)
- **Session Binding** — Map agent sessions to goals or strands for context injection
- **Agent Tools** — Agents can report progress, create goals, and spawn sub-agents
- **Context Injection** — Automatically prepend goal/project context to agent prompts (includes workspace paths when available)
- **Session Classification** — Auto-route unbound sessions to strands via keyword/topic pattern matching
- **Learning Loop** — Track classification corrections and suggest keyword improvements
- **File-backed Storage** — JSON storage with atomic writes, no database required

## Installation

```bash
# From the OpenClaw gateway:
openclaw plugins install -l /path/to/helix/helix/strand-management
```

Or symlink into your extensions directory:

```bash
ln -sf /path/to/helix/helix/strand-management ~/.openclaw/extensions/helix-goals
```

## Configuration

Optional — set in your OpenClaw plugin config:

```json
{
  "dataDir": "/custom/path/to/data",
  "workspacesDir": "/path/to/workspaces"
}
```

Default data directory: `.data/` inside the plugin directory.

### Strand Workspaces (optional)

Set `HELIX_WORKSPACES_DIR` (or `workspacesDir` in plugin config) to enable git workspace creation for strands and git worktrees for goals:

```bash
export HELIX_WORKSPACES_DIR=$HOME/helix-workspaces
```

When enabled, each new strand gets a git-initialized workspace directory, and each goal within it gets a dedicated git worktree (branch: `goal/<goalId>`). This allows agents to work on multiple goals simultaneously without conflicts. See [docs/GOALS-PLUGIN.md](../../docs/GOALS-PLUGIN.md) for the full workspace specification.

## API Overview

| Category | Methods |
|----------|---------|
| Goals CRUD | `goals.list`, `goals.create`, `goals.get`, `goals.update`, `goals.delete` |
| Sessions | `goals.addSession`, `goals.removeSession`, `goals.sessionLookup` |
| Session-Strand | `goals.setSessionStrand`, `goals.getSessionStrand`, `goals.listSessionStrands`, `goals.removeSessionStrand` |
| Tasks | `goals.addTask`, `goals.updateTask`, `goals.deleteTask` |
| Strands CRUD | `strands.create`, `strands.list`, `strands.get`, `strands.update`, `strands.delete` |
| Spawning | `goals.spawnTaskSession` |
| Classification | `classification.stats`, `classification.learningReport`, `classification.applyLearning` |

**Hooks:** `before_agent_start` (context injection), `agent_end` (activity tracking)

**Agent Tools:** `goal_update`, `strand_bind`, `strand_create_goal`, `strand_add_task`, `strand_spawn_task`, `strand_list`, `strand_status`, `strand_pm_chat`, `strand_pm_kickoff`

## Documentation

See [docs/GOALS-PLUGIN.md](../../docs/GOALS-PLUGIN.md) for the full specification including data model, validation rules, and architecture diagrams.

## Testing

Tests live in the parent project's `tests/` directory. From the project root:

```bash
npm test
```

## License

[MIT](../../LICENSE)
