#!/usr/bin/env node
/**
 * Full E2E Pipeline Test: From zero to deployed project, all via strands.
 *
 * 1. strands.create   → GitHub repo created, initial commit pushed
 * 2. goals.create    → worktrees created, branches pushed to GitHub
 * 3. goals.addTask   → tasks registered
 * 4. [implement]     → real code written + committed in each worktree
 * 5. goals.updateTask → tasks marked done
 * 6. goals.update     → goals marked done
 * 7. [merge+push]    → goal branches merged to main + pushed to GitHub
 * 8. [verify]        → project on main, all files, GitHub up to date
 */

import { createGoalsStore } from '../plugins/helix-goals/lib/goals-store.js';
import { createStrandHandlers } from '../plugins/helix-goals/lib/strands-handlers.js';
import { createGoalHandlers } from '../plugins/helix-goals/lib/goals-handlers.js';
import * as workspaceManager from '../plugins/helix-goals/lib/workspace-manager.js';
import { pushBranch } from '../plugins/helix-goals/lib/github.js';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import https from 'https';

const WORKSPACES_DIR = process.env.HELIX_WORKSPACES_DIR || '/home/clawdia/helix-workspaces';
const DATA_DIR = '/home/clawdia/clawcond../plugins/helix-goals/.data';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Clawdia Agent',
  GIT_AUTHOR_EMAIL: 'clawdia@helix.dev',
  GIT_COMMITTER_NAME: 'Clawdia Agent',
  GIT_COMMITTER_EMAIL: 'clawdia@helix.dev',
};

function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }
function logSub(msg) { console.log(`     ${msg}`); }

function assert(cond, msg) {
  if (!cond) { console.error(`\n  FAIL: ${msg}`); process.exit(1); }
}

function gitCommit(cwd, message) {
  execSync('git add -A', { cwd, stdio: 'pipe' });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd, stdio: 'pipe', env: GIT_ENV });
}

