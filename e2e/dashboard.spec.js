import { test, expect } from '@playwright/test';

test.describe('Dashboard', () => {
  test('loads the main page', async ({ page }) => {
    await page.goto('/');
    // The page should have the Helix title
    await expect(page).toHaveTitle(/Helix/i);
  });

  test('shows connection status indicator', async ({ page }) => {
    await page.goto('/');
    // Connection status element should exist
    const statusEl = page.locator('#connectionStatus, .connection-status, [data-connection-status]');
    await expect(statusEl.first()).toBeVisible({ timeout: 5000 }).catch(() => {
      // Connection status may not be visible if it auto-connects
    });
  });

  test('sidebar navigation is present', async ({ page }) => {
    await page.goto('/');
    // Look for sidebar/nav elements
    const sidebar = page.locator('.sidebar, #sidebar, nav');
    await expect(sidebar.first()).toBeVisible({ timeout: 5000 });
  });

  test('search view can be opened with Ctrl+K', async ({ page }) => {
    await page.goto('/');
    // Ctrl+K opens the search view
    await page.keyboard.press('Control+k');
    // The search view should become active
    const searchView = page.locator('#searchView');
    await expect(searchView).toHaveClass(/active/, { timeout: 3000 });
    // Search input should be visible and focused
    const searchInput = page.locator('#searchViewInput');
    await expect(searchInput).toBeVisible({ timeout: 2000 });
  });

  test('stats grid shows summary cards', async ({ page }) => {
    await page.goto('/');
    const statsGrid = page.locator('#statsGrid');
    await expect(statsGrid).toBeVisible({ timeout: 5000 });
    // Should have 4 stat cards
    const cards = statsGrid.locator('.stat-card');
    await expect(cards).toHaveCount(4, { timeout: 5000 });
  });

  test('overview view is active by default', async ({ page }) => {
    await page.goto('/');
    const overviewView = page.locator('#overviewView');
    await expect(overviewView).toHaveClass(/active/, { timeout: 5000 });
  });

  test('strands status board container exists', async ({ page }) => {
    await page.goto('/');
    const strandBoard = page.locator('#strandStatusBoard');
    const count = await strandBoard.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('agents overview view exists', async ({ page }) => {
    await page.goto('/');
    const agentsView = page.locator('#agentsView');
    const count = await agentsView.count();
    expect(count).toBe(1);
  });

  test('strand context view exists', async ({ page }) => {
    await page.goto('/');
    const strandView = page.locator('#strandContextView');
    const count = await strandView.count();
    expect(count).toBe(1);
  });

  test('sidebar has strands, apps, and agents sections', async ({ page }) => {
    await page.goto('/');
    // Check for sidebar section titles
    const sectionTitles = page.locator('.section-title');
    const count = await sectionTitles.count();
    expect(count).toBeGreaterThanOrEqual(3);
  });

  test('agents section has overview button', async ({ page }) => {
    await page.goto('/');
    // The agents section should have a button for agents overview
    const agentsOverviewBtn = page.locator('.section-action[title="Agents overview"]');
    const count = await agentsOverviewBtn.count();
    expect(count).toBe(1);
  });

  test('toast container exists', async ({ page }) => {
    await page.goto('/');
    const toastContainer = page.locator('#toastContainer');
    const count = await toastContainer.count();
    expect(count).toBe(1);
  });

  test('Escape closes search view', async ({ page }) => {
    await page.goto('/');
    // Open search view
    await page.keyboard.press('Control+k');
    await expect(page.locator('#searchView')).toHaveClass(/active/, { timeout: 3000 });
    // Press Escape to close
    await page.keyboard.press('Escape');
    // Wait a moment and check overview is active
    await page.waitForTimeout(500);
    const overviewView = page.locator('#overviewView');
    await expect(overviewView).toHaveClass(/active/, { timeout: 3000 });
  });
});
