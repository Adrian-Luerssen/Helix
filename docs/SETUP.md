# ClawCondos Setup Guide

This guide covers deploying ClawCondos from quick local testing to production.

## Prerequisites

- **Node.js 18+** (for the server)
- **OpenClaw Gateway** running (ClawCondos connects to it for sessions)
- **Caddy** (recommended for production) or nginx

## Quick Start (Try It Out)

Just want to see it? This takes 2 minutes:

```bash
# Clone and install
git clone https://github.com/acastellana/clawcondos.git
cd clawcondos
npm install

# Start the server
node serve.js
```

Open http://localhost:9000. You'll see the dashboard, but sessions won't load without a backend.

### Connect to OpenClaw Gateway

If you have OpenClaw running locally:

```bash
# Create config
cp config.example.json config.json

# Edit config.json - set your gateway URL
{
  "gatewayWsUrl": "ws://localhost:18789/ws",
  "gatewayHttpUrl": "http://localhost:18789"
}
```

Restart the server and login with your gateway password.

---

## Production Setup (Recommended)

For always-on deployment, use systemd + Caddy. This is what we actually run.

### Step 1: Create the systemd service

```bash
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/clawcondos.service << 'EOF'
[Unit]
Description=ClawCondos Dashboard
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/path/to/clawcondos
ExecStart=/usr/bin/node serve.js 9011
Restart=always
RestartSec=3
Environment=NODE_ENV=production
EnvironmentFile=%h/.config/clawcondos.env

[Install]
WantedBy=default.target
EOF
```

Replace `/path/to/clawcondos` with your actual path.

### Step 2: Create the environment file

```bash
cat > ~/.config/clawcondos.env << 'EOF'
# ClawCondos runtime configuration
GATEWAY_HTTP_HOST=127.0.0.1
GATEWAY_WS_URL=ws://127.0.0.1:18789/ws
GATEWAY_AUTH=your-gateway-token-here

# Condo workspaces — git repos per condo, worktrees per goal
# This MUST be set in BOTH the ClawCondos env AND the OpenClaw Gateway service
# for workspace/worktree features to work (the plugin runs inside the gateway).
# Create the directory first: mkdir -p /home/youruser/clawcondos-workspaces
CLAWCONDOS_WORKSPACES_DIR=/home/youruser/clawcondos-workspaces
EOF

chmod 600 ~/.config/clawcondos.env
```

### Step 3: Enable and start

```bash
systemctl --user daemon-reload
systemctl --user enable clawcondos
systemctl --user start clawcondos

# Check status
systemctl --user status clawcondos

# View logs
journalctl --user -u clawcondos -f
```

### Step 4: Set up Caddy (reverse proxy)

Caddy handles HTTPS and proxies requests:

```bash
# Install Caddy if needed
sudo apt install caddy  # Debian/Ubuntu
# or: brew install caddy  # macOS

# Create Caddyfile
cat > ~/Caddyfile << 'EOF'
:9000 {
    # WebSocket to ClawCondos server
    handle /ws {
        reverse_proxy localhost:9011
    }

    # API routes
    handle /api/* {
        reverse_proxy localhost:9011
    }

    # Media uploads
    handle /media-upload/* {
        reverse_proxy localhost:9011
    }

    # Gateway control UI (optional)
    handle /control/* {
        uri strip_prefix /control
        reverse_proxy localhost:18789
    }

    # Static files and dashboard
    handle {
        reverse_proxy localhost:9011
    }
}
EOF

# Run Caddy
caddy run --config ~/Caddyfile
```

For HTTPS with a domain, replace `:9000` with your domain:

```
your-domain.com {
    # same routes...
}
```

### Step 5: Verify

1. Open http://localhost:9000 (or your domain)
2. Login with your gateway password
3. You should see your sessions load

---

## Service Management

```bash
# Restart after code changes
systemctl --user restart clawcondos

# Stop
systemctl --user stop clawcondos

# View logs
journalctl --user -u clawcondos -f

# Disable auto-start
systemctl --user disable clawcondos
```

---

## Configuration Options

### config.json

