# ClawCondos 🏙️

**A goals-first multi-agent dashboard**

ClawCondos is a sleek, mobile-responsive web dashboard for managing multiple AI agent sessions organized into "Condos" (Goals). Built as part of the [Clawdbot](https://github.com/clawdbot) ecosystem, it provides a unified interface for chatting with agents, embedding apps, and monitoring background tasks.

## Features

- **🏙️ Goals-First (Condos)** — Organize sessions into high-level goals/projects
- **📱 Sessions Sidebar** — View and switch between sessions with search and filters
- **🔍 Smart Filters** — Filter by channel (Telegram, Discord, etc.) and status (Running, Unread, Error)
- **💬 Chat Interface** — Streaming responses, tool activity, message queue
- **📲 Mobile-Responsive** — Works on phones, tablets, and desktops
- **🌙 Dark Theme** — Premium dark color scheme
- **⚡ Real-time Updates** — WebSocket-based with live status
- **🤖 Organize Wizard** — AI-assisted backlog triage
- **📦 Session Management** — Pin, archive, rename, auto-archive

## Quick Start

ClawCondos is a static HTML/JS application. Serve it with any web server:

```bash
# Node.js (with proxy)
node serve.js 9011

# Python
python3 -m http.server 9011
```

Then open `http://localhost:9011`

## Configuration

Copy `config.example.json` to `config.json`:

```json
{
  "gatewayWsUrl": "wss://your-gateway/ws",
  "gatewayHttpUrl": "https://your-gateway"
}
```

## Project Structure

```
clawcondos/
├── index.html           # Main dashboard (all-in-one)
├── app.html             # App viewer with assistant panel
├── styles/main.css      # Extracted CSS
├── lib/config.js        # Configuration loader
├── .registry/apps.json  # App registry (gitignored)
├── docs/                # Documentation
├── specs/               # Feature specifications
└── tests/               # Vitest tests
```

## Backend API

ClawCondos connects via WebSocket to a Clawdbot gateway. Required methods:

| Method | Description |
|--------|-------------|
| `connect` | Authenticate session |
| `chat.send` | Send message to agent |
| `chat.history` | Get message history |
| `chat.abort` | Cancel running agent |
| `sessions.list` | List sessions |

See [Backend API Documentation](docs/BACKEND-API.md).

## Testing

```bash
npm install
npm test              # Run tests
npm run test:watch    # Watch mode
```

## Development

No build step. Edit `index.html` and refresh.

## License

[MIT](LICENSE) © 2024-2026 Albert Castellana
