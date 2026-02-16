#!/usr/bin/env node
/**
 * E2E Test: Recipe Box Project
 *
 * Creates a condo with git repo, creates goals with tasks and worktrees,
 * implements actual code in each worktree, commits, and merges everything
 * back to main. Verifies the final project is complete on main.
 */

import { createGoalsStore } from '../clawcondos/condo-management/lib/goals-store.js';
import {
  createCondoWorkspace,
  createGoalWorktree,
  mergeGoalBranch,
  getMainBranch,
  removeGoalWorktree,
} from '../clawcondos/condo-management/lib/workspace-manager.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';

const WORKSPACES_DIR = process.env.CLAWCONDOS_WORKSPACES_DIR || '/home/clawdia/clawcondos-workspaces';
const DATA_DIR = join(tmpdir(), `e2e-recipe-box-${Date.now()}`);

// Use a temporary store so we don't pollute production data
const store = createGoalsStore(DATA_DIR);

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Helix E2E',
  GIT_AUTHOR_EMAIL: 'e2e@clawcondos.test',
  GIT_COMMITTER_NAME: 'Helix E2E',
  GIT_COMMITTER_EMAIL: 'e2e@clawcondos.test',
};

function gitCommit(cwd, message) {
  execSync('git add -A', { cwd, stdio: 'pipe' });
  execSync(`git commit -m ${JSON.stringify(message)}`, {
    cwd,
    stdio: 'pipe',
    env: GIT_ENV,
  });
}

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
}

// ─── Step 1: Create Condo with Git Workspace ───

log('📦', 'Creating "Recipe Box" condo with git workspace...');

const condoId = store.newId('condo');
const condoName = 'Recipe Box';
const now = Date.now();

const wsResult = createCondoWorkspace(WORKSPACES_DIR, condoId, condoName);
assert(wsResult.ok, `Workspace creation failed: ${wsResult.error}`);
log('✅', `Workspace created at: ${wsResult.path}`);

const condoWs = wsResult.path;

// Register condo in the temp store
const data = store.load();
data.condos.push({
  id: condoId,
  name: condoName,
  description: 'A simple recipe management web app',
  color: '#e67e22',
  keywords: ['recipe', 'cooking', 'web-app'],
  workspace: { path: condoWs, repoUrl: null, createdAtMs: now },
  createdAtMs: now,
  updatedAtMs: now,
});
store.save(data);

// ─── Step 2: Create Goals with Worktrees ───

const goals = [
  {
    title: 'Core data model and API',
    description: 'Create the recipe data model (JSON storage) and REST API endpoints for CRUD operations',
    tasks: [
      { text: 'Create recipe data model (schema + validation)' },
      { text: 'Implement CRUD API endpoints (GET/POST/PUT/DELETE)' },
      { text: 'Add seed data with sample recipes' },
    ],
  },
  {
    title: 'Frontend UI components',
    description: 'Build the HTML/CSS/JS frontend with recipe list, detail view, and add/edit forms',
    tasks: [
      { text: 'Create main HTML page with recipe list layout' },
      { text: 'Add CSS styling with responsive grid' },
      { text: 'Implement JavaScript for dynamic recipe rendering' },
    ],
  },
  {
    title: 'Search and polish',
    description: 'Add recipe search/filter, error handling, and final integration testing',
    tasks: [
      { text: 'Add search bar with real-time filtering' },
      { text: 'Add error handling and loading states' },
      { text: 'Final integration test and README' },
    ],
  },
];

const goalRecords = [];

for (const goalDef of goals) {
  const goalId = store.newId('goal');
  log('🎯', `Creating goal: "${goalDef.title}" (${goalId})`);

  const wtResult = createGoalWorktree(condoWs, goalId, goalDef.title);
  assert(wtResult.ok, `Worktree creation failed for ${goalId}: ${wtResult.error}`);
  log('🌿', `  Worktree: ${wtResult.path} (branch: ${wtResult.branch})`);

  const taskRecords = goalDef.tasks.map((t, i) => ({
    id: store.newId('task'),
    text: t.text,
    status: 'pending',
    order: i,
    createdAtMs: now,
    updatedAtMs: now,
  }));

  const goalRecord = {
    id: goalId,
    title: goalDef.title,
    description: goalDef.description,
    status: 'active',
    completed: false,
    condoId,
    worktree: { path: wtResult.path, branch: wtResult.branch, createdAtMs: now },
    tasks: taskRecords,
    sessions: [],
    files: [],
    createdAtMs: now,
    updatedAtMs: now,
  };

  goalRecords.push(goalRecord);

  const d = store.load();
  d.goals.push(goalRecord);
  store.save(d);
}

