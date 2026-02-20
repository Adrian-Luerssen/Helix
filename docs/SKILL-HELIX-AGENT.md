# SKILL-HELIX-AGENT: Quick Reference for External Agents

> Full reference: see [SKILL-AGENT.md](./SKILL-AGENT.md)

This is a quick-start for agents that operate outside the Helix dashboard (e.g., Telegram, API integrations) and need to drive the PM cascade programmatically.

## Minimal Workflow

```
1. condo_list()                              → find existing condos
2. condo_bind({ condoId: "..." })            → bind to a project
   — OR —
   condo_bind({ name: "...", repoUrl: "..." }) → create + bind
3. condo_pm_chat({ condoId, message })       → tell PM what to build (blocks up to 3min)
4. condo_pm_kickoff({ condoId, goalId })     → approve plan, spawn workers
5. condo_status({ condoId })                 → check progress
```

## Tool Reference

| Tool | Required Params | Returns |
|------|----------------|---------|
| `condo_list` | — | All condos with IDs and goal counts |
| `condo_bind` | `condoId` or `name` | Binds session; creates condo if `name` given |
| `condo_pm_chat` | `condoId`, `message` | PM response text + auto-created goals (if any) |
| `condo_pm_kickoff` | `condoId`, `goalId` | Spawned session count or cascade confirmation |
| `condo_status` | `condoId` | Full project status with all goals and tasks |
| `goal_update` | `taskId`, `status` | Confirms update (only for tasks assigned to you) |

## Key Behaviors

- `condo_pm_chat` is **synchronous** — it sends to the PM and polls for a response (3s intervals, 3min timeout). If it times out, the PM is still working; check `condo_status` later.
- `condo_pm_kickoff` handles **both cases**: if the goal has tasks, it spawns workers immediately; if it has no tasks, it triggers the PM goal cascade first.
- **Do not use** `condo_create_goal`, `condo_add_task`, or `condo_spawn_task` — these bypass PM planning.
- Workers auto-cascade: completed tasks automatically unblock and spawn dependent tasks.
- Goal branches auto-merge to main when all tasks complete.
