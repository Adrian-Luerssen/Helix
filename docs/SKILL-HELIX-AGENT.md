# SKILL-HELIX-AGENT: External Agent Workflow Guide

This guide documents the full workflow for external agents (e.g., Telegram agents, API integrations) to drive Helix's PM cascade programmatically using agent tools.

## Overview

External agents can now orchestrate projects without the web dashboard by using these tools:

| Tool | Purpose |
|------|---------|
| `condo_list` | List all condos with goal counts |
| `condo_bind` | Bind to an existing condo or create a new one (supports `repoUrl`) |
| `condo_pm_chat` | Send a work request to the PM — PM plans goals and tasks |
| `condo_pm_kickoff` | Approve a plan and spawn worker agents |
| `condo_status` | Check progress on a condo's goals and tasks |
| `goal_update` | Report on tasks assigned to you |

## Workflow

### 1. Find or Create a Condo

List existing condos:
```
condo_list → shows all condos with IDs and goal counts
```

Bind to an existing condo:
```
condo_bind({ condoId: "condo_abc123" })
```

Or create a new condo with a git repo:
```
condo_bind({ name: "My Project", description: "A new project", repoUrl: "https://github.com/org/repo.git" })
```

### 2. Send Work Request to PM

Use `condo_pm_chat` to describe what you want built. The PM will analyze the request, create a plan with goals and tasks, and return its response:

```
condo_pm_chat({
  condoId: "condo_abc123",
  message: "Build a landing page with hero section, feature grid, and contact form"
})
```

The PM response will include:
- A plan describing the goals and tasks
- Any clarifying questions (if the request is ambiguous)
- Auto-created goals if the PM produced a clear plan

You can have a multi-turn conversation with the PM by calling `condo_pm_chat` multiple times.

### 3. Review and Kick Off

After the PM creates goals with tasks, approve and spawn workers:

```
condo_pm_kickoff({
  condoId: "condo_abc123",
  goalId: "goal_xyz789"
})
```

If the goal already has tasks, workers are spawned immediately. If the goal has no tasks yet, the PM goal cascade is triggered to create tasks first, then workers are auto-spawned.

### 4. Monitor Progress

Check the status of goals and tasks:

```
condo_status({ condoId: "condo_abc123" })
```

This returns:
- Condo info (name, workspace path)
- All goals with their status
- Task breakdown with assignment and progress info

## Example: Full Workflow

```
User: "Build a landing page for our startup"

Agent:
1. condo_list()
   → Found 2 condos: "Marketing Site" (condo_mk1), "Backend API" (condo_be2)

2. condo_bind({ condoId: "condo_mk1" })
   → Session bound to "Marketing Site"

3. condo_pm_chat({ condoId: "condo_mk1", message: "Build a landing page with hero section, feature highlights, and a contact form. Use Next.js and Tailwind CSS." })
   → PM Response: Created goal "Landing Page" (goal_lp1) with 4 tasks:
     - Design hero section layout
     - Implement feature highlights grid
     - Build contact form with validation
     - Write tests and deploy

4. condo_pm_kickoff({ condoId: "condo_mk1", goalId: "goal_lp1" })
   → Kickoff complete: spawned 4 worker sessions

5. condo_status({ condoId: "condo_mk1" })
   → Landing Page: 1/4 tasks done, 3 in progress
```

## Notes

- `condo_pm_chat` has a 3-minute timeout waiting for the PM to respond. If the PM is still processing, check back with `condo_status`.
- The PM may ask clarifying questions instead of immediately creating a plan. Continue the conversation with additional `condo_pm_chat` calls.
- `condo_pm_kickoff` handles both cases: goals with existing tasks (direct kickoff) and goals without tasks (triggers PM goal cascade first).
- Workers report progress via `goal_update`. When all tasks in a goal complete, the goal's worktree branch is auto-merged.