log('✅', `Created ${goalRecords.length} goals with ${goalRecords.reduce((n, g) => n + g.tasks.length, 0)} total tasks`);

// ─── Step 3: Implement Code in Each Worktree ───

// === Goal 1: Core data model and API ===
log('💻', 'Implementing Goal 1: Core data model and API...');
const goal1Path = goalRecords[0].worktree.path;

// package.json
writeFileSync(join(goal1Path, 'package.json'), JSON.stringify({
  name: 'recipe-box',
  version: '1.0.0',
  description: 'A simple recipe management web app',
  main: 'server.js',
  type: 'module',
  scripts: {
    start: 'node server.js',
    dev: 'node server.js --dev',
  },
  dependencies: {},
}, null, 2));

// Recipe data model + storage
mkdirSync(join(goal1Path, 'lib'), { recursive: true });

writeFileSync(join(goal1Path, 'lib', 'recipes.js'), `/**
 * Recipe data model and storage
 * Simple JSON file-backed storage with validation
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';

const DATA_FILE = join(dirname(new URL(import.meta.url).pathname), '..', 'data', 'recipes.json');

function ensureDataDir() {
  const dir = dirname(DATA_FILE);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function loadRecipes() {
  ensureDataDir();
  if (!existsSync(DATA_FILE)) return [];
  return JSON.parse(readFileSync(DATA_FILE, 'utf-8'));
}

function saveRecipes(recipes) {
  ensureDataDir();
  writeFileSync(DATA_FILE, JSON.stringify(recipes, null, 2));
}

/** Validate a recipe object. Returns { valid, errors } */
export function validateRecipe(recipe) {
  const errors = [];
  if (!recipe.title || typeof recipe.title !== 'string' || !recipe.title.trim()) {
    errors.push('title is required');
  }
  if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) {
    errors.push('at least one ingredient is required');
  }
  if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
    errors.push('at least one step is required');
  }
  return { valid: errors.length === 0, errors };
}

export function getAllRecipes() {
  return loadRecipes();
}

export function getRecipeById(id) {
  return loadRecipes().find(r => r.id === id) || null;
}

export function createRecipe(data) {
  const { valid, errors } = validateRecipe(data);
  if (!valid) throw new Error(errors.join(', '));

  const recipes = loadRecipes();
  const recipe = {
    id: randomUUID(),
    title: data.title.trim(),
    description: data.description || '',
    ingredients: data.ingredients,
    steps: data.steps,
    tags: data.tags || [],
    prepTime: data.prepTime || null,
    cookTime: data.cookTime || null,
    servings: data.servings || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  recipes.push(recipe);
  saveRecipes(recipes);
  return recipe;
}

export function updateRecipe(id, data) {
  const recipes = loadRecipes();
  const idx = recipes.findIndex(r => r.id === id);
  if (idx === -1) return null;

  const merged = { ...recipes[idx], ...data, id, updatedAt: new Date().toISOString() };
  const { valid, errors } = validateRecipe(merged);
  if (!valid) throw new Error(errors.join(', '));

  recipes[idx] = merged;
  saveRecipes(recipes);
  return merged;
}

export function deleteRecipe(id) {
  const recipes = loadRecipes();
  const idx = recipes.findIndex(r => r.id === id);
  if (idx === -1) return false;
  recipes.splice(idx, 1);
  saveRecipes(recipes);
  return true;
}
`);

