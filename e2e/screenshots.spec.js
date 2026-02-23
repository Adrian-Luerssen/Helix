import { test } from '@playwright/test';
import { join } from 'path';

const SCREENSHOT_DIR = join(import.meta.dirname, '..', 'public', 'media', 'screenshots');

// Shared mock data for populating views
const NOW = Date.now();
const HOUR = 3600000;
const DAY = 86400000;

const MOCK_STRANDS = [
  {
    id: 'strand_helix01',
    name: 'Helix Dashboard',
    description: 'Main Helix multi-agent orchestration platform',
    color: '#818CF8',
    createdAtMs: NOW - 14 * DAY,
    updatedAtMs: NOW - 2 * HOUR,
    workspace: { path: '/home/dev/helix-workspaces/helix-dashboard-a1b2c3d4', repoUrl: 'https://github.com/Adrian-Luerssen/Helix', createdAtMs: NOW - 14 * DAY },
  },
  {
    id: 'strand_recipe02',
    name: 'Recipe Box',
    description: 'Full-stack recipe management application',
    color: '#22D3EE',
    createdAtMs: NOW - 7 * DAY,
    updatedAtMs: NOW - 4 * HOUR,
    workspace: { path: '/home/dev/helix-workspaces/recipe-box-9d5777ce', createdAtMs: NOW - 7 * DAY },
  },
  {
    id: 'strand_devops03',
    name: 'DevOps Pipeline',
    description: 'CI/CD and infrastructure automation',
    color: '#F59E0B',
    createdAtMs: NOW - 3 * DAY,
    updatedAtMs: NOW - 1 * HOUR,
    workspace: { path: '/home/dev/helix-workspaces/devops-pipeline-e5f6a7b8', createdAtMs: NOW - 3 * DAY },
  },
];

