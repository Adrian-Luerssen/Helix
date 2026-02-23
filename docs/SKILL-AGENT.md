# SKILL-AGENT: Helix Interaction Guide

You are an AI agent operating within **Helix**, a goals-first multi-agent orchestration platform.

---

## System Architecture

Helix organizes work into three levels:

```
Strand (Project)  ← a project container with a git workspace
  └── Goal       ← an objective within the project (gets its own git worktree/branch)
        └── Task ← a unit of work assigned to one agent session
```

### The PM Cascade

All work goes through a Project Manager (PM) cascade. You never create goals or tasks directly — PMs do that:

1. You send a work request to the **Strand PM** via `strand_pm_chat`
2. The Strand PM breaks the request into **goals** with tasks, dependencies, and agent role assignments
3. You approve and kick off goals via `strand_pm_kickoff`
4. Each goal's tasks are assigned to **worker agents** that execute them in parallel (respecting dependency ordering)
5. Workers report progress via `goal_update`. When all tasks complete, the goal's branch auto-merges to main.

This cascade ensures proper sequencing, dependency tracking, role allocation, and parallel execution.

### Sessions and Binding

Every agent conversation is a **session** identified by a session key (e.g., `agent:main:telegram:group:123:topic:456`). Sessions can be **bound** to a strand, which gives the agent access to that project's context, goals, and PM tools.

- An **unbound session** sees a menu of available strands and can bind to one via `strand_bind`
- A **strand-bound session** sees the full project context (goals, tasks, progress) and has access to PM tools
- A **worker session** is spawned by the kickoff process and assigned to a specific task

---

## Your Tools

### Discovery and Status

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `strand_list` | *(none)* | Lists all strands with IDs, descriptions, and goal counts |
| `strand_status` | `strandId` | Full project status: goals, tasks, assignments, progress |

### Binding

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `strand_bind` | `strandId` | Binds your session to an existing strand |
| `strand_bind` | `name`, `description`, `repoUrl` | Creates a new strand (with optional git repo clone) and binds |

### PM Interaction

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `strand_pm_chat` | `strandId`, `message` | Sends a work request to the PM. Returns PM's response (plan, questions, or goals). Blocks up to 3 minutes while PM processes. |
| `strand_pm_kickoff` | `strandId`, `goalId` | Approves a goal and spawns worker agents. If goal has no tasks yet, triggers PM goal cascade to plan tasks first, then auto-spawns workers. |

### Progress Reporting (for workers)

| Tool | Parameters | What it does |
|------|-----------|--------------|
| `goal_update` | `taskId`, `status`, `summary`, `files` | Reports progress on a task assigned to you. Status: `in-progress`, `done`, `blocked`, `waiting`. |

### Tools You Must NOT Use

| Tool | Why not |
|------|---------|
| `strand_create_goal` | Bypasses PM — creates goals without task planning, agent assignments, or dependency sequencing |
| `strand_add_task` | Bypasses PM — creates tasks without role assignments, ordering, or dependencies |
| `strand_spawn_task` | Use `strand_pm_kickoff` instead — it handles both the "has tasks" and "needs PM cascade" cases |

---

## Workflow: Handling a Work Request

### Step 1: Find or Create a Strand

```
strand_list()
→ Shows all strands. Find the relevant one, or create a new one:

strand_bind({ strandId: "strand_abc123" })
→ Binds your session to an existing strand

strand_bind({ name: "My Project", description: "...", repoUrl: "https://github.com/org/repo.git" })
→ Creates a new strand with a cloned git repo and binds to it
```

### Step 2: Send Work Request to PM

```
strand_pm_chat({ strandId: "strand_abc123", message: "Build a landing page with hero, features grid, and contact form" })
→ PM analyzes the request and responds with a plan
→ If the plan is clear, goals are auto-created from it
→ If the request is ambiguous, PM asks clarifying questions
```

You can call `strand_pm_chat` multiple times for a multi-turn conversation with the PM.

### Step 3: Review the PM's Response

The PM response is returned in the tool result. It includes:
- The PM's plan or questions
- A list of any goals created (with IDs and task counts)

Share the PM's response with the user and confirm they want to proceed.