// Server with API endpoints
writeFileSync(join(goal1Path, 'server.js'), `import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { join, extname } from 'path';
import { getAllRecipes, getRecipeById, createRecipe, updateRecipe, deleteRecipe } from './lib/recipes.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(new URL('.', import.meta.url).pathname, 'public');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function sendJSON(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStatic(res, filePath) {
  if (!existsSync(filePath)) {
    sendJSON(res, 404, { error: 'Not found' });
    return;
  }
  const ext = extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  res.end(readFileSync(filePath));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, \`http://\${req.headers.host}\`);
  const path = url.pathname;

  // API routes
  if (path.startsWith('/api/recipes')) {
    try {
      const id = path.split('/')[3]; // /api/recipes/:id

      if (req.method === 'GET' && !id) {
        const q = url.searchParams.get('q');
        let recipes = getAllRecipes();
        if (q) {
          const lower = q.toLowerCase();
          recipes = recipes.filter(r =>
            r.title.toLowerCase().includes(lower) ||
            r.description.toLowerCase().includes(lower) ||
            r.tags.some(t => t.toLowerCase().includes(lower))
          );
        }
        return sendJSON(res, 200, recipes);
      }

      if (req.method === 'GET' && id) {
        const recipe = getRecipeById(id);
        if (!recipe) return sendJSON(res, 404, { error: 'Recipe not found' });
        return sendJSON(res, 200, recipe);
      }

      if (req.method === 'POST' && !id) {
        const body = await parseBody(req);
        const recipe = createRecipe(body);
        return sendJSON(res, 201, recipe);
      }

      if (req.method === 'PUT' && id) {
        const body = await parseBody(req);
        const recipe = updateRecipe(id, body);
        if (!recipe) return sendJSON(res, 404, { error: 'Recipe not found' });
        return sendJSON(res, 200, recipe);
      }

      if (req.method === 'DELETE' && id) {
        const ok = deleteRecipe(id);
        if (!ok) return sendJSON(res, 404, { error: 'Recipe not found' });
        return sendJSON(res, 204, null);
      }
    } catch (err) {
      return sendJSON(res, 400, { error: err.message });
    }
  }

  // Static files
  const filePath = path === '/' ? join(PUBLIC_DIR, 'index.html') : join(PUBLIC_DIR, path);
  serveStatic(res, filePath);
});

server.listen(PORT, () => {
  console.log(\`Recipe Box running at http://localhost:\${PORT}\`);
});
`);

