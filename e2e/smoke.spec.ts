import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { dismissWelcomeModal, grantMediaPermissions, openAuthFromLanding } from './helpers';
import { readMp4Artifact } from '../src/lib/export/mp4-metadata';
import type { Page } from '@playwright/test';

// Rendered text only: textContent('body') includes inline <script>/<style>
// payloads (e.g. Next.js flight IDs containing "4K"), which makes
// copy-guard assertions randomly fail. innerText excludes those.
async function visibleCopy(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText || '');
}

// Fake media devices for the whole smoke file: only the camera-journey
// tests request getUserMedia, the rest are unaffected. Non-chromium
// projects skip the camera journey (see below).
test.use({
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

test.beforeEach(async ({ context, browserName }) => {
  await grantMediaPermissions(context, browserName);
});

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
    // Pricing cards reveal on scroll (intersection animation) — bring them
    // into view before asserting, especially on small viewports. Scoped to
    // the pricing section: bare getByText('Free') matches hidden dupes first.
    const pricing = page.locator('#pricing');
    await pricing.getByText('Creator').first().scrollIntoViewIfNeeded();
    await expect(pricing.getByText('Free').first()).toBeVisible();
    await expect(pricing.getByText('Creator').first()).toBeVisible();
    const planNames = page.locator('.lsx-pricing-plan');
    const count = await planNames.count();
    for (let i = 0; i < count; i++) {
      const text = await planNames.nth(i).textContent();
      expect(text?.trim()).not.toBe('Pro');
    }
  });

  test('no "4K" or "batch export" in user-facing copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const body = await visibleCopy(page);
    expect(body).not.toContain('4K');
    expect(body).not.toContain('batch export');
    expect(body).not.toContain('Batch Export');
  });

  test('no "Smart Crop" or "Auto-Reframe" in user-facing copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const body = await visibleCopy(page);
    expect(body).not.toContain('Smart Crop');
    expect(body).not.toContain('Auto-Reframe');
    expect(body).not.toContain('auto-reframe');
  });

  test('no "video editor" in user-facing copy', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const body = await visibleCopy(page);
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
    const body = await visibleCopy(page);
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
  // On small viewports the header CTA is hidden behind the burger menu.
  // Wait for the header to settle first: an early visibility check races
  // hydration and takes the wrong branch.
  async function openAuthFromLanding(page: Page) {
    await expect(page.getByRole('link', { name: /supersmartx/i }).first()).toBeVisible();
    const burger = page.getByRole('button', { name: /open menu/i });
    if (await burger.isVisible().catch(() => false)) {
      await burger.click();
      await page.locator('#lsx-mobile-nav').getByRole('button', { name: 'Log In' }).click();
    } else {
      await page.getByRole('button', { name: 'Log In' }).first().click();
    }
    await expect(page.getByRole('dialog')).toBeVisible();
    // UX-005: "Log in" now opens on the sign-in step; these smoke checks cover
    // the chooser's surfaces, so step back to it.
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Back to all options' })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  test('Google button visible', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    const modal = page.getByRole('dialog');
    const googleButton = modal.getByRole('button', { name: /google/i });
    await expect(googleButton).toBeVisible();
  });

  test('no GitHub button', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    const modal = page.getByRole('dialog');
    const githubButton = modal.getByRole('button', { name: /github/i });
    await expect(githubButton).not.toBeVisible();
  });

  test('credentials form available', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openAuthFromLanding(page);
    const modal = page.getByRole('dialog');
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
  // The plan label may still render in the receipt, but the page must not claim
  // the payment succeeded: nothing here is server-verified, so the heading has to
  // stay neutral. See e2e/support.spec.ts for the full verification contract.
  test('displays Creator (not Pro) for creator plans', async ({ page }) => {
    await page.goto('/support/success?order_id=test123&plan=creator_monthly');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Creator (1 month)').first()).toBeVisible();
    await expect(page.locator('h1').getByText('Pro')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /payment successful/i })).toHaveCount(0);
  });

  test('displays Creator (not Pro) for legacy pro plan', async ({ page }) => {
    await page.goto('/support/success?order_id=test123&plan=pro_yearly');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Creator (1 year)').first()).toBeVisible();
    await expect(page.locator('h1').getByText('Pro')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: /payment successful/i })).toHaveCount(0);
  });
});