### Step 4: Kick Off

```
strand_pm_kickoff({ strandId: "strand_abc123", goalId: "goal_xyz789" })
→ If goal has tasks: spawns worker agents immediately
→ If goal has no tasks: triggers PM goal cascade to create tasks, then auto-spawns workers
```

### Step 5: Monitor Progress

```
strand_status({ strandId: "strand_abc123" })
→ Shows all goals with task status, assignments, and progress
```

Check periodically and relay status to the user.

---

## Understanding Your Session Context

When bound to a strand, you receive injected context that looks like:

```
[SESSION SCOPE: strand strand_abc123] This session is exclusively for strand "My Project".

# Strand: My Project
Workspace: /path/to/workspace

## Goals

<goal id="goal_1" status="active">
### Landing Page
Tasks (1/3 done):
- [done] Design mockups [task_1]
  > Completed 3 variants
- [in-progress] Implement layout [task_2] (agent: agent:main:webchat:task-abc)
- [pending] Write tests [task_3] — unassigned
</goal>

---
Active: 1 goals, 2 pending tasks | Completed: 0 goals
```

Key markers in task lists:
- `← you` — this task is assigned to your session
- `(agent: ...)` — assigned to another agent
- `— unassigned` — PM hasn't assigned it yet (will be assigned during kickoff)

---

## Role-Specific Behavior

### As a Conversational Agent (talking to a user)

- **Answer questions and discuss** — you don't need tools for conversation
- **Route work requests to PM** — use `strand_pm_chat`, not direct goal/task creation
- **Relay status** — use `strand_status` and share results with the user
- **Approve plans** — use `strand_pm_kickoff` after confirming with the user
- **Quick tasks** — if the user wants a small thing done in-conversation (code snippet, quick answer), just do it directly without creating Helix goals

### As a Worker Agent (assigned to a task)

- **Focus on your task** — the one marked `← you`
- **Report progress** via `goal_update` with status updates
- **Use your workspace** — `cd` to the working directory if one is provided
- **Mark done when finished** — `goal_update({ taskId: "...", status: "done", summary: "...", files: [...] })`
- See SKILL-WORKER.md for detailed worker protocols

---

## Example: End-to-End

```
User: "I need a React dashboard for our analytics data"

1. strand_list()
   → Found: "Analytics Platform" (strand_ap1)

2. strand_bind({ strandId: "strand_ap1" })
   → Bound to "Analytics Platform"

3. strand_pm_chat({
     strandId: "strand_ap1",
     message: "Build a React dashboard showing key metrics with charts, filters, and a data table. Use Recharts for visualization."
   })
   → PM Response: Created goal "Analytics Dashboard" (goal_ad1) with 4 tasks:
     1. Set up React project with routing
     2. Build chart components with Recharts
     3. Implement filter sidebar
     4. Create data table with sorting/pagination

4. strand_pm_kickoff({ strandId: "strand_ap1", goalId: "goal_ad1" })
   → Spawned 4 worker sessions (tasks 1-2 started in parallel; 3-4 waiting on dependencies)

5. strand_status({ strandId: "strand_ap1" })
   → goal_ad1: 2/4 tasks done, 2 in progress
```

---

## Important Notes

- `strand_pm_chat` blocks for up to 3 minutes while the PM processes. If it times out, the PM may still be working — check with `strand_status`.
- `strand_pm_kickoff` is idempotent for goals that already have running workers — it only spawns sessions for unassigned pending tasks.
- When all tasks in a goal complete, the goal's git branch is auto-merged to main. No manual merge needed.
- Workers auto-cascade: when a task completes, any dependent tasks that are now unblocked are automatically kicked off.

---

## Reference Documentation

For deeper understanding of the system internals:

- **[BACKEND-API.md](BACKEND-API.md)** — WebSocket/RPC protocol specification (message format, all gateway methods, event types)
- **[GOALS-PLUGIN.md](GOALS-PLUGIN.md)** — Data model, all 26 RPC methods, lifecycle hooks, agent tools, workspace management
- **[SETUP.md](SETUP.md)** — Deployment and configuration guide (systemd, Caddy, environment variables)
