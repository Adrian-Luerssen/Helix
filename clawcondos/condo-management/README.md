# ClawCondos Goals Plugin (`clawcondos-goals`)

An [OpenClaw](https://github.com/acastellana/openclaw) plugin for managing goals, tasks, and condos (projects). Provides 21 gateway RPC methods, 2 lifecycle hooks, and 5 agent tools.

## Features

- **Goals** — Create, track, and complete goals with tasks and deadlines
- **Condos** — Group goals into projects ("condos") for multi-goal orchestration
- **Session Binding** — Map agent sessions to goals or condos for context injection
- **Agent Tools** — Agents can report progress, create goals, and spawn sub-agents
- **Context Injection** — Automatically prepend goal/project context to agent prompts
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
  "dataDir": "/custom/path/to/data"
}
```

Default data directory: `.data/` inside the plugin directory.

## API Overview

| Category | Methods |
|----------|---------|
| Goals CRUD | `goals.list`, `goals.create`, `goals.get`, `goals.update`, `goals.delete` |
| Sessions | `goals.addSession`, `goals.removeSession`, `goals.sessionLookup` |
| Session-Condo | `goals.setSessionCondo`, `goals.getSessionCondo`, `goals.listSessionCondos`, `goals.removeSessionCondo` |
| Tasks | `goals.addTask`, `goals.updateTask`, `goals.deleteTask` |
| Condos CRUD | `condos.create`, `condos.list`, `condos.get`, `condos.update`, `condos.delete` |
| Spawning | `goals.spawnTaskSession` |

**Hooks:** `before_agent_start` (context injection), `agent_end` (activity tracking)

**Agent Tools:** `goal_update`, `condo_bind`, `condo_create_goal`, `condo_add_task`, `condo_spawn_task`

## Documentation

See [docs/GOALS-PLUGIN.md](../../docs/GOALS-PLUGIN.md) for the full specification including data model, validation rules, and architecture diagrams.

## Testing

Tests live in the parent project's `tests/` directory. From the project root:

```bash
npm test
```

## License

[MIT](../../LICENSE)