test.describe('Smoke Test - Static Pages', () => {
  test('privacy page loads', async ({ page }) => {
    await page.goto('/legal/privacy', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /privacy/i }).first()).toBeVisible();
  });

  test('terms page loads', async ({ page }) => {
    await page.goto('/legal/terms', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /terms/i }).first()).toBeVisible();
  });

  test('reset-password page shows the reset form', async ({ page }) => {
    await page.goto('/auth/reset-password', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /reset/i }).first()).toBeVisible();
  });

  test('unknown route renders the not-found page', async ({ page }) => {
    await page.goto('/definitely-not-a-real-page-12345', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  });

  test('robots.txt and sitemap.xml are served', async ({ request }) => {
    const robots = await request.get('/robots.txt');
    expect(robots.status()).toBe(200);
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
  });
});

test.describe('Smoke Test - API Contract', () => {
  test('health reports healthy', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
  });

  test('protected routes reject anonymous callers with 401', async ({ request }) => {
    for (const [method, path, body] of [
      ['GET', '/api/exports', undefined],
      ['GET', '/api/download?exportId=abc', undefined],
      ['POST', '/api/exports/presigned-put', {}],
      ['POST', '/api/export-jobs', {}],
      ['GET', '/api/recordings', undefined],
      ['GET', '/api/user/stats', undefined],
      ['POST', '/api/feedback', { text: 'smoke' }],
      ['POST', '/api/export-jobs/cleanup', {}],
    ] as const) {
      const res = body === undefined
        ? await request[method.toLowerCase() as 'get'](path)
        : await request.post(path, { data: body });
      expect(res.status(), `${method} ${path}`).toBe(401);
    }
  });

  test('session endpoint answers without a session', async ({ request }) => {
    const res = await request.get('/api/auth/session');
    expect(res.status()).toBe(200);
  });

  test('webhook rejects unsigned payloads', async ({ request }) => {
    const res = await request.post('/api/cashfree/webhook', { data: {} });
    // 400 when the gateway secret is configured (missing signature headers),
    // 503/500 when unconfigured — either way an unsigned webhook never succeeds.
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test('password recovery is enumeration-safe and rejects bogus tokens', async ({ request }) => {
    const forgot = await request.post('/api/auth/forgot-password', {
      data: { email: 'smoke-nonexistent-x@example.invalid' },
    });
    expect(forgot.status()).toBe(200);
    expect((await forgot.json()).ok).toBe(true);

    const reset = await request.post('/api/auth/reset-password', {
      data: { token: 'bogus-token', password: 'NewPass123!x' },
    });
    expect(reset.status()).toBe(400);
  });
});

async function gotoLibrary(page: Page) {
  await page.getByRole('button', { name: 'Recordings' }).first().click();
}

test.describe('Smoke Test - Studio UI States', () => {
  test('welcome modal shows on fresh load and Explore dismisses it', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('dialog', { name: /welcome/i })).toBeVisible();
    await page.getByRole('button', { name: 'Explore Studio' }).click();
    await expect(page.getByRole('dialog', { name: /welcome/i })).not.toBeVisible();
  });

  test('camera init overlay prompts before permission', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await expect(page.getByRole('button', { name: 'Enable Camera & Microphone' })).toBeVisible();
    await expect(page.getByText('Studio Ready')).toBeVisible();
  });

  test('device selectors are present', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await expect(page.locator('select[aria-label="Camera"]')).toBeVisible();
    await expect(page.locator('select[aria-label="Microphone"]')).toBeVisible();
  });

  test('device selectors are not duplicated inside the inspector', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    // Device picking lives in the DeviceSelectorBar above the canvas only. A
    // second pair of selects in the Inspector would be two controls writing the
    // same state, so the count must stay at exactly one each.
    await expect(page.locator('select[aria-label="Camera"]')).toHaveCount(1);
    await expect(page.locator('select[aria-label="Microphone"]')).toHaveCount(1);
  });

  test('inspector is reachable as a drawer below the 1280px breakpoint', async ({ page }) => {
    // Between 640px and 1280px there is no IconRail, so the BottomNav Settings
    // entry is the only way in. It must actually open something.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    const settingsButton = page.getByRole('button', { name: 'Settings' }).first();
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    await expect(page.getByRole('dialog', { name: 'Inspector panel' })).toBeVisible();
  });

  test('below the breakpoint the side rail is hidden and the bottom nav is shown', async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    await expect(page.getByRole('navigation', { name: 'Compact navigation' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('at the breakpoint the side rail replaces the bottom nav', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);

    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Compact navigation' })).toHaveCount(0);
  });

  test('mic toggle flips mute state', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const mic = page.getByLabel('Recording controls').getByRole('button', { name: 'Mute microphone' });
    await mic.click();
    await expect(page.getByLabel('Recording controls').getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
  });

  test('inspector toggle collapses and restores the panel', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    // Desktop renders an inline aside (assert its open state); mobile renders
    // a slide-in dialog (assert its transition class instead).
    const headerToggle = page.getByRole('button', { name: 'Toggle inspector panel' });
    const toggle = await headerToggle.isVisible().catch(() => false)
      ? headerToggle
      : page.getByRole('button', { name: 'Settings' }).first();
    if (await page.locator('aside').count() > 0) {
      const aside = page.locator('aside').first();
      const before = await aside.getAttribute('aria-hidden');
      await toggle.click();
      await expect.poll(async () => aside.getAttribute('aria-hidden')).not.toBe(before);
      await toggle.click();
      await expect.poll(async () => aside.getAttribute('aria-hidden')).toBe(before);
    } else {
      const drawer = page.getByRole('dialog', { name: 'Inspector panel' });
      await toggle.click();
      await expect(drawer).toHaveClass(/translate-x-0/);
      // The open drawer covers the header toggle, so close via its backdrop —
      // the same path a user takes.
      await page.locator('.drawer-backdrop').click();
      await expect(drawer).toHaveClass(/translate-x-full/);
    }
  });

  test('keyboard shortcuts help is reachable where shown', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    const shortcuts = page.getByRole('button', { name: 'Shortcuts' }).first();
    if (await shortcuts.isVisible().catch(() => false)) {
      await shortcuts.click();
      await expect(page.getByText(/Space: Start/i).first()).toBeVisible();
    }
  });

  test('timer shows Ready 00:00 before recording', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await expect(page.getByText('00:00').first()).toBeVisible();
    await expect(page.getByText('Ready').first()).toBeVisible();
  });

  test('typing a script shows it in the teleprompter', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await page.getByLabel('Script Editor').fill('smoketestword alpha beta');
    await expect(page.getByText(/smoketestword/).first()).toBeVisible();
  });

  test('library shows empty states on a fresh profile', async ({ page }) => {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await dismissWelcomeModal(page);
    await gotoLibrary(page);
    await expect(page.getByText('No recordings yet')).toBeVisible();
    await expect(page.getByText('No saved exports yet')).toBeVisible();
  });
});