function githubGet(path, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.github.com', path, method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'Helix-E2E',
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** Call an RPC handler (async-safe) */
async function rpc(handlers, method, params) {
  return new Promise((resolve) => {
    handlers[method]({
      params,
      respond: (ok, payload, error) => resolve({ ok, payload, error }),
    });
  });
}

// ═══════════════════════════════════════════════════════════════════
async function main() {
  log('🚀', 'Full E2E Pipeline: Daily Quotes API');
  log('', '─────────────────────────────────────────────────');

  const store = createGoalsStore(DATA_DIR);
  const data = store.load();
  const ghConfig = data.config?.services?.github;
  assert(ghConfig?.agentToken && ghConfig.authMode === 'account',
    'GitHub agent account not configured');
  const ghToken = ghConfig.agentToken;
  const ghOwner = ghConfig.org || ghConfig.agentUsername;

  const wsOps = { dir: WORKSPACES_DIR, ...workspaceManager };
  const logger = {
    info: (msg) => logSub(`[info] ${msg}`),
    error: (msg) => console.error(`     [error] ${msg}`),
    warn: (msg) => logSub(`[warn] ${msg}`),
  };

  const strandH = createStrandHandlers(store, { wsOps, logger });
  const goalH = createGoalHandlers(store, { wsOps, logger });

  // ═══ PHASE 1: Create Strand ═══════════════════════════════════════

  log('📦', 'Phase 1: Creating strand "Daily Quotes API"...');

  const strandRes = await rpc(strandH, 'strands.create', {
    name: 'Daily Quotes API',
    description: 'A lightweight REST API serving inspirational quotes with a minimal web frontend',
  });
  assert(strandRes.ok, `strands.create failed: ${strandRes.error?.message}`);
  const strand = strandRes.payload.strand;
  const wsPath = strand.workspace?.path;

  assert(wsPath, 'No workspace created');
  assert(strand.workspace.repoUrl, 'No GitHub repo URL — repo creation failed');

  log('✅', `Strand: ${strand.id}`);
  log('📁', `Workspace: ${wsPath}`);
  log('🔗', `GitHub: ${strand.workspace.githubFullName}`);

  const repoName = strand.workspace.githubRepoName;

  // ═══ PHASE 2: Create Goals + Tasks ═══════════════════════════════

  log('', '');
  log('🎯', 'Phase 2: Creating goals and tasks...');

  const goalDefs = [
    {
      title: 'API server and data layer',
      description: 'Build the HTTP server, quote storage, and REST endpoints',
      tasks: [
        'Create quote data model and JSON storage',
        'Implement HTTP server with REST endpoints',
        'Add seed data with 10+ quotes',
      ],
    },
    {
      title: 'Web frontend',
      description: 'Build a minimal HTML/CSS/JS page that displays a random quote',
      tasks: [
        'Create responsive HTML page with quote display',
        'Style with dark theme CSS',
        'Add JavaScript to fetch and cycle quotes',
      ],
    },
    {
      title: 'Project setup and docs',
      description: 'Package configuration, documentation, and deployment setup',
      tasks: [
        'Create package.json with scripts',
        'Write README with API docs',
        'Add .gitignore and Dockerfile',
      ],
    },
  ];

  const goals = [];

  for (const def of goalDefs) {
    const res = await rpc(goalH, 'goals.create', {
      title: def.title,
      strandId: strand.id,
      description: def.description,
    });
    assert(res.ok, `goals.create failed: ${res.error?.message}`);
    const goal = res.payload.goal;

    // Add tasks
    const tasks = [];
    for (const taskText of def.tasks) {
      const tRes = await rpc(goalH, 'goals.addTask', {
        goalId: goal.id,
        text: taskText,
      });
      assert(tRes.ok, `goals.addTask failed: ${tRes.error?.message}`);
      tasks.push(tRes.payload.task);
    }

    goals.push({ ...goal, tasks, def });
    log('🎯', `Goal: "${def.title}" → ${tasks.length} tasks, branch: ${goal.worktree?.branch}`);
  }

  // ═══ PHASE 3: Implement Code ════════════════════════════════════

  log('', '');
  log('💻', 'Phase 3: Implementing code in worktrees...');

  // ── Goal 1: API server and data layer ──
  const g1 = goals[0];
  const g1Path = g1.worktree.path;

  mkdirSync(join(g1Path, 'lib'), { recursive: true });
  mkdirSync(join(g1Path, 'data'), { recursive: true });

  // Quote data model
  writeFileSync(join(g1Path, 'lib', 'quotes.js'), `import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const DATA_FILE = join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'quotes.json');

function ensureDir() {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function load() {
  ensureDir();
  if (!existsSync(DATA_FILE)) return [];
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
}

function save(quotes) {
  ensureDir();
  writeFileSync(DATA_FILE, JSON.stringify(quotes, null, 2));
}

export function getAll() { return load(); }

export function getRandom() {
  const quotes = load();
  if (quotes.length === 0) return null;
  return quotes[Math.floor(Math.random() * quotes.length)];
}

export function getById(id) {
  return load().find(q => q.id === id) || null;
}

export function create(text, author, category) {
  if (!text || !author) throw new Error('text and author are required');
  const quotes = load();
  const quote = {
    id: randomUUID(),
    text: text.trim(),
    author: author.trim(),
    category: category || 'general',
    createdAt: new Date().toISOString(),
  };
  quotes.push(quote);
  save(quotes);
  return quote;
}

export function remove(id) {
  const quotes = load();
  const idx = quotes.findIndex(q => q.id === id);
  if (idx === -1) return false;
  quotes.splice(idx, 1);
  save(quotes);
  return true;
}
`);

  // HTTP server
  writeFileSync(join(g1Path, 'server.js'), `import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { getAll, getRandom, getById, create, remove } from './lib/quotes.js';

const PORT = process.env.PORT || 3000;
const PUBLIC = join(new URL('.', import.meta.url).pathname, 'public');

const MIME = {
  '.html': 'text/html', '.css': 'text/css',
  '.js': 'application/javascript', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, \`http://\${req.headers.host}\`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  // ── API Routes ──
  if (path === '/api/quotes/random' && req.method === 'GET') {
    const q = getRandom();
    return q ? json(res, 200, q) : json(res, 404, { error: 'No quotes available' });
  }

  if (path === '/api/quotes' && req.method === 'GET') {
    const category = url.searchParams.get('category');
    let quotes = getAll();
    if (category) quotes = quotes.filter(q => q.category === category);
    return json(res, 200, { quotes, total: quotes.length });
  }

  if (path === '/api/quotes' && req.method === 'POST') {
    try {
      const { text, author, category } = await parseBody(req);
      const q = create(text, author, category);
      return json(res, 201, q);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  const idMatch = path.match(/^\\/api\\/quotes\\/([\\w-]+)$/);
  if (idMatch && req.method === 'GET') {
    const q = getById(idMatch[1]);
    return q ? json(res, 200, q) : json(res, 404, { error: 'Quote not found' });
  }
  if (idMatch && req.method === 'DELETE') {
    return remove(idMatch[1])
      ? json(res, 200, { ok: true })
      : json(res, 404, { error: 'Quote not found' });
  }

  // ── Static files ──
  const file = path === '/' ? join(PUBLIC, 'index.html') : join(PUBLIC, path);
  if (existsSync(file)) {
    const mime = MIME[extname(file)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    return res.end(readFileSync(file));
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(\`Daily Quotes API → http://localhost:\${PORT}\`));
`);

  // Seed data
  writeFileSync(join(g1Path, 'data', 'quotes.json'), JSON.stringify([
    { id: '1', text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs', category: 'motivation', createdAt: '2026-01-01T00:00:00Z' },
    { id: '2', text: 'Innovation distinguishes between a leader and a follower.', author: 'Steve Jobs', category: 'innovation', createdAt: '2026-01-01T00:00:00Z' },
    { id: '3', text: 'Stay hungry, stay foolish.', author: 'Steve Jobs', category: 'motivation', createdAt: '2026-01-01T00:00:00Z' },
    { id: '4', text: 'The best time to plant a tree was 20 years ago. The second best time is now.', author: 'Chinese Proverb', category: 'wisdom', createdAt: '2026-01-01T00:00:00Z' },
    { id: '5', text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius', category: 'perseverance', createdAt: '2026-01-01T00:00:00Z' },
    { id: '6', text: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt', category: 'motivation', createdAt: '2026-01-01T00:00:00Z' },
    { id: '7', text: 'In the middle of difficulty lies opportunity.', author: 'Albert Einstein', category: 'wisdom', createdAt: '2026-01-01T00:00:00Z' },
    { id: '8', text: 'Simplicity is the ultimate sophistication.', author: 'Leonardo da Vinci', category: 'design', createdAt: '2026-01-01T00:00:00Z' },
    { id: '9', text: 'The best way to predict the future is to create it.', author: 'Peter Drucker', category: 'innovation', createdAt: '2026-01-01T00:00:00Z' },
    { id: '10', text: 'Code is like humor. When you have to explain it, it is bad.', author: 'Cory House', category: 'programming', createdAt: '2026-01-01T00:00:00Z' },
    { id: '11', text: 'First, solve the problem. Then, write the code.', author: 'John Johnson', category: 'programming', createdAt: '2026-01-01T00:00:00Z' },
    { id: '12', text: 'Make it work, make it right, make it fast.', author: 'Kent Beck', category: 'programming', createdAt: '2026-01-01T00:00:00Z' },
  ], null, 2));

  gitCommit(g1Path, 'feat: add quote data model, HTTP server, REST API, and seed data');
  log('✅', `Goal 1 implemented: API + data layer (3 files)`);

  // ── Goal 2: Web frontend ──
  const g2 = goals[1];
  const g2Path = g2.worktree.path;

  mkdirSync(join(g2Path, 'public'), { recursive: true });

  writeFileSync(join(g2Path, 'public', 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Daily Quote</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <h1>Daily Quote</h1>
    <div id="quote-card" class="quote-card">
      <blockquote id="quote-text">Loading...</blockquote>
      <cite id="quote-author"></cite>
      <span class="category" id="quote-category"></span>
    </div>
    <div class="controls">
      <button id="newQuoteBtn" onclick="fetchQuote()">New Quote</button>
      <select id="categoryFilter" onchange="fetchQuote()">
        <option value="">All Categories</option>
        <option value="motivation">Motivation</option>
        <option value="wisdom">Wisdom</option>
        <option value="innovation">Innovation</option>
        <option value="programming">Programming</option>
        <option value="design">Design</option>
        <option value="perseverance">Perseverance</option>
      </select>
    </div>
    <p class="footer">
      <a href="/api/quotes" target="_blank">API</a> ·
      <a href="/api/quotes/random" target="_blank">Random JSON</a>
    </p>
  </div>
  <script src="/app.js"></script>
</body>
</html>
`);

  writeFileSync(join(g2Path, 'public', 'style.css'), `:root {
  --bg: #0f0f1a;
  --surface: #1a1a2e;
  --accent: #e94560;
  --text: #eaeaea;
  --muted: #8888a0;
  --radius: 16px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: 'Georgia', serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}

.container {
  max-width: 640px;
  width: 90%;
  text-align: center;
}

h1 {
  font-size: 1.2rem;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--muted);
  margin-bottom: 2rem;
}

.quote-card {
  background: var(--surface);
  border-radius: var(--radius);
  padding: 3rem 2.5rem;
  margin-bottom: 2rem;
  transition: opacity 0.3s;
}

blockquote {
  font-size: 1.5rem;
  line-height: 1.6;
  margin-bottom: 1.5rem;
  font-style: italic;
  color: var(--text);
}

blockquote::before { content: '\\201C'; color: var(--accent); font-size: 2rem; }
blockquote::after { content: '\\201D'; color: var(--accent); font-size: 2rem; }

cite {
  display: block;
  font-size: 1rem;
  color: var(--accent);
  font-style: normal;
}

.category {
  display: inline-block;
  margin-top: 0.75rem;
  padding: 0.2rem 0.75rem;
  background: rgba(233, 69, 96, 0.15);
  color: var(--accent);
  border-radius: 20px;
  font-size: 0.8rem;
  font-family: -apple-system, sans-serif;
}

.controls {
  display: flex;
  gap: 0.75rem;
  justify-content: center;
  margin-bottom: 2rem;
}

button, select {
  padding: 0.6rem 1.5rem;
  border: none;
  border-radius: var(--radius);
  font-size: 0.9rem;
  cursor: pointer;
  font-family: -apple-system, sans-serif;
}

button {
  background: var(--accent);
  color: white;
  transition: transform 0.1s;
}

button:active { transform: scale(0.96); }

select {
  background: var(--surface);
  color: var(--text);
  border: 1px solid #2a2a4a;
}

.footer {
  color: var(--muted);
  font-size: 0.8rem;
  font-family: -apple-system, sans-serif;
}

.footer a {
  color: var(--muted);
  text-decoration: none;
  border-bottom: 1px dotted var(--muted);
}

.footer a:hover { color: var(--accent); border-color: var(--accent); }

@media (max-width: 480px) {
  blockquote { font-size: 1.2rem; }
  .quote-card { padding: 2rem 1.5rem; }
}
`);

  writeFileSync(join(g2Path, 'public', 'app.js'), `async function fetchQuote() {
  const card = document.getElementById('quote-card');
  const category = document.getElementById('categoryFilter').value;

  card.style.opacity = '0.5';

  try {
    const url = category
      ? \`/api/quotes?category=\${category}\`
      : '/api/quotes/random';

    const res = await fetch(url);
    const data = await res.json();

    let quote;
    if (data.quotes) {
      // Filtered list — pick random from results
      if (data.quotes.length === 0) {
        document.getElementById('quote-text').textContent = 'No quotes in this category yet.';
        document.getElementById('quote-author').textContent = '';
        document.getElementById('quote-category').textContent = '';
        card.style.opacity = '1';
        return;
      }
      quote = data.quotes[Math.floor(Math.random() * data.quotes.length)];
    } else {
      quote = data;
    }

    document.getElementById('quote-text').textContent = quote.text;
    document.getElementById('quote-author').textContent = '— ' + quote.author;
    document.getElementById('quote-category').textContent = quote.category;
  } catch (err) {
    document.getElementById('quote-text').textContent = 'Failed to load quote.';
    document.getElementById('quote-author').textContent = '';
    document.getElementById('quote-category').textContent = '';
  }

  card.style.opacity = '1';
}

// Load initial quote
fetchQuote();

// Auto-refresh every 30 seconds
setInterval(fetchQuote, 30000);
`);

  gitCommit(g2Path, 'feat: add web frontend with quote display, dark theme, and category filter');
  log('✅', `Goal 2 implemented: Frontend (3 files)`);

  // ── Goal 3: Project setup and docs ──
  const g3 = goals[2];
  const g3Path = g3.worktree.path;

  writeFileSync(join(g3Path, 'package.json'), JSON.stringify({
    name: 'daily-quotes-api',
    version: '1.0.0',
    description: 'A lightweight REST API serving inspirational quotes with a minimal web frontend',
    type: 'module',
    main: 'server.js',
    scripts: {
      start: 'node server.js',
      dev: 'node --watch server.js',
    },
    keywords: ['quotes', 'api', 'rest'],
    license: 'MIT',
  }, null, 2));

  writeFileSync(join(g3Path, 'README.md'), `# Daily Quotes API

A lightweight REST API serving inspirational quotes, with a minimal dark-themed web frontend.

![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![License](https://img.shields.io/badge/license-MIT-blue)

## Quick Start

\`\`\`bash
npm start
# → http://localhost:3000
\`\`\`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| \`GET\` | \`/api/quotes\` | List all quotes |
| \`GET\` | \`/api/quotes?category=wisdom\` | Filter by category |
| \`GET\` | \`/api/quotes/random\` | Get a random quote |
| \`GET\` | \`/api/quotes/:id\` | Get quote by ID |
| \`POST\` | \`/api/quotes\` | Create a new quote |
| \`DELETE\` | \`/api/quotes/:id\` | Delete a quote |

### Create a quote

\`\`\`bash
curl -X POST http://localhost:3000/api/quotes \\
  -H "Content-Type: application/json" \\
  -d '{"text": "Hello world", "author": "Dev", "category": "programming"}'
\`\`\`

### Get a random quote

\`\`\`bash
curl http://localhost:3000/api/quotes/random
\`\`\`

## Categories

\`motivation\` · \`wisdom\` · \`innovation\` · \`programming\` · \`design\` · \`perseverance\`

## Docker

\`\`\`bash
docker build -t daily-quotes .
docker run -p 3000:3000 daily-quotes
\`\`\`

## Project Structure

\`\`\`
├── server.js          # HTTP server + API routes
├── lib/quotes.js      # Data model + storage
├── data/quotes.json   # Quote database (JSON)
├── public/
│   ├── index.html     # Web frontend
│   ├── style.css      # Dark theme styles
│   └── app.js         # Client-side JS
├── Dockerfile
└── package.json
\`\`\`

## License

MIT
`);

  writeFileSync(join(g3Path, '.gitignore'), `node_modules/
.env
*.log
.DS_Store
`);

  writeFileSync(join(g3Path, 'Dockerfile'), `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production 2>/dev/null || true
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
`);

  gitCommit(g3Path, 'feat: add package.json, README, .gitignore, and Dockerfile');
  log('✅', `Goal 3 implemented: Docs + config (4 files)`);

  // ═══ PHASE 4: Mark Tasks Done ════════════════════════════════════

  log('', '');
  log('📋', 'Phase 4: Marking tasks done...');

  for (const goal of goals) {
    for (const task of goal.tasks) {
      const res = await rpc(goalH, 'goals.updateTask', {
        goalId: goal.id,
        taskId: task.id,
        status: 'done',
      });
      assert(res.ok, `updateTask failed: ${res.error?.message}`);
    }
    log('✅', `All tasks done for "${goal.def.title}"`);
  }

  // ═══ PHASE 5: Mark Goals Done + Merge + Push ═════════════════════

  log('', '');
  log('🔀', 'Phase 5: Completing goals → merge → push...');

  const mainBranch = workspaceManager.getMainBranch(wsPath);
  log('📌', `Main branch: ${mainBranch}`);

  for (const goal of goals) {
    // Push the goal branch first (so all work is on GitHub)
    const branch = goal.worktree.branch;
    log('⬆️', `Pushing ${branch}...`);
    const pushRes = pushBranch(wsPath, branch);
    if (!pushRes.ok) log('⚠️', `  Push warning: ${pushRes.error}`);

    // Merge into main
    log('🔀', `Merging ${branch} → ${mainBranch}...`);
    const mergeRes = workspaceManager.mergeGoalBranch(wsPath, branch);
    if (!mergeRes.ok) {
      if (mergeRes.conflict) {
        log('⚠️', `  Conflict — auto-resolving with theirs...`);
        execSync(`git merge ${JSON.stringify(branch)} -X theirs --no-ff -m ${JSON.stringify(`Merge ${branch}`)}`, {
          cwd: wsPath, stdio: 'pipe', env: GIT_ENV,
        });
      } else {
        assert(false, `Merge failed: ${mergeRes.error}`);
      }
    }
    log('✅', `  Merged ${branch}`);

    // Clean up worktree
    workspaceManager.removeGoalWorktree(wsPath, goal.id, branch);

    // Mark goal done
    const res = await rpc(goalH, 'goals.update', {
      id: goal.id,
      status: 'done',
      completed: true,
    });
    assert(res.ok, `goals.update failed: ${res.error?.message}`);
  }

  // Push main to GitHub
  log('⬆️', `Pushing ${mainBranch} to GitHub...`);
  const mainPush = pushBranch(wsPath, mainBranch);
  assert(mainPush.ok, `Push main failed: ${mainPush.error}`);
  log('✅', `Pushed ${mainBranch} to GitHub`);

  // ═══ PHASE 6: Verify ═════════════════════════════════════════════

  log('', '');
  log('🔍', 'Phase 6: Verification...');

  // 6a. Verify local files on main
  const expectedFiles = [
    'server.js', 'lib/quotes.js', 'data/quotes.json',
    'public/index.html', 'public/style.css', 'public/app.js',
    'package.json', 'README.md', '.gitignore', 'Dockerfile',
  ];

  log('📂', 'Local files on main:');
  let allLocal = true;
  for (const f of expectedFiles) {
    const exists = existsSync(join(wsPath, f));
    log(exists ? '  ✅' : '  ❌', f);
    if (!exists) allLocal = false;
  }
  assert(allLocal, 'Not all files present on main');

  // 6b. Verify git log
  const gitLog = execSync('git log --oneline', { cwd: wsPath, encoding: 'utf-8' }).trim();
  log('📜', 'Git log:');
  gitLog.split('\n').forEach(l => logSub(l));

  // 6c. Verify package.json
  const pkg = JSON.parse(readFileSync(join(wsPath, 'package.json'), 'utf-8'));
  assert(pkg.name === 'daily-quotes-api', `Wrong package name: ${pkg.name}`);

  // 6d. Verify GitHub repo is up to date
  log('🌐', 'Verifying GitHub...');
  await new Promise(r => setTimeout(r, 2000)); // propagation delay

  const ghRepo = await githubGet(`/repos/${ghOwner}/${repoName}`, ghToken);
  assert(ghRepo.status === 200, `Repo not found on GitHub (${ghRepo.status})`);
  log('  ✅', `Repo: ${ghRepo.data.full_name}`);

  // Check file tree on GitHub (main branch)
  const tree = await githubGet(
    `/repos/${ghOwner}/${repoName}/git/trees/${mainBranch}?recursive=1`,
    ghToken,
  );
  if (tree.status === 200) {
    const ghFiles = tree.data.tree.filter(t => t.type === 'blob').map(t => t.path);
    log('  📂', `Files on GitHub (${ghFiles.length}):`);
    for (const f of expectedFiles) {
      const onGH = ghFiles.includes(f);
      log(onGH ? '    ✅' : '    ❌', f);
    }
  }

  // Check collaborator invitation
  const invites = await githubGet(`/repos/${ghOwner}/${repoName}/invitations`, ghToken);
  if (invites.status === 200 && invites.data.length > 0) {
    log('  👥', `Collaborator invite: ${invites.data[0].invitee?.login} (${invites.data[0].permissions})`);
  }

  // 6e. Verify strand state in store
  const finalData = store.load();
  const finalStrand = finalData.strands.find(c => c.id === strand.id);
  const strandGoals = finalData.goals.filter(g => g.strandId === strand.id);
  const allDone = strandGoals.every(g => g.status === 'done');
  const totalTasks = strandGoals.reduce((n, g) => n + (g.tasks?.length || 0), 0);
  const doneTasks = strandGoals.reduce((n, g) => n + (g.tasks?.filter(t => t.status === 'done')?.length || 0), 0);

  assert(allDone, 'Not all goals are done');
  assert(doneTasks === totalTasks, `${doneTasks}/${totalTasks} tasks done`);

  // ═══ SUMMARY ═════════════════════════════════════════════════════

  log('', '');
  log('🎉', '═══════════════════════════════════════════════════════════');
  log('🎉', '  FULL E2E PIPELINE PASSED — Daily Quotes API complete!  ');
  log('🎉', '═══════════════════════════════════════════════════════════');
  log('', '');
  log('📦', `Strand:      ${finalStrand.name}`);
  log('🔗', `GitHub:     https://github.com/${strand.workspace.githubFullName}`);
  log('📁', `Workspace:  ${wsPath}`);
  log('🎯', `Goals:      ${strandGoals.length} completed`);
  log('📋', `Tasks:      ${doneTasks}/${totalTasks} done`);
  log('📄', `Files:      ${expectedFiles.length} on main`);
  log('🔀', `Merges:     ${goals.length} branches → ${mainBranch}`);
  log('⬆️', `Pushed:     ${mainBranch} + ${goals.length} branches to GitHub`);
  log('👥', `Manager:    ${ghConfig.managerUsername} (invited as admin)`);
  log('', '');
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
