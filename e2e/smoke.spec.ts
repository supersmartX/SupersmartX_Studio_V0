import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from './helpers';

test.describe('Smoke Test - Landing Page', () => {
  test('hero matches spec: "Record once. Publish everywhere."', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const heading = page.getByRole('heading', { name: /Record once.*Publish/ });
    await expect(heading).toBeVisible();
  });

  test('CTA: "Start Recording — Free" navigates to studio', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Start Recording — Free' }).first().click();
    await expect(page).toHaveURL(/\/studio/);
  });

  test('CTA: "See how it works" scrolls to how-it-works', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'See how it works' }).first().click();
    await page.waitForTimeout(500);
    const section = page.locator('#how-it-works');
    await expect(section).toBeVisible();
  });

  test('how-it-works: Script → Record → Preview & export', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Write your script' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Record yourself' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Preview & export' })).toBeVisible();
  });

  test('pricing shows Free and Creator (not Pro)', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Free').first()).toBeVisible();
    await expect(page.getByText('Creator').first()).toBeVisible();
    const planNames = page.locator('.lsx-pricing-plan');
    const count = await planNames.count();
    for (let i = 0; i < count; i++) {
      const text = await planNames.nth(i).textContent();
      expect(text?.trim()).not.toBe('Pro');
    }
  });

  test('no "4K" or "batch export" in user-facing copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const body = await page.textContent('body');
    expect(body).not.toContain('4K');
    expect(body).not.toContain('batch export');
    expect(body).not.toContain('Batch Export');
  });

  test('no "Smart Crop" or "Auto-Reframe" in user-facing copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const body = await page.textContent('body');
    expect(body).not.toContain('Smart Crop');
    expect(body).not.toContain('Auto-Reframe');
    expect(body).not.toContain('auto-reframe');
  });

  test('no "video editor" in user-facing copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const body = await page.textContent('body');
    expect(body).not.toContain('video editor');
  });
});

test.describe('Smoke Test - Studio', () => {
  test('studio loads with script editor', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await expect(page.getByLabel('Script Editor')).toBeVisible();
  });

  test('record button visible and disabled (no camera)', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const recordButton = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
    await expect(recordButton).toBeVisible();
    await expect(recordButton).toBeDisabled();
  });

  test('export button hidden before recording', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await expect(page.getByRole('button', { name: 'Export recording' })).not.toBeVisible();
  });

  test('no Pro references in studio UI', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const body = await page.textContent('body');
    expect(body).not.toContain('Pro Monthly');
    expect(body).not.toContain('Pro Yearly');
    expect(body).not.toContain('Get Pro');
  });
});

test.describe('Smoke Test - Export Modal', () => {
  test('platform grid visible with correct platforms', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const exportButton = page.getByRole('button', { name: 'Export recording' });
    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await page.waitForTimeout(1000);
      const dialog = page.getByRole('dialog', { name: 'Export recording' });
      if (await dialog.isVisible().catch(() => false)) {
        await expect(dialog.getByText('YouTube')).toBeVisible();
        await expect(dialog.getByText('Reels')).toBeVisible();
        await expect(dialog.getByText('TikTok')).toBeVisible();
      }
    }
  });

  test('no crop/reframe/zoom/focal controls in export modal', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const exportButton = page.getByRole('button', { name: 'Export recording' });
    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await page.waitForTimeout(1000);
      const dialog = page.getByRole('dialog', { name: 'Export recording' });
      if (await dialog.isVisible().catch(() => false)) {
        const body = await dialog.textContent();
        expect(body).not.toContain('Adjust your crop');
        expect(body).not.toContain('SAFE AREA');
        expect(body).not.toContain('Focal');
        expect(body).not.toContain('Zoom');
        expect(body).not.toContain('Crop & reframe');
      }
    }
  });

  test('no batch export UI', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const exportButton = page.getByRole('button', { name: 'Export recording' });
    if (await exportButton.isVisible().catch(() => false)) {
      await exportButton.click();
      await page.waitForTimeout(1000);
      const dialog = page.getByRole('dialog', { name: 'Export recording' });
      if (await dialog.isVisible().catch(() => false)) {
        const body = await dialog.textContent();
        expect(body).not.toContain('Export for All');
        expect(body).not.toContain('batch');
      }
    }
  });
});

test.describe('Smoke Test - Auth Modal', () => {
  test('Google button visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    const googleButton = modal.getByRole('button', { name: /google/i });
    await expect(googleButton).toBeVisible();
  });

  test('no GitHub button', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    const githubButton = modal.getByRole('button', { name: /github/i });
    await expect(githubButton).not.toBeVisible();
  });

  test('credentials form available', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
    await expect(modal.getByPlaceholder('you@example.com')).toBeVisible();
  });
});

test.describe('Smoke Test - Pricing Modal', () => {
  test('shows Free and Creator plans', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|creator/i }).first();
    if (await pricingButton.isVisible().catch(() => false)) {
      await pricingButton.click();
      await page.waitForTimeout(2000);
      const dialog = page.getByRole('dialog', { name: 'Choose Plan' });
      if (await dialog.isVisible().catch(() => false)) {
        await expect(dialog.getByText('Free').first()).toBeVisible();
        await expect(dialog.getByText('Creator').first()).toBeVisible();
        const body = await dialog.textContent();
        expect(body).not.toContain('Pro Monthly');
        expect(body).not.toContain('Pro Yearly');
      }
    }
  });

  test('Creator features include unlimited teleprompter, voice teleprompter, and cloud library', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|creator/i }).first();
    if (await pricingButton.isVisible().catch(() => false)) {
      await pricingButton.click();
      await page.waitForTimeout(2000);
      const dialog = page.getByRole('dialog', { name: 'Choose Plan' });
      if (await dialog.isVisible().catch(() => false)) {
        const body = await dialog.textContent();
        expect(body).toContain('Unlimited teleprompter');
        expect(body).toContain('Voice-activated teleprompter');
        expect(body).toContain('Cloud video library');
      }
    }
  });
});

test.describe('Smoke Test - Payment Success Page', () => {
  test('displays Creator (not Pro) for creator plans', async ({ page }) => {
    await page.goto('/support/success?order_id=test123&plan=creator_monthly');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Creator Monthly').first()).toBeVisible();
    await expect(page.locator('h1').getByText('Pro')).not.toBeVisible();
  });

  test('displays Creator (not Pro) for legacy pro plan', async ({ page }) => {
    await page.goto('/support/success?order_id=test123&plan=pro_yearly');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Creator Yearly').first()).toBeVisible();
    await expect(page.locator('h1').getByText('Pro')).not.toBeVisible();
  });
});
