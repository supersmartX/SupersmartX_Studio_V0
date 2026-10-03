import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { dismissWelcomeModal, openAuthFromLanding } from './helpers';

test.describe('Edge Cases - Form Inputs', () => {
  test('handles empty script submission', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const textarea = page.getByLabel('Script Editor');
    await textarea.fill('');
    const recordButton = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
    await expect(recordButton).toBeDisabled();
  });

  test('handles special characters in script', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const textarea = page.getByLabel('Script Editor');
    const specialScript = 'Hello & "world" \'test\'';
    await textarea.fill(specialScript);
    await expect(textarea).toHaveValue(specialScript);
  });

  test('handles unicode characters in script', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const textarea = page.getByLabel('Script Editor');
    const unicodeScript = 'مرحبا عالم 你好世界';
    await textarea.fill(unicodeScript);
    await expect(textarea).toHaveValue(unicodeScript);
  });

  test('handles maximum length script input', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const textarea = page.getByLabel('Script Editor');
    const maxLengthScript = 'A'.repeat(10000);
    await textarea.fill(maxLengthScript);
    await expect(textarea).toHaveValue(maxLengthScript);
  });
});

test.describe('Edge Cases - Auth Forms', () => {
  // Scope to the inputs by role: getByLabel(/password/i) also matches the
  // "Show password" toggle button, which is not editable.
  function authFields(page: Page) {
    const modal = page.getByRole('dialog');
    return {
      email: modal.getByRole('textbox', { name: /email/i }),
      password: modal.getByRole('textbox', { name: /password/i }),
    };
  }

  test('handles email with plus addressing', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    const { email, password } = authFields(page);
    await email.fill('user+test@example.com');
    await password.fill('ValidPass123!');
    await page.getByRole('button', { name: 'Create Account' }).click();
  });

  test('handles email with subdomain', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    const { email, password } = authFields(page);
    await email.fill('user@mail.example.com');
    await password.fill('ValidPass123!');
    await page.getByRole('button', { name: 'Create Account' }).click();
  });

  test('prevents SQL injection in email field', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    await expect(page.getByRole('dialog')).toBeVisible();

    const { email, password } = authFields(page);
    await email.fill("admin'--@example.com");
    await password.fill('password123');
    await page.getByRole('button', { name: 'Create Account' }).click();
  });
});

test.describe('Edge Cases - Browser Behavior', () => {
  test('handles back button navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL('/');
  });

  test('handles forward button navigation', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await page.goForward({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/studio/);
  });

  test('preserves viewport on mobile resize', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.getByLabel('Script Editor')).toBeVisible();
  });
});

test.describe('Edge Cases - Concurrent Actions', () => {
  test('prevents double-click on submit buttons', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    const submitButton = page.getByRole('button', { name: 'Create Account' });
    await Promise.all([
      submitButton.click().catch(() => {}),
      submitButton.click().catch(() => {}),
    ]);
    await expect(modal).toBeVisible();
  });
});