```json
{
  "gatewayWsUrl": "ws://localhost:18789/ws",
  "gatewayHttpUrl": "http://localhost:18789",
  "branding": {
    "name": "ClawCondos",
    "logo": "/media/clawcondos-logo.png"
  },
  "features": {
    "showApps": true,
    "showSubagents": true
  },
  "sessions": {
    "pollInterval": 30000
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `gatewayWsUrl` | Auto-detect | WebSocket URL for backend |
| `gatewayHttpUrl` | Auto-detect | HTTP URL for REST API |
| `branding.name` | `"ClawCondos"` | Dashboard title |
| `branding.logo` | Crab logo | Logo image URL or emoji |
| `features.showApps` | `true` | Show apps section |
| `features.showSubagents` | `true` | Show sub-agents section |
| `sessions.pollInterval` | `30000` | Session refresh interval (ms) |

### Environment Variables

These override config.json:

| Variable | Description |
|----------|-------------|
| `GATEWAY_WS_URL` | WebSocket URL |
| `GATEWAY_HTTP_HOST` | HTTP host for gateway |
| `GATEWAY_AUTH` | Bearer token for gateway auth |
| `PORT` | Server port (default: 9000) |
| `CLAWCONDOS_WORKSPACES_DIR` | Base directory for condo git workspaces and goal worktrees (disabled if not set). **Must be set on the OpenClaw Gateway service** since the plugin runs there. |
| `CLAWCONDOS_CLASSIFICATION` | Set to `off` to disable auto-classification of unbound sessions |
| `CLAWCONDOS_AGENT_WORKSPACES` | JSON mapping agent IDs to workspace paths for introspection |
| `CLAWCONDOS_SKILLS_DIRS` | Colon-separated skill directory paths |

---

## Troubleshooting

### "Connection failed" / "Connecting..." stuck

1. Check gateway is running: `systemctl --user status clawdbot-gateway`
2. Verify WebSocket URL in config matches gateway port
3. Check browser console for detailed errors
4. Verify GATEWAY_AUTH token is correct

### Sessions not loading

1. Check gateway logs: `journalctl --user -u clawdbot-gateway -f`
2. Verify `sessions.list` method works (test via Control UI at /control)
3. Check for 401 errors (bad token)

### Apps showing "offline"

1. Verify the app is running on its configured port
2. Check Caddy is proxying the app route
3. Test direct access: `curl http://localhost:<app-port>`

### Service won't start

```bash
# Check for syntax errors
node --check serve.js

# Check env file exists and is readable
cat ~/.config/clawcondos.env

# Check permissions
ls -la ~/.config/clawcondos.env
```

---

## Docker (Alternative)

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

EXPOSE 9000
CMD ["node", "serve.js"]
```

```bash
docker build -t clawcondos .
docker run -p 9000:9000 \
  -e GATEWAY_WS_URL=ws://host.docker.internal:18789/ws \
  clawcondos
```

---

## Services Configuration

ClawCondos lets you configure external service integrations that agents can use autonomously. Configure these from the dashboard at **Settings** (gear icon in sidebar), or pre-configure them in the environment/store.

### GitHub

GitHub supports two auth modes:

#### Mode 1: Personal Access Token (simple)

Use your own GitHub PAT. Agents will use it for repo access, PRs, etc.

| Field | Description |
|-------|-------------|
| `token` | Your GitHub Personal Access Token (`ghp_...`) |
| `org` | Organization (optional) |

#### Mode 2: Agent Account (recommended for autonomous teams)

Give each agent (or a shared bot account) its own GitHub identity. The agent can create repos, branches, and PRs under its own account. You stay in control via the manager relationship.

| Field | Description |
|-------|-------------|
| `agentUsername` | GitHub username for the agent's account |
| `agentToken` | PAT for the agent's account (`ghp_...`) |
| `org` | Organization (optional) |
| `managerUsername` | Your GitHub username — the agent will share repos with you |
| `autoCollaborator` | If enabled, the agent auto-invites the manager as collaborator on every repo it creates |
| `autoTransfer` | If enabled, the agent transfers repo ownership to the manager when the work is done |

**How it works:**
1. Create a GitHub account for your agent (e.g. `clawdia-agent`)
2. Generate a PAT for that account with `repo`, `admin:org` scopes
3. In Settings, choose "Agent Account" mode and fill in both usernames
4. Enable auto-collaborator so you always have access
5. Optionally enable auto-transfer for final ownership handoff

This way agents can work fully autonomously — creating repos, pushing code, opening PRs — while you retain oversight and ownership.

### Vercel

| Field | Description |
|-------|-------------|
| `token` | Vercel API token |
| `team` | Team slug (optional) |

### Claude API

| Field | Description |
|-------|-------------|
| `apiKey` | Anthropic API key (`sk-ant-...`) |
| `model` | Default model name |

### Docker Hub

| Field | Description |
|-------|-------------|
| `token` | Docker Hub access token |
| `namespace` | Docker Hub namespace |

### Webhooks

| Field | Description |
|-------|-------------|
| `url` | Webhook endpoint URL |
| `secret` | Signing secret for verification |

### Per-Condo Overrides

Each condo (project) can override global service settings. Use this when different projects need different GitHub orgs, Vercel teams, or API keys. Set overrides from Settings > Per-Project tab, or in the condo context view.

### Pre-configuring Services

Services are stored in the goals data file. You can also set them via the `config.setService` RPC method programmatically:

```javascript
// Set global GitHub with agent account mode
rpcCall('config.setService', {
  service: 'github',
  config: {
    authMode: 'account',
    agentUsername: 'clawdia-agent',
    agentToken: 'ghp_...',
    managerUsername: 'your-username',
    autoCollaborator: true,
    autoTransfer: false,
  }
});

// Set per-condo override
rpcCall('config.setService', {
  service: 'github',
  config: { org: 'project-specific-org' },
  condoId: 'condo_abc123',
});
```

---

## Security Notes

- **Never commit** config files with real tokens to git
- Use environment variables or `.env` files for secrets
- The `.gitignore` excludes `config.json` and `.env` by default
- Consider Tailscale or VPN for secure remote access
- ClawCondos blocks external media embeds by default (see `features.allowExternalMedia`)