const MOCK_GOALS = [
  // Helix Dashboard goals
  {
    id: 'goal_redesign',
    strandId: 'strand_helix01',
    title: 'Redesign CSS color system',
    status: 'done',
    phase: 1,
    priority: 'high',
    notes: 'Replace Apple blue (#0A84FF) with Helix indigo/cyan palette across all CSS files',
    createdAtMs: NOW - 12 * DAY,
    updatedAtMs: NOW - 2 * DAY,
    sessions: ['agent:main:main'],
    tasks: [
      { id: 'task_vars', text: 'Update :root CSS variables', status: 'done', done: true, createdAtMs: NOW - 12 * DAY, updatedAtMs: NOW - 3 * DAY },
      { id: 'task_hardcoded', text: 'Replace hardcoded colors in main.css', status: 'done', done: true, createdAtMs: NOW - 11 * DAY, updatedAtMs: NOW - 3 * DAY },
      { id: 'task_agents_css', text: 'Update agents.css color references', status: 'done', done: true, createdAtMs: NOW - 10 * DAY, updatedAtMs: NOW - 2 * DAY, dependsOn: ['task_vars'] },
      { id: 'task_plans_css', text: 'Update plans.css and roles.css', status: 'done', done: true, createdAtMs: NOW - 10 * DAY, updatedAtMs: NOW - 2 * DAY, dependsOn: ['task_vars'] },
    ],
    files: [
      { path: 'styles/main.css', taskId: 'task_vars', addedAtMs: NOW - 3 * DAY, source: 'agent' },
      { path: 'styles/agents.css', taskId: 'task_agents_css', addedAtMs: NOW - 2 * DAY, source: 'agent' },
    ],
    mergeStatus: 'merged',
  },
  {
    id: 'goal_voice',
    strandId: 'strand_helix01',
    title: 'Add voice recording with Whisper',
    status: 'active',
    phase: 2,
    priority: 'medium',
    notes: 'Implement browser-based voice recording using MediaRecorder API with server-side Whisper transcription',
    createdAtMs: NOW - 8 * DAY,
    updatedAtMs: NOW - 3 * HOUR,
    sessions: ['agent:main:subagent:voice_task_001'],
    tasks: [
      { id: 'task_recorder', text: 'Build MediaRecorder frontend component', status: 'done', done: true, createdAtMs: NOW - 8 * DAY, updatedAtMs: NOW - 5 * DAY },
      { id: 'task_whisper', text: 'Integrate Whisper transcription endpoint', status: 'in-progress', sessionKey: 'agent:main:subagent:voice_task_001', agentId: 'main', createdAtMs: NOW - 5 * DAY, updatedAtMs: NOW - 3 * HOUR },
      { id: 'task_ui_polish', text: 'Polish recording UI with waveform visualization', status: 'pending', createdAtMs: NOW - 4 * DAY, dependsOn: ['task_whisper'] },
    ],
  },
  {
    id: 'goal_search',
    strandId: 'strand_helix01',
    title: 'Implement global search (Ctrl+K)',
    status: 'active',
    phase: 2,
    priority: 'low',
    notes: 'Add fuzzy search across sessions, goals, and strands with keyboard-driven navigation',
    createdAtMs: NOW - 6 * DAY,
    updatedAtMs: NOW - 1 * DAY,
    sessions: ['agent:main:main'],
    dependsOn: ['goal_redesign'],
    tasks: [
      { id: 'task_search_ui', text: 'Build search overlay with Ctrl+K trigger', status: 'done', done: true, createdAtMs: NOW - 6 * DAY, updatedAtMs: NOW - 2 * DAY },
      { id: 'task_fuzzy', text: 'Implement fuzzy matching algorithm', status: 'in-progress', sessionKey: 'agent:main:main', agentId: 'main', createdAtMs: NOW - 4 * DAY, updatedAtMs: NOW - 1 * DAY },
      { id: 'task_keyboard', text: 'Add keyboard navigation (arrows, enter, esc)', status: 'pending', dependsOn: ['task_fuzzy'], createdAtMs: NOW - 4 * DAY },
    ],
  },
  // Recipe Box goals
  {
    id: 'goal_recipe_api',
    strandId: 'strand_recipe02',
    title: 'Backend REST API',
    status: 'active',
    phase: 1,
    priority: 'high',
    createdAtMs: NOW - 7 * DAY,
    updatedAtMs: NOW - 6 * HOUR,
    sessions: ['agent:main:subagent:recipe_api_001'],
    tasks: [
      { id: 'task_models', text: 'Define recipe and ingredient data models', status: 'done', done: true, createdAtMs: NOW - 7 * DAY, updatedAtMs: NOW - 5 * DAY },
      { id: 'task_crud', text: 'Implement CRUD endpoints for recipes', status: 'done', done: true, createdAtMs: NOW - 6 * DAY, updatedAtMs: NOW - 4 * DAY, dependsOn: ['task_models'] },
      { id: 'task_auth', text: 'Add JWT authentication middleware', status: 'in-progress', sessionKey: 'agent:main:subagent:recipe_api_001', agentId: 'main', createdAtMs: NOW - 4 * DAY, updatedAtMs: NOW - 6 * HOUR },
      { id: 'task_tests', text: 'Write API integration tests', status: 'pending', dependsOn: ['task_crud', 'task_auth'], createdAtMs: NOW - 3 * DAY },
    ],
  },
  {
    id: 'goal_recipe_ui',
    strandId: 'strand_recipe02',
    title: 'Frontend recipe browser',
    status: 'active',
    phase: 2,
    priority: 'medium',
    dependsOn: ['goal_recipe_api'],
    createdAtMs: NOW - 5 * DAY,
    updatedAtMs: NOW - 8 * HOUR,
    sessions: [],
    tasks: [
      { id: 'task_layout', text: 'Create responsive grid layout', status: 'pending', createdAtMs: NOW - 5 * DAY },
      { id: 'task_cards', text: 'Build recipe card components', status: 'pending', dependsOn: ['task_layout'], createdAtMs: NOW - 5 * DAY },
      { id: 'task_filters', text: 'Add search and filter controls', status: 'pending', dependsOn: ['task_cards'], createdAtMs: NOW - 5 * DAY },
    ],
  },
  // DevOps goal
  {
    id: 'goal_cicd',
    strandId: 'strand_devops03',
    title: 'GitHub Actions CI/CD pipeline',
    status: 'active',
    phase: 1,
    priority: 'high',
    createdAtMs: NOW - 3 * DAY,
    updatedAtMs: NOW - 30 * 60000,
    sessions: ['agent:main:subagent:cicd_001', 'agent:main:subagent:cicd_002'],
    tasks: [
      { id: 'task_lint', text: 'Set up ESLint + Prettier workflow', status: 'done', done: true, createdAtMs: NOW - 3 * DAY, updatedAtMs: NOW - 2 * DAY },
      { id: 'task_test_ci', text: 'Configure Vitest in CI', status: 'done', done: true, createdAtMs: NOW - 3 * DAY, updatedAtMs: NOW - 1 * DAY },
      { id: 'task_docker_build', text: 'Add Docker build & push step', status: 'in-progress', sessionKey: 'agent:main:subagent:cicd_001', agentId: 'main', createdAtMs: NOW - 2 * DAY, updatedAtMs: NOW - 30 * 60000 },
      { id: 'task_deploy', text: 'Auto-deploy to staging on merge', status: 'pending', dependsOn: ['task_docker_build'], createdAtMs: NOW - 2 * DAY },
      { id: 'task_notifications', text: 'Add Slack deployment notifications', status: 'pending', dependsOn: ['task_deploy'], createdAtMs: NOW - 1 * DAY },
    ],
  },
];

