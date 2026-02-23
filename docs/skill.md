# Helix Skill

Goals-first dashboard for AI agents. Use this skill when setting up Helix, operating it, or working with goals and multi-agent teams.

## What Helix Is

Helix is a self-hosted web UI for orchestrating AI agent sessions organized into projects ("Strands") with goals and tasks. It connects to an OpenClaw gateway via WebSocket and provides real-time dashboards, agent coordination, and an embedded apps platform.

## Quick Setup

```bash
# 1. Clone and install
git clone https://github.com/Adrian-Luerssen/Helix.git
cd Helix && npm install

# 2. Create config
cp config.example.json config.json
# Edit config.json with your gateway URL

# 3. Start
node serve.js
# Open http://localhost:9000
```

For production deployment with systemd and Caddy, see [SETUP.md](https://github.com/Adrian-Luerssen/Helix/blob/master/docs/SETUP.md).

## Configuration

### config.json

```json
{
  "gatewayWsUrl": "ws://localhost:18789/ws",
  "gatewayHttpUrl": "http://localhost:18789"
}
```

### Environment Variables

Set in your env file (e.g., `~/.config/helix.env`):

| Variable | Description |
|----------|-------------|
| `GATEWAY_AUTH` | Bearer token for gateway auth |
| `GATEWAY_WS_URL` | WebSocket URL for gateway |
| `GATEWAY_HTTP_HOST` | HTTP host for gateway |
| `HELIX_WORKSPACES_DIR` | Base directory for strand git workspaces (disabled if not set) |
| `HELIX_AGENT_WORKSPACES` | JSON mapping agent IDs to workspace paths |
| `HELIX_SKILLS_DIRS` | Colon-separated skill directory paths |
| `HELIX_CLASSIFICATION` | Set to `off` to disable auto-classification |

### Strand Workspaces

Enable git workspace creation for strands and git worktrees for goals:

```bash
export HELIX_WORKSPACES_DIR=/home/youruser/helix-workspaces
```

Each strand gets a git-initialized workspace, and each goal gets a dedicated worktree (branch: `goal/<goalId>`).

## Role System

### How Roles Work

1. **Configure roles** in Settings — map role names to agent IDs
2. **PM creates plans** — assigns tasks to roles (not specific agents)
3. **Kickoff** — system resolves roles to agents and spawns sessions

### Auto-detect Roles

1. Set agent workspaces in your env file
2. Open Helix → Settings → Roles
3. Click "Auto-detect Roles" — Helix reads each agent's identity file and suggests roles

### Built-in Roles

- **pm** — Project Manager (always exists, coordinates the team)
- **frontend** — UI/UX implementation
- **backend** — APIs and server-side logic
- **designer** — Visual design and UX
- **tester** — QA and testing
- **researcher** — Research and analysis

You can create custom roles for any specialty.

## PM Workflow

### Creating a Plan

1. Create a goal in Helix
2. Click "PM" to chat with the Project Manager
3. Describe what you want to build
4. PM creates a plan with tasks assigned to roles
5. Review and approve the plan
6. Click "Kickoff" to spawn agent sessions

See `SKILL-PM.md` for the full PM skill.

## Agent Workflow

When agents are spawned via kickoff, they receive their task details, goal context, workspace path, and communication guidelines. Agents report progress via `goal_update` and coordinate through the PM cascade.

See [SKILL-AGENT.md](https://github.com/Adrian-Luerssen/Helix/blob/master/docs/SKILL-AGENT.md) for the full agent interaction guide (tools, workflows, session context).

## Operations

```bash
# systemd service management
systemctl --user restart helix    # restart
systemctl --user status helix     # check status
journalctl --user -u helix -f     # view logs
```

## Reference Documentation

- [SETUP.md](https://github.com/Adrian-Luerssen/Helix/blob/master/docs/SETUP.md) — Full deployment and configuration guide
- [BACKEND-API.md](https://github.com/Adrian-Luerssen/Helix/blob/master/docs/BACKEND-API.md) — WebSocket/RPC protocol specification
- [GOALS-PLUGIN.md](https://github.com/Adrian-Luerssen/Helix/blob/master/docs/GOALS-PLUGIN.md) — Goals plugin data model, RPC methods, hooks, and tools
- [BUILDING-APPS.md](https://github.com/Adrian-Luerssen/Helix/blob/master/docs/BUILDING-APPS.md) — Guide for building embedded apps
- [GitHub](https://github.com/Adrian-Luerssen/Helix)
