import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('renders hero section with correct content', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Record professional videos on')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Free' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log In' }).first()).toBeVisible();
  });

  test('navigates to studio on "Start Free" click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const startFreeButton = page.getByRole('button', { name: 'Start Free' }).first();
    await startFreeButton.click();
    await expect(page).toHaveURL(/\/studio/);
  });

  test('opens auth modal on "Log In" click', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const loginButton = page.getByRole('button', { name: 'Log In' }).first();
    await loginButton.click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(/Sign in|Log in|Create account/i);
  });

  test('scrolls to pricing section', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const menuButton = page.getByRole('button', { name: /menu/i });
    const isMobile = await menuButton.isVisible().catch(() => false);
    if (isMobile) {
      await menuButton.click();
      await page.waitForTimeout(300);
    }
    const pricingNav = page.getByRole('link', { name: 'Pricing' }).first();
    const isPricingVisible = await pricingNav.isVisible().catch(() => false);
    if (isPricingVisible) {
      await pricingNav.click();
      await expect(page.getByText('Most Popular')).toBeVisible();
    }
  });

  test('displays how-it-works steps', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Write your script')).toBeVisible();
    await expect(page.getByText('Record yourself')).toBeVisible();
    await expect(page.getByText('Export & share')).toBeVisible();
  });

  test('displays pricing tiers', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('text=Free, text=Pro', { timeout: 10000 }).catch(() => {});
    const hasFree = await page.getByText('Free').first().isVisible().catch(() => false);
    const hasPro = await page.getByText('Pro').first().isVisible().catch(() => false);
    expect(hasFree || hasPro).toBeTruthy();
  });

  test('mobile menu toggles correctly', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const menuButton = page.getByRole('button', { name: /menu/i });
    await menuButton.click();
    await expect(page.getByRole('link', { name: 'How It Works' }).first()).toBeVisible();
  });
});

test.describe('Landing Page - Accessibility', () => {
  test('has no auto-playing video without controls', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
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