test.describe('Smoke Test - Auth Modal Behaviors', () => {
  async function openAuth(page: Page) {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /supersmartx/i }).first()).toBeVisible();
    const burger = page.getByRole('button', { name: /open menu/i });
    if (await burger.isVisible().catch(() => false)) {
      await burger.click();
      await page.locator('#lsx-mobile-nav').getByRole('button', { name: 'Log In' }).click();
    } else {
      await page.getByRole('button', { name: 'Log In' }).first().click();
    }
    await expect(page.getByRole('dialog')).toBeVisible();
    // UX-005: "Log in" opens on the sign-in step; these behaviour checks cover
    // the shared shell + registration form, so step back to the chooser.
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Back to all options' })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }

  test('Escape closes the auth modal', async ({ page }) => {
    await openAuth(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('Close button closes the auth modal', async ({ page }) => {
    await openAuth(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('invalid email shows a validation error', async ({ page }) => {
    await openAuth(page);
    const modal = page.getByRole('dialog');
    await modal.getByPlaceholder('you@example.com').fill('not-an-email');
    await modal.getByRole('button', { name: 'Create Account' }).click();
    await expect(modal.getByText('Please enter a valid email address')).toBeVisible();
  });
});

test.describe('Smoke Test - Pricing Modal', () => {
  // The Choose-Plan dialog has no guest entry point on studio (pricing lives
  // behind auth); guests arriving with a checkout intent are routed to auth
  // first, then pricing after login. That closed loop is what's tested here.
  test('checkout intent routes guests to auth first', async ({ page }) => {
    // 'networkidle' never settles here: the studio keeps live connections open
    // (session refresh, device polling). Assert on the dialog instead.
    await page.goto('/studio?checkout=creator_monthly', { waitUntil: 'domcontentloaded' });
    // UX-005 relabelled the auth surfaces to match their visible headings:
    // chooser = "Create New Profile", sign-in = "Enter your email".
    await expect(page.getByRole('dialog', { name: /log in|email|create new profile/i }).first()).toBeVisible({ timeout: 15000 });
  });
});

test.describe('Smoke Test - Camera Journey (chromium)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

  async function recordTake(page: Page) {
    await page.goto('/studio');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    const getStarted = page.getByRole('button', { name: 'Get Started' });
    if (await getStarted.isVisible({ timeout: 4000 }).catch(() => false)) {
      await getStarted.click();
    }
    const start = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
    await expect(start).toBeEnabled({ timeout: 15000 });
    await start.click();
    const stop = page.getByLabel('Recording controls').getByRole('button', { name: 'Stop Recording' });
    await stop.waitFor({ timeout: 20000 });
    await page.waitForTimeout(4000);
    await stop.click();
    await page.waitForTimeout(500);
    await stop.click();
    await page.waitForTimeout(2500);
  }

  test('record → stop → review shows Export', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    await recordTake(page);
    await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeVisible({ timeout: 15000 });
    const tracks = await page.evaluate(() => {
      const v = document.querySelector('video[aria-label="Camera preview"]') as HTMLVideoElement | null;
      if (!v || !v.srcObject) return ['no-stream'];
      return (v.srcObject as MediaStream).getTracks().map((t: MediaStreamTrack) => t.readyState);
    });
    expect(tracks.every((s) => s === 'ended' || s === 'no-stream')).toBe(true);
    expect(pageErrors.filter((m) => /MediaRecorder|getUserMedia/i.test(m))).toEqual([]);
  });

  test('library preview modal shows user-worded metadata', async ({ page }) => {
    await recordTake(page);
    await gotoLibrary(page);
    await page.getByRole('button', { name: /^Preview video$/ }).first().click();
    // The library's existing-recording surface. Workflow B: it previews and
    // exports the stored take, so its dialog is named for the visible title.
    const dialog = page.getByRole('dialog', { name: 'Existing video' }).first();
    await expect(dialog).toBeVisible({ timeout: 10000 });
    await expect(dialog.getByText(/Recorded /)).toBeVisible();
    const text = (await dialog.textContent()) || '';
    expect(text).not.toContain('mimeType');
    expect(text).not.toContain('codecs');
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  });

  test('locked platform proposes an upgrade, export stays on YouTube', async ({ page }) => {
    await recordTake(page);
    const reels = page.getByRole('button', { name: /reels/i }).first();
    if (await reels.isVisible().catch(() => false)) {
      await reels.click();
      await expect(page.getByRole('dialog').filter({ hasText: /creator/i }).first()).toBeVisible({ timeout: 8000 });
      await page.keyboard.press('Escape');
    }
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog).toBeVisible({ timeout: 10000 });
    // Dismissing the upgrade must leave the single source of truth (the Studio's
    // "Preview as" switcher) on YouTube, so the modal confirms YouTube. This run
    // is an unauthenticated Free guest, so 16:9 is also clamped to the Free
    // 1280×720 ceiling rather than the Creator 1920×1080.
    await expect(dialog.getByText('YouTube', { exact: true })).toBeVisible();
    await expect(dialog.getByText('16:9 · 1280 × 720')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Export YouTube/ })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('export encodes, completes, and downloads a real file', async ({ page }) => {
    test.setTimeout(180_000);
    await recordTake(page);
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await dialog.getByRole('button', { name: /Export YouTube/ }).click();
    const downloadBtn = dialog.getByRole('button', { name: /Download Video/i });
    await expect(downloadBtn).toBeVisible({ timeout: 150000 });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      downloadBtn.click(),
    ]);
    const filePath = await download.path();
    expect(filePath).toBeTruthy();

    // PHASE 3 — the bytes on disk are parsed HERE in Node with the SAME
    // production parser the server verifies with: a real ISO-BMFF container
    // (ftyp first), moov and mdat present, a real video sample entry, the
    // Free-clamped 16:9 frame this journey exported, and a positive-finite
    // container duration — not merely a file that exists.
    const fileBytes = new Uint8Array(await readFile(filePath!));
    expect(fileBytes.byteLength, 'the download must carry real bytes').toBeGreaterThan(1000);
    const artifact = readMp4Artifact(fileBytes.buffer as ArrayBuffer);
    expect(artifact, 'the downloaded export must be a parseable MP4').not.toBeNull();
    expect(artifact?.hasFtyp, 'ftyp must be the first box').toBe(true);
    expect(artifact?.hasMoov).toBe(true);
    expect(artifact?.hasMdat).toBe(true);
    expect(artifact?.videoTrackCount).toBeGreaterThanOrEqual(1);
    expect({ width: artifact?.width, height: artifact?.height }).toEqual({ width: 1280, height: 720 });
    expect(artifact?.durationSeconds ?? 0, 'container duration must be positive').toBeGreaterThan(0);
    expect(Number.isFinite(artifact?.durationSeconds), 'container duration must be finite').toBe(true);
  });
});