// Seed data
mkdirSync(join(goal1Path, 'data'), { recursive: true });
writeFileSync(join(goal1Path, 'data', 'recipes.json'), JSON.stringify([
  {
    id: '1',
    title: 'Classic Margherita Pizza',
    description: 'Simple and delicious Italian pizza with fresh tomatoes, mozzarella, and basil.',
    ingredients: ['Pizza dough', 'San Marzano tomatoes', 'Fresh mozzarella', 'Fresh basil', 'Olive oil', 'Salt'],
    steps: [
      'Preheat oven to 475°F (245°C) with pizza stone.',
      'Stretch dough into a 12-inch round on floured surface.',
      'Spread crushed tomatoes evenly, leaving 1-inch border.',
      'Tear mozzarella and distribute over sauce.',
      'Bake 10-12 minutes until crust is golden.',
      'Top with fresh basil leaves and drizzle of olive oil.',
    ],
    tags: ['italian', 'pizza', 'vegetarian'],
    prepTime: '20 min',
    cookTime: '12 min',
    servings: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '2',
    title: 'Thai Green Curry',
    description: 'Aromatic coconut-based curry with vegetables and your choice of protein.',
    ingredients: ['Coconut milk', 'Green curry paste', 'Chicken or tofu', 'Bamboo shoots', 'Thai basil', 'Fish sauce', 'Palm sugar', 'Bell peppers', 'Thai eggplant'],
    steps: [
      'Heat 1/4 can coconut milk in wok until oil separates.',
      'Fry curry paste 2 minutes until fragrant.',
      'Add protein, cook until browned.',
      'Pour remaining coconut milk, bring to simmer.',
      'Add vegetables, cook 5-7 minutes.',
      'Season with fish sauce and palm sugar to taste.',
      'Garnish with Thai basil. Serve over jasmine rice.',
    ],
    tags: ['thai', 'curry', 'spicy'],
    prepTime: '15 min',
    cookTime: '25 min',
    servings: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '3',
    title: 'Chocolate Lava Cake',
    description: 'Rich chocolate cake with a molten center. Perfect dinner party dessert.',
    ingredients: ['Dark chocolate (70%)', 'Butter', 'Eggs', 'Sugar', 'Flour', 'Cocoa powder', 'Vanilla extract'],
    steps: [
      'Preheat oven to 425°F (220°C). Butter and cocoa-dust 4 ramekins.',
      'Melt chocolate and butter together, stir smooth.',
      'Whisk eggs and sugar until thick and pale.',
      'Fold chocolate mixture into eggs, then fold in flour.',
      'Divide batter among ramekins.',
      'Bake exactly 12 minutes — edges set, center jiggly.',
      'Invert onto plates immediately. Serve with vanilla ice cream.',
    ],
    tags: ['dessert', 'chocolate', 'french'],
    prepTime: '15 min',
    cookTime: '12 min',
    servings: 4,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
], null, 2));

gitCommit(goal1Path, 'feat: add recipe data model, CRUD API, server, and seed data');
log('✅', '  Goal 1: Committed data model, API, server, seed data');

// Update task statuses
{
  const d = store.load();
  const g = d.goals.find(g => g.id === goalRecords[0].id);
  g.tasks.forEach(t => { t.status = 'done'; t.updatedAtMs = Date.now(); });
  g.files = [
    { path: 'package.json', taskId: g.tasks[0].id, addedAtMs: Date.now(), source: 'agent' },
    { path: 'lib/recipes.js', taskId: g.tasks[0].id, addedAtMs: Date.now(), source: 'agent' },
    { path: 'server.js', taskId: g.tasks[1].id, addedAtMs: Date.now(), source: 'agent' },
    { path: 'data/recipes.json', taskId: g.tasks[2].id, addedAtMs: Date.now(), source: 'agent' },
  ];
  store.save(d);
}

// === Goal 2: Frontend UI components ===
log('💻', 'Implementing Goal 2: Frontend UI components...');
const goal2Path = goalRecords[1].worktree.path;

mkdirSync(join(goal2Path, 'public'), { recursive: true });

// HTML
writeFileSync(join(goal2Path, 'public', 'index.html'), `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Recipe Box</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <header>
    <div class="header-content">
      <h1>Recipe Box</h1>
      <p class="subtitle">Your personal recipe collection</p>
    </div>
    <button class="btn-add" id="addRecipeBtn" onclick="openAddForm()">+ Add Recipe</button>
  </header>

  <main>
    <div class="search-bar">
      <input type="text" id="searchInput" placeholder="Search recipes by name, description, or tag..."
             oninput="handleSearch(this.value)">
    </div>

    <div id="recipeGrid" class="recipe-grid">
      <div class="loading" id="loadingState">Loading recipes...</div>
    </div>
  </main>

  <!-- Recipe Detail Modal -->
  <div class="modal-overlay" id="recipeModal" onclick="if(event.target===this)closeModal()">
    <div class="modal" id="recipeDetail"></div>
  </div>

  <!-- Add/Edit Form Modal -->
  <div class="modal-overlay" id="formModal" onclick="if(event.target===this)closeForm()">
    <div class="modal form-modal">
      <h2 id="formTitle">Add Recipe</h2>
      <form id="recipeForm" onsubmit="handleSubmit(event)">
        <input type="hidden" id="editId">
        <label>Title *<input type="text" id="fTitle" required></label>
        <label>Description<textarea id="fDesc" rows="2"></textarea></label>
        <label>Ingredients * (one per line)<textarea id="fIngredients" rows="4" required></textarea></label>
        <label>Steps * (one per line)<textarea id="fSteps" rows="4" required></textarea></label>
        <label>Tags (comma-separated)<input type="text" id="fTags"></label>
        <div class="form-row">
          <label>Prep Time<input type="text" id="fPrepTime" placeholder="e.g. 15 min"></label>
          <label>Cook Time<input type="text" id="fCookTime" placeholder="e.g. 30 min"></label>
          <label>Servings<input type="number" id="fServings" min="1"></label>
        </div>
        <div class="form-actions">
          <button type="button" class="btn-cancel" onclick="closeForm()">Cancel</button>
          <button type="submit" class="btn-save">Save Recipe</button>
        </div>
      </form>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>
`);

// CSS
writeFileSync(join(goal2Path, 'public', 'styles.css'), `* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --bg: #1a1a2e;
  --surface: #16213e;
  --card: #0f3460;
  --accent: #e94560;
  --accent-hover: #d63851;
  --text: #eee;
  --text-muted: #a0a0b8;
  --border: #2a2a4a;
  --success: #27ae60;
  --tag-bg: rgba(233, 69, 96, 0.15);
  --tag-text: #e94560;
  --radius: 12px;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 2rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.subtitle {
  color: var(--text-muted);
  font-size: 0.9rem;
  margin-top: 0.25rem;
}

.btn-add {
  background: var(--accent);
  color: white;
  border: none;
  padding: 0.6rem 1.2rem;
  border-radius: var(--radius);
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s, transform 0.1s;
}

.btn-add:hover { background: var(--accent-hover); }
.btn-add:active { transform: scale(0.97); }

main {
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem 2rem;
}

.search-bar {
  margin-bottom: 1.5rem;
}

.search-bar input {
  width: 100%;
  padding: 0.75rem 1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 1rem;
  outline: none;
  transition: border-color 0.2s;
}

.search-bar input:focus {
  border-color: var(--accent);
}

.recipe-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 1.25rem;
}

.recipe-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 1.25rem;
  cursor: pointer;
  transition: transform 0.2s, border-color 0.2s;
}

.recipe-card:hover {
  transform: translateY(-2px);
  border-color: var(--accent);
}

.recipe-card h3 {
  margin-bottom: 0.5rem;
  font-size: 1.1rem;
}

.recipe-card .description {
  color: var(--text-muted);
  font-size: 0.85rem;
  margin-bottom: 0.75rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.recipe-card .meta {
  display: flex;
  gap: 1rem;
  color: var(--text-muted);
  font-size: 0.8rem;
  margin-bottom: 0.75rem;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}

.tag {
  background: var(--tag-bg);
  color: var(--tag-text);
  padding: 0.2rem 0.6rem;
  border-radius: 20px;
  font-size: 0.75rem;
}

.loading, .empty-state, .error-state {
  text-align: center;
  padding: 3rem;
  color: var(--text-muted);
  grid-column: 1 / -1;
}

.error-state { color: var(--accent); }

/* Modal */
.modal-overlay {
  display: none;
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 1000;
  align-items: center;
  justify-content: center;
}

.modal-overlay.active {
  display: flex;
}

.modal {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  max-width: 700px;
  width: 90%;
  max-height: 85vh;
  overflow-y: auto;
  padding: 2rem;
}

.modal h2 {
  margin-bottom: 0.5rem;
}

.modal .description {
  color: var(--text-muted);
  margin-bottom: 1.5rem;
}

.modal h3 {
  margin: 1.25rem 0 0.5rem;
  font-size: 0.95rem;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.modal ol, .modal ul {
  padding-left: 1.5rem;
}

.modal li {
  margin-bottom: 0.4rem;
  line-height: 1.5;
}

.modal .modal-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  justify-content: flex-end;
}

.btn-edit, .btn-delete, .btn-close {
  padding: 0.5rem 1rem;
  border-radius: var(--radius);
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
}

.btn-edit { background: var(--card); color: var(--text); }
.btn-delete { background: var(--accent); color: white; }
.btn-close { background: var(--border); color: var(--text); }

/* Form */
.form-modal { max-width: 600px; }

.form-modal label {
  display: block;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
  color: var(--text-muted);
}

.form-modal input, .form-modal textarea {
  display: block;
  width: 100%;
  margin-top: 0.25rem;
  padding: 0.6rem 0.75rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  font-size: 0.9rem;
  outline: none;
}

.form-modal input:focus, .form-modal textarea:focus {
  border-color: var(--accent);
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 0.75rem;
}

.form-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.5rem;
  justify-content: flex-end;
}

.btn-cancel { background: var(--border); color: var(--text); border: none; padding: 0.5rem 1rem; border-radius: var(--radius); cursor: pointer; }
.btn-save { background: var(--success); color: white; border: none; padding: 0.5rem 1rem; border-radius: var(--radius); cursor: pointer; }

@media (max-width: 600px) {
  header { flex-direction: column; gap: 1rem; text-align: center; }
  main { padding: 1rem; }
  .form-row { grid-template-columns: 1fr; }
}
`);

// JavaScript app
writeFileSync(join(goal2Path, 'public', 'app.js'), `let recipes = [];
let searchTimeout = null;

async function loadRecipes(query) {
  const grid = document.getElementById('recipeGrid');
  grid.innerHTML = '<div class="loading">Loading recipes...</div>';

  try {
    const url = query ? \`/api/recipes?q=\${encodeURIComponent(query)}\` : '/api/recipes';
    const res = await fetch(url);
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    recipes = await res.json();
    renderRecipes();
  } catch (err) {
    grid.innerHTML = \`<div class="error-state">Failed to load recipes: \${err.message}</div>\`;
  }
}

function renderRecipes() {
  const grid = document.getElementById('recipeGrid');
  if (recipes.length === 0) {
    grid.innerHTML = '<div class="empty-state">No recipes found. Add your first recipe!</div>';
    return;
  }
  grid.innerHTML = recipes.map(r => \`
    <div class="recipe-card" onclick="showRecipe('\${r.id}')">
      <h3>\${esc(r.title)}</h3>
      <p class="description">\${esc(r.description)}</p>
      <div class="meta">
        \${r.prepTime ? \`<span>Prep: \${esc(r.prepTime)}</span>\` : ''}
        \${r.cookTime ? \`<span>Cook: \${esc(r.cookTime)}</span>\` : ''}
        \${r.servings ? \`<span>Serves \${r.servings}</span>\` : ''}
      </div>
      <div class="tags">
        \${(r.tags || []).map(t => \`<span class="tag">\${esc(t)}</span>\`).join('')}
      </div>
    </div>
  \`).join('');
}

function showRecipe(id) {
  const r = recipes.find(r => r.id === id);
  if (!r) return;
  const detail = document.getElementById('recipeDetail');
  detail.innerHTML = \`
    <h2>\${esc(r.title)}</h2>
    <p class="description">\${esc(r.description)}</p>
    <div class="meta" style="margin-bottom:1rem">
      \${r.prepTime ? \`<span>Prep: \${esc(r.prepTime)}</span>\` : ''}
      \${r.cookTime ? \`<span>Cook: \${esc(r.cookTime)}</span>\` : ''}
      \${r.servings ? \`<span>Serves \${r.servings}</span>\` : ''}
    </div>
    <div class="tags" style="margin-bottom:1.5rem">
      \${(r.tags||[]).map(t => \`<span class="tag">\${esc(t)}</span>\`).join('')}
    </div>
    <h3>Ingredients</h3>
    <ul>\${r.ingredients.map(i => \`<li>\${esc(i)}</li>\`).join('')}</ul>
    <h3>Steps</h3>
    <ol>\${r.steps.map(s => \`<li>\${esc(s)}</li>\`).join('')}</ol>
    <div class="modal-actions">
      <button class="btn-edit" onclick="openEditForm('\${r.id}')">Edit</button>
      <button class="btn-delete" onclick="handleDelete('\${r.id}')">Delete</button>
      <button class="btn-close" onclick="closeModal()">Close</button>
    </div>
  \`;
  document.getElementById('recipeModal').classList.add('active');
}

function closeModal() {
  document.getElementById('recipeModal').classList.remove('active');
}

function openAddForm() {
  document.getElementById('formTitle').textContent = 'Add Recipe';
  document.getElementById('recipeForm').reset();
  document.getElementById('editId').value = '';
  document.getElementById('formModal').classList.add('active');
}

function openEditForm(id) {
  closeModal();
  const r = recipes.find(r => r.id === id);
  if (!r) return;
  document.getElementById('formTitle').textContent = 'Edit Recipe';
  document.getElementById('editId').value = r.id;
  document.getElementById('fTitle').value = r.title;
  document.getElementById('fDesc').value = r.description;
  document.getElementById('fIngredients').value = r.ingredients.join('\\n');
  document.getElementById('fSteps').value = r.steps.join('\\n');
  document.getElementById('fTags').value = (r.tags || []).join(', ');
  document.getElementById('fPrepTime').value = r.prepTime || '';
  document.getElementById('fCookTime').value = r.cookTime || '';
  document.getElementById('fServings').value = r.servings || '';
  document.getElementById('formModal').classList.add('active');
}

function closeForm() {
  document.getElementById('formModal').classList.remove('active');
}

async function handleSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('editId').value;
  const data = {
    title: document.getElementById('fTitle').value,
    description: document.getElementById('fDesc').value,
    ingredients: document.getElementById('fIngredients').value.split('\\n').filter(s => s.trim()),
    steps: document.getElementById('fSteps').value.split('\\n').filter(s => s.trim()),
    tags: document.getElementById('fTags').value.split(',').map(s => s.trim()).filter(Boolean),
    prepTime: document.getElementById('fPrepTime').value || null,
    cookTime: document.getElementById('fCookTime').value || null,
    servings: parseInt(document.getElementById('fServings').value) || null,
  };

  try {
    const url = id ? \`/api/recipes/\${id}\` : '/api/recipes';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to save');
    }
    closeForm();
    loadRecipes();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function handleDelete(id) {
  if (!confirm('Delete this recipe?')) return;
  try {
    const res = await fetch(\`/api/recipes/\${id}\`, { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error('Delete failed');
    closeModal();
    loadRecipes();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

function handleSearch(value) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadRecipes(value), 300);
}

function esc(str) {
  const d = document.createElement('div');
  d.textContent = str || '';
  return d.innerHTML;
}

// Initial load
loadRecipes();
`);

gitCommit(goal2Path, 'feat: add frontend HTML page, CSS styling, and JavaScript app');
log('✅', '  Goal 2: Committed HTML, CSS, JavaScript frontend');

// Update task statuses
{
  const d = store.load();
  const g = d.goals.find(g => g.id === goalRecords[1].id);
  g.tasks.forEach(t => { t.status = 'done'; t.updatedAtMs = Date.now(); });
  g.files = [
    { path: 'public/index.html', taskId: g.tasks[0].id, addedAtMs: Date.now(), source: 'agent' },
    { path: 'public/styles.css', taskId: g.tasks[1].id, addedAtMs: Date.now(), source: 'agent' },
    { path: 'public/app.js', taskId: g.tasks[2].id, addedAtMs: Date.now(), source: 'agent' },
  ];
  store.save(d);
}

// === Goal 3: Search and polish ===
log('💻', 'Implementing Goal 3: Search and polish...');
const goal3Path = goalRecords[2].worktree.path;

// README.md
writeFileSync(join(goal3Path, 'README.md'), `# Recipe Box

A simple, self-hosted recipe management web app. Dark-themed UI with search, CRUD operations, and responsive design.

## Features

- Browse recipes in a responsive card grid
- Full-text search across titles, descriptions, and tags
- Add, edit, and delete recipes
- Detailed recipe view with ingredients and step-by-step instructions
- Dark theme with clean, modern UI
- No external dependencies — pure Node.js + vanilla JS
- JSON file storage (no database needed)

## Quick Start

\`\`\`bash
npm start
# Open http://localhost:3000
\`\`\`

Comes with 3 sample recipes pre-loaded.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/api/recipes\` | List all recipes |
| GET | \`/api/recipes?q=search\` | Search recipes |
| GET | \`/api/recipes/:id\` | Get single recipe |
| POST | \`/api/recipes\` | Create recipe |
| PUT | \`/api/recipes/:id\` | Update recipe |
| DELETE | \`/api/recipes/:id\` | Delete recipe |

## Recipe Schema

\`\`\`json
{
  "title": "Recipe Name",
  "description": "Short description",
  "ingredients": ["item 1", "item 2"],
  "steps": ["step 1", "step 2"],
  "tags": ["tag1", "tag2"],
  "prepTime": "15 min",
  "cookTime": "30 min",
  "servings": 4
}
\`\`\`

## License

MIT
`);

// .gitignore
writeFileSync(join(goal3Path, '.gitignore'), `node_modules/
.env
*.log
`);

gitCommit(goal3Path, 'feat: add README, .gitignore, and final polish');
log('✅', '  Goal 3: Committed README and polish');

// Update task statuses
{
  const d = store.load();
  const g = d.goals.find(g => g.id === goalRecords[2].id);
  g.tasks.forEach(t => { t.status = 'done'; t.updatedAtMs = Date.now(); });
  g.files = [
    { path: 'README.md', taskId: g.tasks[2].id, addedAtMs: Date.now(), source: 'agent' },
    { path: '.gitignore', taskId: g.tasks[1].id, addedAtMs: Date.now(), source: 'agent' },
  ];
  store.save(d);
}

// ─── Step 4: Merge All Goal Branches into Main ───

log('🔀', 'Merging goal branches into main...');

const mainBranch = getMainBranch(condoWs);
log('📌', `Main branch: ${mainBranch}`);

for (const goal of goalRecords) {
  const branch = goal.worktree.branch;
  log('🔀', `  Merging ${branch}...`);

  const mergeResult = mergeGoalBranch(condoWs, branch);
  if (!mergeResult.ok) {
    if (mergeResult.conflict) {
      log('⚠️', `  CONFLICT merging ${branch}: ${mergeResult.error}`);
      log('🔧', `  Attempting merge with strategy-option theirs...`);
      // Force merge with theirs strategy for conflicts
      try {
        execSync(`git merge ${JSON.stringify(branch)} -X theirs --no-ff -m ${JSON.stringify(`Merge ${branch} into ${mainBranch} (auto-resolved)`)}`, {
          cwd: condoWs,
          stdio: 'pipe',
          env: GIT_ENV,
        });
        log('✅', `  Merged ${branch} (auto-resolved conflicts)`);
      } catch (err2) {
        console.error(`  FATAL: Could not merge ${branch}: ${err2.message}`);
        process.exit(1);
      }
    } else {
      console.error(`  FATAL: Merge failed for ${branch}: ${mergeResult.error}`);
      process.exit(1);
    }
  } else {
    log('✅', `  Merged ${branch}`);
  }

  // Clean up worktree after merge
  removeGoalWorktree(condoWs, goal.id, branch);
}

// ─── Step 5: Mark Goals as Complete ───

{
  const d = store.load();
  for (const gr of goalRecords) {
    const g = d.goals.find(g => g.id === gr.id);
    if (g) {
      g.status = 'done';
      g.completed = true;
      g.updatedAtMs = Date.now();
    }
  }
  store.save(d);
}

// ─── Step 6: Verify Final Project on Main ───

log('🔍', 'Verifying final project on main branch...');

const filesToCheck = [
  'package.json',
  'server.js',
  'lib/recipes.js',
  'data/recipes.json',
  'public/index.html',
  'public/styles.css',
  'public/app.js',
  'README.md',
  '.gitignore',
];

let allPresent = true;
for (const f of filesToCheck) {
  const fullPath = join(condoWs, f);
  if (existsSync(fullPath)) {
    log('✅', `  ${f}`);
  } else {
    log('❌', `  MISSING: ${f}`);
    allPresent = false;
  }
}

// Verify git log shows merges
const gitLog = execSync('git log --oneline -10', { cwd: condoWs, encoding: 'utf-8' });
log('📜', 'Git log (last 10):');
console.log(gitLog);

// Verify we're on main
const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: condoWs, encoding: 'utf-8' }).trim();
assert(currentBranch === mainBranch, `Expected to be on ${mainBranch} but on ${currentBranch}`);

