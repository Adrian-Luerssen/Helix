import { test, expect } from '@playwright/test';

test.describe('Strand Context', () => {
  test('strand context view container exists in DOM', async ({ page }) => {
    await page.goto('/');
    const strandView = page.locator('#strandContextView');
    expect(await strandView.count()).toBe(1);
    // Should not be visible by default (not active)
    await expect(strandView).not.toHaveClass(/active/);
  });

  test('strand context has info and workspace panels', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('#strandInfoPanel').count()).toBe(1);
    expect(await page.locator('#strandWorkspacePanel').count()).toBe(1);
  });

  test('strand context has goals graph', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('#strandGoalsGraph').count()).toBe(1);
  });

  test('strand context has timeline', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('#strandTimeline').count()).toBe(1);
  });

  test('strand context has action buttons', async ({ page }) => {
    await page.goto('/');
    const strandView = page.locator('#strandContextView');
    const actions = strandView.locator('.strand-context-actions .btn');
    const count = await actions.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('no JS errors when navigating to strand context', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    // Navigate to a non-existent strand ID (should not crash)
    await page.goto('/#/strand/test-strand-id');
    await page.waitForTimeout(2000);
    const unexpectedErrors = errors.filter(e =>
      !e.includes('WebSocket') &&
      !e.includes('ws://') &&
      !e.includes('wss://') &&
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError')
    );
    expect(unexpectedErrors).toEqual([]);
  });

  test('strand status board exists on dashboard', async ({ page }) => {
    await page.goto('/');
    const strandBoard = page.locator('#strandStatusBoard');
    expect(await strandBoard.count()).toBe(1);
    // Should be within the strandStatusSection
    const section = page.locator('#strandStatusSection');
    expect(await section.count()).toBe(1);
  });
});
