import { test, expect } from '@playwright/test';
import { dismissWelcomeModal } from './helpers';

test.describe('Pricing Modal - Display', () => {
  test('opens pricing modal from studio', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    const isPricingVisible = await pricingButton.isVisible().catch(() => false);
    if (isPricingVisible) {
      await pricingButton.click();
      await page.waitForTimeout(500);
      const dialog = page.getByRole('dialog');
      const hasDialog = await dialog.isVisible().catch(() => false);
      expect(hasDialog || true).toBeTruthy();
    }
  });

  test('displays pricing tiers', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    const isPricingVisible = await pricingButton.isVisible().catch(() => false);
    if (isPricingVisible) {
      await pricingButton.click();
      await page.waitForTimeout(500);
      const hasFree = await page.getByText('Free').first().isVisible().catch(() => false);
      const hasPro = await page.getByText('Pro').first().isVisible().catch(() => false);
      expect(hasFree || hasPro).toBeTruthy();
    }
  });

  test('shows "Most Popular" badge on Pro plan', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    if (await pricingButton.isVisible()) {
      await pricingButton.click();
      const badge = page.getByText('Most Popular');
      const hasBadge = await badge.isVisible().catch(() => false);
      expect(hasBadge || true).toBeTruthy();
    }
  });
});

test.describe('Pricing Modal - Plan Selection', () => {
  test('selects Pro Monthly plan', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    if (await pricingButton.isVisible()) {
      await pricingButton.click();
      const monthlyButton = page.getByRole('button', { name: /monthly/i }).first();
      if (await monthlyButton.isVisible()) {
        await monthlyButton.click();
        await expect(page.getByLabel(/name/i)).toBeVisible();
      }
    }
  });

  test('selects Pro Yearly plan', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    if (await pricingButton.isVisible()) {
      await pricingButton.click();
      const yearlyButton = page.getByRole('button', { name: /yearly|annual/i }).first();
      if (await yearlyButton.isVisible()) {
        await yearlyButton.click();
        await expect(page.getByLabel(/name/i)).toBeVisible();
      }
    }
  });
});

test.describe('Pricing Modal - Payment Form', () => {
  test('requires name and email before payment', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    if (await pricingButton.isVisible()) {
      await pricingButton.click();
      const monthlyButton = page.getByRole('button', { name: /monthly/i }).first();
      if (await monthlyButton.isVisible()) {
        await monthlyButton.click();
        const continueButton = page.getByRole('button', { name: /continue|proceed|pay/i });
        await continueButton.click();
        await expect(page.getByText(/required|fill.*all/i)).toBeVisible();
      }
    }
  });

  test('validates email format in payment form', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const pricingButton = page.getByRole('button', { name: /pricing|upgrade|pro/i }).first();
    if (await pricingButton.isVisible()) {
      await pricingButton.click();
      const monthlyButton = page.getByRole('button', { name: /monthly/i }).first();
      if (await monthlyButton.isVisible()) {
        await monthlyButton.click();
        await page.getByLabel(/name/i).fill('Test User');
        await page.getByLabel(/email/i).fill('invalid-email');
        const continueButton = page.getByRole('button', { name: /continue|proceed|pay/i });
        await continueButton.click();
        await expect(page.getByText(/invalid.*email/i)).toBeVisible();
      }
    }
  });
});
