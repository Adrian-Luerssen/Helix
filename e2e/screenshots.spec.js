import { test } from '@playwright/test';
import { join } from 'path';

const SCREENSHOT_DIR = join(import.meta.dirname, '..', 'public', 'media', 'screenshots');

test.describe('Screenshots', () => {
  test.beforeEach(async ({ page }) => {
    // Suppress expected WebSocket/network errors
    page.on('pageerror', () => {});
    page.on('console', () => {});
  });

  test('dashboard overview', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    // Wait for dashboard to render
    await page.waitForTimeout(2000);
    // Dismiss login modal if visible
    const loginModal = page.locator('#loginModal');
    if (await loginModal.isVisible().catch(() => false)) {
      await page.evaluate(() => {
        document.getElementById('loginModal').classList.add('hidden');
      });
      await page.waitForTimeout(500);
    }
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'dashboard-overview.png'),
      fullPage: false,
    });
  });

  test('agents overview', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/agents');
    await page.waitForTimeout(2000);
    // Dismiss login modal if visible
    await page.evaluate(() => {
      const m = document.getElementById('loginModal');
      if (m) m.classList.add('hidden');
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'agents-overview.png'),
      fullPage: false,
    });
  });

  test('condo context', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/condo/demo');
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const m = document.getElementById('loginModal');
      if (m) m.classList.add('hidden');
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'condo-context.png'),
      fullPage: false,
    });
  });

  test('settings services', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/settings');
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const m = document.getElementById('loginModal');
      if (m) m.classList.add('hidden');
    });
    await page.waitForTimeout(500);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'settings-services.png'),
      fullPage: false,
    });
  });

  test('search view', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const m = document.getElementById('loginModal');
      if (m) m.classList.add('hidden');
    });
    await page.waitForTimeout(500);
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
    // Show login modal if not already visible
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