const MOCK_SESSIONS = [
  { key: 'agent:main:main', name: 'Main Agent', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 2 * HOUR, createdAt: NOW - 14 * DAY },
  { key: 'agent:main:subagent:voice_task_001', name: 'Voice Recording Worker', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 3 * HOUR, createdAt: NOW - 5 * DAY },
  { key: 'agent:main:subagent:recipe_api_001', name: 'Recipe API Builder', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 6 * HOUR, createdAt: NOW - 4 * DAY },
  { key: 'agent:main:subagent:cicd_001', name: 'CI/CD Pipeline Agent', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 30 * 60000, createdAt: NOW - 2 * DAY },
  { key: 'agent:main:subagent:cicd_002', name: 'Docker Config Agent', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 1 * HOUR, createdAt: NOW - 1 * DAY },
  { key: 'agent:main:telegram:group:dev_chat:topic:general', name: 'Dev Team Chat', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 45 * 60000, createdAt: NOW - 10 * DAY },
  { key: 'agent:main:telegram:group:dev_chat:topic:bugs', name: 'Bug Reports', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 5 * HOUR, createdAt: NOW - 8 * DAY },
  { key: 'agent:main:discord:general', name: 'Discord General', model: 'anthropic/claude-sonnet-4-5-20250929', updatedAt: NOW - 12 * HOUR, createdAt: NOW - 7 * DAY },
];

const MOCK_AGENTS = [
  { id: 'main', name: 'Main Agent', identity: { name: 'Helix Prime', emoji: '🧬' }, model: 'claude-sonnet-4-5-20250929' },
  { id: 'app-assistant', name: 'App Assistant', identity: { name: 'App Helper', emoji: '📱' }, model: 'claude-sonnet-4-5-20250929' },
  { id: 'researcher', name: 'Research Agent', identity: { name: 'Scholar', emoji: '🔍' }, model: 'claude-sonnet-4-5-20250929' },
];

const MOCK_AGENT_STATUS = {
  'agent:main:main': 'idle',
  'agent:main:subagent:voice_task_001': 'thinking',
  'agent:main:subagent:recipe_api_001': 'thinking',
  'agent:main:subagent:cicd_001': 'thinking',
  'agent:main:subagent:cicd_002': 'idle',
  'agent:main:telegram:group:dev_chat:topic:general': 'idle',
  'agent:main:telegram:group:dev_chat:topic:bugs': 'idle',
  'agent:main:discord:general': 'idle',
};

// Inject mock data into the app's global state and render a view
function buildInjectScript(view, extras = {}) {
  return { strands: MOCK_STRANDS, goals: MOCK_GOALS, sessions: MOCK_SESSIONS, agents: MOCK_AGENTS, agentStatus: MOCK_AGENT_STATUS, view, ...extras };
}

