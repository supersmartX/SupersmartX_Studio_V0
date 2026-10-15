import { test, expect, type Page, type Locator } from '@playwright/test';
import { apiRegister, dismissWelcomeModal } from './helpers';

// Regression coverage for the three reported production UX defects:
//   1. "Log in" must open directly on the email sign-in step (email + social
//      visible immediately; "Back to all options" is a secondary link only).
//   2. Ordinary sign-in must NOT open the pricing/checkout modal — the landing
//      page only attaches a checkout intent for an explicit purchase CTA.
//   3. An intentional upgrade ("Get Creator") started while signed out must
//      resume the payment form after sign-in with the captured plan.
// Plus session continuity across main-logo navigation.

const TEST_PASSWORD = 'Correct-horse-battery-staple-1';

// `next dev` compiles the large /studio route on demand; the first navigation
// to it after login was observed to exceed the default 30s test budget on a
// cold server (warm runs: ~1s). Give every test room for one cold start.
test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(90_000);
});

/** Opens the landing auth modal the way the header/burger "Log in" does. */
async function openLoginIntentFromLanding(page: Page): Promise<Locator> {
  await expect(page.getByRole('link', { name: /supersmartx/i }).first()).toBeVisible();
  const burger = page.getByRole('button', { name: /open menu/i });
  if (await burger.isVisible().catch(() => false)) {
    await burger.click();
    await page.locator('#lsx-mobile-nav').getByRole('button', { name: 'Log In' }).click();
  } else {
    await page.getByRole('button', { name: 'Log In' }).first().click();
  }
  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  return modal;
}

async function fillLoginStep(modal: Locator, email: string): Promise<void> {
  // The inputs carry no <label> association — their accessible names come
  // from placeholders (existing convention in smoke / p0-upgrade specs).
  await modal.getByPlaceholder('you@example.com').fill(email);
  await modal.getByPlaceholder('Enter password').fill(TEST_PASSWORD);
  await modal.getByRole('button', { name: 'Log in' }).last().click();
}

test.describe('Regression: login intent opens on the sign-in step', () => {
  test('email and social options are visible immediately on "Log in"', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const modal = await openLoginIntentFromLanding(page);

    // No intermediate chooser: the dialog opens directly on the sign-in step.
    await expect(modal).toHaveAttribute('aria-label', 'Enter your email');
    await expect(modal.getByRole('button', { name: /google/i })).toBeVisible();
    await expect(modal.getByPlaceholder('you@example.com')).toBeVisible();
    await expect(modal.getByPlaceholder('Enter password')).toBeVisible();
    await expect(modal.getByRole('button', { name: 'Log in', exact: true })).toBeVisible();
    // "Back to all options" is available but secondary — not a required step.
    await expect(modal.getByRole('button', { name: 'Back to all options' })).toBeVisible();
  });
});

test.describe('Regression: ordinary sign-in does not open checkout', () => {
  test('fresh credentials login lands on /studio with no pricing modal', async ({ page, request }) => {
    const email = `nav-ordinary-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await apiRegister(request, email);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const modal = await openLoginIntentFromLanding(page);
    await fillLoginStep(modal, email);

    await expect(modal).toBeHidden({ timeout: 15000 });
    // Generous budget: `next dev` compiles the large /studio route on demand
    // on first hit per server lifetime (observed >15s cold, ~1s warm).
    await page.waitForURL((url) => url.pathname === '/studio', { timeout: 45000 });

    // The bug shipped /studio?checkout=creator_monthly after every login.
    expect(new URL(page.url()).search).toBe('');

    // Sign-in itself succeeded — session is live...
    const session = await (await page.request.get('/api/auth/session')).json();
    expect(session?.user?.email).toBe(email);

    // ...and no pricing/payment modal appears (auto-open window is 400ms;
    // wait well past it plus initial mount).
    await page.waitForTimeout(1500);
    await expect(page.getByRole('dialog', { name: 'Choose Your Plan' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Complete Payment' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Regression: upgrade-before-login resumes checkout', () => {
  test('"Get Creator" while signed out then sign-in opens the payment form', async ({ page, request }) => {
    const email = `nav-upgrade-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await apiRegister(request, email);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /supersmartx/i }).first()).toBeVisible();

    // Explicit purchase CTA stores sxs-pending-plan and opens the register step.
    await page.getByRole('button', { name: 'Get Creator' }).click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // Switch to the sign-in step and authenticate with the existing account.
    await modal.getByRole('button', { name: 'Log in' }).last().click();
    await expect(modal).toHaveAttribute('aria-label', 'Enter your email');
    await fillLoginStep(modal, email);

    await expect(modal).toBeHidden({ timeout: 15000 });
    // Generous budget: `next dev` compiles the large /studio route on demand
    // on first hit per server lifetime (observed >15s cold, ~1s warm).
    await page.waitForURL((url) => url.pathname === '/studio', { timeout: 45000 });

    // The captured intent must resume checkout on the payment form
    // (pricingInitialStep === 'form' → dialog name "Complete Payment").
    await expect(page.getByRole('dialog', { name: 'Complete Payment' })).toBeVisible({ timeout: 15000 });

    // The pending plan was consumed, not left to retrigger later.
    const stored = await page.evaluate(() => window.localStorage.getItem('sxs-pending-plan'));
    expect(stored).toBeNull();
  });
});

test.describe('Regression: main-logo navigation preserves the session', () => {
  test('Studio → logo → landing keeps the same account signed in', async ({ page, request }) => {
    const email = `nav-logo-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
    await apiRegister(request, email);

    // Sign in through the landing UI.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const modal = await openLoginIntentFromLanding(page);
    await fillLoginStep(modal, email);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15000 });

    // From Studio, click the main logo.
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await dismissWelcomeModal(page);
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15000 });
    await page.getByRole('link', { name: /supersmartx/i }).first().click();
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15000 });

    // Same account, no re-login: UI still authenticated and no Log in button.
    await expect(page.getByRole('button', { name: 'User menu' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: 'Log In' })).toHaveCount(0);

    // Server-side session intact for the same identity.
    const session = await (await page.request.get('/api/auth/session')).json();
    expect(session?.user?.email).toBe(email);
  });
});
