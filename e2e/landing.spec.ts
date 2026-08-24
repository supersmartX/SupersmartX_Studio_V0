import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders hero section with correct content', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Record professional videos on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Free' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log In' }).first()).toBeVisible();
  });

  test('navigates to studio on "Start Free" click', async ({ page }) => {
    await page.goto('/');
    const startFreeButton = page.getByRole('button', { name: 'Start Free' }).first();
    await startFreeButton.click();
    await expect(page).toHaveURL(/\/studio/);
  });

  test('opens auth modal on "Log In" click', async ({ page }) => {
    await page.goto('/');
    const loginButton = page.getByRole('button', { name: 'Log In' }).first();
    await loginButton.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/Sign in|Log in|Create account/i);
  });

  test('scrolls to pricing section', async ({ page }) => {
    await page.goto('/');
    const pricingNav = page.getByRole('link', { name: 'Pricing' }).first();
    await pricingNav.click();
    await expect(page.getByText('Most Popular')).toBeVisible();
  });

  test('displays how-it-works steps', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Write your script')).toBeVisible();
    await expect(page.getByText('Record yourself')).toBeVisible();
    await expect(page.getByText('Export & share')).toBeVisible();
  });

  test('displays pricing tiers', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Free').first()).toBeVisible();
    await expect(page.getByText('$4.99').first()).toBeVisible();
  });

  test('mobile menu toggles correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const menuButton = page.getByRole('button', { name: /menu/i });
    await menuButton.click();
    await expect(page.getByRole('link', { name: 'How It Works' }).first()).toBeVisible();
  });
});

test.describe('Landing Page - Accessibility', () => {
  test('has no auto-playing video without controls', async ({ page }) => {
    await page.goto('/');
    const videos = page.locator('video');
    const count = await videos.count();
    for (let i = 0; i < count; i++) {
      const video = videos.nth(i);
      const autoplay = await video.getAttribute('autoplay');
      const muted = await video.getAttribute('muted');
      if (autoplay !== null) {
        expect(muted).not.toBeNull();
      }
    }
  });
});
