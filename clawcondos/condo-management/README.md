# Helix Goals Plugin (`clawcondos-goals`)

An [OpenClaw](https://github.com/acastellana/openclaw) plugin for managing goals, tasks, and condos (projects). Provides 26 gateway RPC methods, 2 lifecycle hooks, and 9 agent tools.

## Features

- **Goals** — Create, track, and complete goals with tasks and deadlines
- **Condos** — Group goals into projects ("condos") for multi-goal orchestration
- **Condo Workspaces** — Git-initialized workspace per condo with worktrees per goal for isolated parallel development (optional, enabled via `CLAWCONDOS_WORKSPACES_DIR`)
- **Session Binding** — Map agent sessions to goals or condos for context injection
- **Agent Tools** — Agents can report progress, create goals, and spawn sub-agents
- **Context Injection** — Automatically prepend goal/project context to agent prompts (includes workspace paths when available)
- **Session Classification** — Auto-route unbound sessions to condos via keyword/topic pattern matching
- **Learning Loop** — Track classification corrections and suggest keyword improvements
- **File-backed Storage** — JSON storage with atomic writes, no database required

## Installation

```bash
# From the OpenClaw gateway:
openclaw plugins install -l /path/to/clawcondos/condo-management
```

Or symlink into your extensions directory:

```bash
ln -sf /path/to/clawcondos/condo-management ~/.openclaw/extensions/clawcondos-goals
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

### Condo Workspaces (optional)

Set `CLAWCONDOS_WORKSPACES_DIR` (or `workspacesDir` in plugin config) to enable git workspace creation for condos and git worktrees for goals:

```bash
export CLAWCONDOS_WORKSPACES_DIR=$HOME/clawcondos-workspaces
```

When enabled, each new condo gets a git-initialized workspace directory, and each goal within it gets a dedicated git worktree (branch: `goal/<goalId>`). This allows agents to work on multiple goals simultaneously without conflicts. See [docs/GOALS-PLUGIN.md](../../docs/GOALS-PLUGIN.md) for the full workspace specification.

## API Overview

| Category | Methods |
|----------|---------|
| Goals CRUD | `goals.list`, `goals.create`, `goals.get`, `goals.update`, `goals.delete` |
| Sessions | `goals.addSession`, `goals.removeSession`, `goals.sessionLookup` |
| Session-Condo | `goals.setSessionCondo`, `goals.getSessionCondo`, `goals.listSessionCondos`, `goals.removeSessionCondo` |
| Tasks | `goals.addTask`, `goals.updateTask`, `goals.deleteTask` |
| Condos CRUD | `condos.create`, `condos.list`, `condos.get`, `condos.update`, `condos.delete` |
| Spawning | `goals.spawnTaskSession` |
| Classification | `classification.stats`, `classification.learningReport`, `classification.applyLearning` |

**Hooks:** `before_agent_start` (context injection), `agent_end` (activity tracking)

**Agent Tools:** `goal_update`, `condo_bind`, `condo_create_goal`, `condo_add_task`, `condo_spawn_task`, `condo_list`, `condo_status`, `condo_pm_chat`, `condo_pm_kickoff`

## Documentation

See [docs/GOALS-PLUGIN.md](../../docs/GOALS-PLUGIN.md) for the full specification including data model, validation rules, and architecture diagrams.

## Testing

Tests live in the parent project's `tests/` directory. From the project root:

```bash
npm test
```

## License

[MIT](../../LICENSE)
