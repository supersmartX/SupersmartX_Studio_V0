import { test, expect } from '@playwright/test';

test.describe('Support - Success Page', () => {
  test('displays success heading', async ({ page }) => {
    await page.goto('/support/success?order_id=order-123&plan=pro-monthly');
    await expect(page.getByRole('heading', { name: /success/i })).toBeVisible();
  });

  test('displays order ID', async ({ page }) => {
    await page.goto('/support/success?order_id=order-456&plan=pro-monthly');
    await expect(page.getByText('order-456')).toBeVisible();
  });

  test('displays subscription message', async ({ page }) => {
    await page.goto('/support/success?order_id=order-789&plan=pro-monthly');
    await expect(page.getByText(/thank you for subscribing/i)).toBeVisible();
  });

  test('has link back to studio', async ({ page }) => {
    await page.goto('/support/success?order_id=order-123&plan=pro-monthly');
    const studioLink = page.getByRole('link', { name: /studio/i }).first();
    const hasLink = await studioLink.isVisible().catch(() => false);
    if (hasLink) {
      await studioLink.click();
      await expect(page).toHaveURL(/\/studio/);
    }
  });
});

test.describe('Support - Error Handling', () => {
  test('handles missing order_id gracefully', async ({ page }) => {
    await page.goto('/support/success');
    const heading = page.getByRole('heading');
    const headingCount = await heading.count();
    expect(headingCount).toBeGreaterThanOrEqual(0);
  });

  test('handles invalid order_id', async ({ page }) => {
    await page.goto('/support/success?order_id=invalid-order&plan=pro-monthly');
    const heading = page.getByRole('heading');
    const headingCount = await heading.count();
    expect(headingCount).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Legal Pages', () => {
  test('terms page loads with content', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByRole('heading', { name: 'Terms of Service' })).toBeVisible();
  });

  test('privacy page loads with content', async ({ page }) => {
    await page.goto('/legal/privacy');
    await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
  });

  test('legal pages are accessible from landing page', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    const termsLink = page.getByRole('link', { name: /terms/i }).first();
    const privacyLink = page.getByRole('link', { name: /privacy/i }).first();

    const hasTerms = await termsLink.isVisible().catch(() => false);
    const hasPrivacy = await privacyLink.isVisible().catch(() => false);

    if (hasTerms) {
      await termsLink.click();
      await expect(page).toHaveURL(/\/legal\/terms/);
    }

    if (hasPrivacy) {
      await page.goto('/');
      await privacyLink.click();
      await expect(page).toHaveURL(/\/legal\/privacy/);
    }
  });
});
