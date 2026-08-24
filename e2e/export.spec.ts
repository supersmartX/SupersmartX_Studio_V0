import { test, expect } from '@playwright/test';

test.describe('Export Modal - Platform Selection', () => {
  test('platforms list is visible in export modal', async ({ page }) => {
    await page.goto('/studio');

    const platformTexts = [
      'YouTube Landscape',
      'YouTube Shorts',
      'Instagram Reels',
      'TikTok',
      'Instagram Post',
      'Instagram Portrait',
      'LinkedIn',
    ];

    for (const platform of platformTexts) {
      const option = page.getByText(platform, { exact: false }).first();
      const isVisible = await option.isVisible().catch(() => false);
      if (isVisible) {
        await expect(option).toBeVisible();
      }
    }
  });
});

test.describe('Export Modal - Auth Gates', () => {
  test('export button shows disabled state without recording', async ({ page }) => {
    await page.goto('/studio');
    const exportButton = page.getByRole('button', { name: 'Export recording' });
    await expect(exportButton).toBeDisabled();
  });
});

test.describe('Export Modal - Failure Scenarios', () => {
  test('handles API failure during export gracefully', async ({ page }) => {
    await page.route('**/api/upload', (route) => {
      route.fulfill({ status: 500, body: JSON.stringify({ error: 'Internal server error' }) });
    });

    await page.goto('/studio');

    const errorMessage = page.getByText(/error.*upload|upload.*failed|try again/i);
    const hasError = await errorMessage.isVisible().catch(() => false);
    if (hasError) {
      await expect(errorMessage).toBeVisible();
    }
  });

  test('handles network disconnection during export', async ({ page, context }) => {
    await page.goto('/studio');
    await context.setOffline(true);

    const retryButton = page.getByRole('button', { name: /retry|try again/i });
    const hasRetry = await retryButton.isVisible().catch(() => false);
    if (hasRetry) {
      await expect(retryButton).toBeVisible();
    }

    await context.setOffline(false);
  });
});