// Verify all files exist
assert(allPresent, 'Not all files are present on main!');

// Verify package.json is correct
const pkg = JSON.parse(readFileSync(join(condoWs, 'package.json'), 'utf-8'));
assert(pkg.name === 'recipe-box', `Expected package name 'recipe-box', got '${pkg.name}'`);

// Verify seed data
const seedData = JSON.parse(readFileSync(join(condoWs, 'data', 'recipes.json'), 'utf-8'));
assert(seedData.length === 3, `Expected 3 seed recipes, got ${seedData.length}`);

// ─── Summary ───

log('', '');
log('🎉', '═══════════════════════════════════════════════════════');
log('🎉', '  E2E TEST PASSED — Recipe Box project complete!');
log('🎉', '═══════════════════════════════════════════════════════');
log('', '');
log('📦', `Condo: ${condoName} (${condoId})`);
log('📁', `Workspace: ${condoWs}`);
log('🌿', `Branch: ${mainBranch}`);
log('🎯', `Goals completed: ${goalRecords.length}`);
log('📋', `Tasks completed: ${goalRecords.reduce((n, g) => n + g.tasks.length, 0)}`);
log('📄', `Files on main: ${filesToCheck.length}`);
log('🔀', `Merge commits: ${goalRecords.length}`);
log('', '');
log('📌', `Test store (temp): ${DATA_DIR}`);
log('', '');
