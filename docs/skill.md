# Helix Skill

Goals-first dashboard for AI agents. Use this skill when setting up Helix or working with goals and multi-agent teams.

## Quick Setup

```bash
# 1. Clone and install
git clone https://github.com/acastellana/clawcondos.git
cd clawcondos && npm install

# 2. Create env file (~/.config/clawcondos.env)
cat > ~/.config/clawcondos.env << 'EOF'
GATEWAY_PASSWORD=your-gateway-token
CLAWCONDOS_AGENT_WORKSPACES={"main":"/path/to/main/workspace","felix":"/path/to/felix/workspace"}
EOF
chmod 600 ~/.config/clawcondos.env

# 3. Create systemd service
cat > ~/.config/systemd/user/clawcondos.service << 'EOF'
[Unit]
Description=Helix Dashboard
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/clawcondos
ExecStart=/usr/bin/node serve.js 9011
Restart=always
EnvironmentFile=%h/.config/clawcondos.env

[Install]
WantedBy=default.target
EOF

# 4. Enable and start
systemctl --user daemon-reload
systemctl --user enable --now clawcondos
```

## Auto-Configure Roles (First Run)

Helix can automatically detect your agents and suggest role assignments:

1. **Set agent workspaces** in `~/.config/clawcondos.env`:
   ```bash
   CLAWCONDOS_AGENT_WORKSPACES={"main":"/home/user/.openclaw/workspace","felix":"/home/user/.openclaw/workspace-felix","blake":"/home/user/.openclaw/workspace-blake"}
   ```

2. **Open Helix** and go to Settings → Roles

3. **Click "Auto-detect Roles"** - Helix will:
   - Read each agent's `SOUL.md` or `IDENTITY.md`
   - Analyze keywords to suggest appropriate roles
   - Show suggestions with confidence levels

4. **Review and apply** - adjust any suggestions that don't fit

The system looks for keywords like:
- `frontend`, `UI`, `React`, `Flutter`, `CSS` → **frontend** role
- `backend`, `API`, `database`, `server` → **backend** role  
- `design`, `UX`, `Figma`, `visual` → **designer** role
- `test`, `QA`, `quality` → **tester** role
- `research`, `analysis` → **researcher** role

## Role System

### How Roles Work

1. **Configure roles** → map role names to agent IDs
2. **PM creates plans** → assigns tasks to roles (not specific agents)
3. **Kickoff** → system resolves roles to agents and spawns sessions

### Role Descriptions

Each role should have a description explaining capabilities:
```
frontend: "UI/UX specialist. React, Flutter, CSS, responsive design."
backend: "API developer. Node.js, databases, authentication, performance."
designer: "Visual design. Figma, branding, icons, color schemes."
```

The PM receives these descriptions when creating plans, so it can intelligently distribute work.

### Built-in Roles

- **pm** - Project Manager (always exists, coordinates the team)
- **frontend** - UI/UX implementation
- **backend** - APIs and server-side logic
- **designer** - Visual design and UX
- **tester** - QA and testing
- **researcher** - Research and analysis

You can create custom roles for any specialty (marketing, devops, security, etc.)

## PM Workflow

### Creating a Plan

1. Create a goal in Helix
2. Click "💬 PM" to chat with the Project Manager
3. Describe what you want to build
4. PM creates a plan with tasks assigned to roles
5. Review and approve the plan
6. Click "🚀 Kickoff" to spawn agent sessions

### PM Skills

The PM automatically receives:
- List of available roles and their descriptions
- Instructions for creating actionable plans
- Guidelines for task distribution

See `docs/SKILL-PM.md` for the full PM skill.

## Worker Workflow

When agents are spawned via kickoff, they receive:
- Their assigned task details
- Goal context
- Instructions for status updates
- Communication guidelines

See `docs/SKILL-WORKER.md` for the full worker skill.

## Working with Goals

When goal context is injected (`# Goal:` in your prompt):

```javascript
// Start task
goal_update({ taskId: "task_xxx", status: "in-progress" })

// Complete task  
goal_update({ taskId: "task_xxx", status: "done", summary: "What you did" })

// Add tasks
goal_update({ addTasks: [{ text: "New task" }] })

// Complete goal
goal_update({ goalStatus: "done" })
```

## Operations

```bash
systemctl --user restart clawcondos  # restart
systemctl --user status clawcondos   # check status
journalctl --user -u clawcondos -f   # view logs
```

## Links

- Setup Guide: https://github.com/acastellana/clawcondos/blob/master/docs/SETUP.md
- API Reference: https://github.com/acastellana/clawcondos/blob/master/docs/BACKEND-API.md
- GitHub: https://github.com/acastellana/clawcondos