test.describe('Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    page.on('pageerror', () => {});
    page.on('console', () => {});
  });

  async function loadAndInject(page, data) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Dismiss login modal, prevent re-showing, and inject mock data
    await page.evaluate((d) => {
      // Hide login modal and prevent it from reappearing (WS disconnect triggers it)
      const m = document.getElementById('loginModal');
      if (m) m.classList.add('hidden');
      // Override showLoginModal so WS failures don't bring it back
      window.showLoginModal = function() {};

      // Inject data into global state
      if (typeof state !== 'undefined') {
        state.strands = d.strands;
        state.goals = d.goals;
        state.sessions = d.sessions;
        state.agents = d.agents;
        state.runs = {};
        state.sessionAgentStatus = d.agentStatus;

        // Inject runs to show active sessions in stats
        for (const [key, status] of Object.entries(d.agentStatus)) {
          if (status === 'thinking') state.runs[key] = 'running';
        }
      }
    }, data);

    await page.waitForTimeout(300);
  }

  test('dashboard overview', async ({ page }) => {
    const data = buildInjectScript('overview');
    await loadAndInject(page, data);

    // Render the overview components
    await page.evaluate(() => {
      if (typeof updateStatsGrid === 'function') updateStatsGrid();
      if (typeof renderStrandStatusBoard === 'function') renderStrandStatusBoard();
      if (typeof renderGoals === 'function') renderGoals();
      if (typeof renderRecentSessions === 'function') renderRecentSessions();
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'dashboard-overview.png'),
      fullPage: false,
    });
  });

  test('agents overview', async ({ page }) => {
    const data = buildInjectScript('agents');
    await loadAndInject(page, data);

    // Activate agents view
    await page.evaluate(() => {
      if (typeof deactivateAllViews === 'function') deactivateAllViews();
      const agentsView = document.getElementById('agentsView');
      if (agentsView) agentsView.classList.add('active');
      document.getElementById('mainTitle').textContent = 'Agents Overview';
      document.getElementById('mainSubtitle').textContent = '';
      const ha = document.getElementById('headerAction');
      if (ha) ha.style.display = 'none';
      const hsi = document.getElementById('headerStatusIndicator');
      if (hsi) hsi.style.display = 'none';
      if (typeof renderAgentsOverview === 'function') renderAgentsOverview();
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'agents-overview.png'),
      fullPage: false,
    });
  });

  test('strand context', async ({ page }) => {
    const data = buildInjectScript('strandContext', { strandId: 'strand_helix01' });
    await loadAndInject(page, data);

    // Activate strand context view
    await page.evaluate((d) => {
      state.currentStrandContextId = d.strandId;
      if (typeof deactivateAllViews === 'function') deactivateAllViews();
      const strandView = document.getElementById('strandContextView');
      if (strandView) strandView.classList.add('active');
      if (typeof renderStrandContext === 'function') renderStrandContext();
    }, data);
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'strand-context.png'),
      fullPage: false,
    });
  });

  test('settings services', async ({ page }) => {
    const data = buildInjectScript('settings');
    await loadAndInject(page, data);

    // Activate settings view and render service cards with mock services
    await page.evaluate(() => {
      if (typeof deactivateAllViews === 'function') deactivateAllViews();
      const settingsView = document.getElementById('settingsView');
      if (settingsView) settingsView.classList.add('active');
      document.getElementById('mainTitle').textContent = 'Settings';
      document.getElementById('mainSubtitle').textContent = '';
      const ha = document.getElementById('headerAction');
      if (ha) ha.style.display = 'none';
      const hsi = document.getElementById('headerStatusIndicator');
      if (hsi) hsi.style.display = 'none';

      // Render service cards with mock connected services
      if (typeof renderServiceCards === 'function') {
        renderServiceCards(
          {
            github: { token: '***', authMode: 'token' },
            claude: { apiKey: '***', model: 'claude-sonnet-4-5-20250929' },
            vercel: { token: '***', team: 'helix-team' },
          },
          null,
        );
      }
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-services.png'),
      fullPage: false,
    });
  });

  test('search view', async ({ page }) => {
    const data = buildInjectScript('search');
    await loadAndInject(page, data);

    // Render the overview first so there's content behind the search overlay
    await page.evaluate(() => {
      if (typeof updateStatsGrid === 'function') updateStatsGrid();
      if (typeof renderStrandStatusBoard === 'function') renderStrandStatusBoard();
      if (typeof renderGoals === 'function') renderGoals();
    });
    await page.waitForTimeout(300);

    // Open search with Ctrl+K
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'search-view.png'),
      fullPage: false,
    });
  });

  test('login modal', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForTimeout(2000);

    // Show login modal
    await page.evaluate(() => {
      const m = document.getElementById('loginModal');
      if (m) m.classList.remove('hidden');
    });
    await page.waitForTimeout(500);

    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'login-modal.png'),
      fullPage: false,
    });
  });
});
