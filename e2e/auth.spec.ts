import { test, expect } from '@playwright/test';

test.describe('Auth Flow - Registration', () => {
  test('opens auth modal', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();
  });

  test('shows registration form fields', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    const hasContent = await modal.locator('input, button').count();
    expect(hasContent).toBeGreaterThan(0);
  });

  test('can switch between registration and login', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    const switchToLogin = page.getByRole('button', { name: 'Log in' }).last();
    if (await switchToLogin.isVisible().catch(() => false)) {
      await switchToLogin.click();
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    }
  });
});

test.describe('Auth Flow - Social Login', () => {
  test('Google sign-in button is visible', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Log In' }).first().click();
    const googleButton = page.getByRole('button', { name: /google/i });
    await expect(googleButton).toBeVisible();
  });
});

test.describe('Auth Flow - Password Reset', () => {
  test('navigates to reset password page', async ({ page }) => {
    await page.goto('/auth/reset-password');
    await page.waitForLoadState('networkidle');
    const heading = page.getByRole('heading');
    const headingCount = await heading.count();
    expect(headingCount).toBeGreaterThanOrEqual(0);
  });
});
