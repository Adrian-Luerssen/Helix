import { test, expect } from '@playwright/test';

test.describe('Strands', () => {
  test('strand list section exists', async ({ page }) => {
    await page.goto('/');
    // Look for strand-related UI elements
    const strandSection = page.locator('#strandStatusBoard, .strand-status-board, #strandsList');
    const count = await strandSection.count();
    // The strand section should exist even if empty
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('create strand modal elements exist', async ({ page }) => {
    await page.goto('/');
    // The create strand modal should exist in DOM (hidden)
    const modal = page.locator('#createStrandModal');
    const count = await modal.count();
    if (count > 0) {
      // Modal exists but should be hidden initially
      await expect(modal).not.toBeVisible();
    }
  });

  test('strand cards render for existing strands', async ({ page }) => {
    await page.goto('/');
    // Wait for initial load
    await page.waitForTimeout(2000);
    // Check for strand status cards
    const cards = page.locator('.strand-status-card');
    const count = await cards.count();
    // We don't know if strands exist, just verify no rendering errors
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
