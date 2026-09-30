/* STATE 2 — Free platform restrictions.
 *
 * Free (and anonymous) can only ever produce YouTube 16:9. Every other launch
 * format must be visible, honestly labelled as locked, and lead to the Creator
 * upgrade path — never to a silent platform switch, a stuck spinner, a 500, or
 * an export request the server has to reject.
 *
 * Two independent layers are proven here:
 *   UI  — the switcher, the upgrade prompt, and the CTA branch (guest vs Free)
 *   API — a tampered export job from a real Free account is refused cleanly
 */
import {
  test,
  expect,
  instrument,
  blockCloud,
  transport,
  switcher,
  lockedPlatform,
  recordTake,
  expectReview,
  apiRegister,
  cleanupTestUser,
  LOCKED_PLATFORMS,
} from './helpers';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';

test.use({
  permissions: ['camera', 'microphone'],
  viewport: { width: 1440, height: 900 },
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  },
});

test.setTimeout(300_000);

/** The upgrade prompt raised by clicking a locked format. */
function upgradePrompt(page: import('@playwright/test').Page, label: string) {
  return page.getByRole('dialog', { name: `Create for ${label} with Creator` });
}

/** Free's locked formats must be honest: lock icon + a title that says why. */
async function expectLockedAffordance(page: import('@playwright/test').Page, label: string) {
  const button = lockedPlatform(page, label);
  await expect(button, `${label} must be visible to Free`).toBeVisible();
  await expect(button).toHaveAttribute('title', `${label} — Creator plan required`);
  await expect(button.locator('svg'), `${label} must show a lock icon`).toHaveCount(1);
  // Locked != selected: only the active button gets an inline brand colour.
  await expect(button).not.toHaveAttribute('style', /background-color/);
}

/** YouTube is the only choice Free actually has, and it stays chosen. */
async function expectOnlyYoutubeAvailable(page: import('@playwright/test').Page) {
  const active = switcher(page).locator('button[style*="background-color"]');
  await expect(active, 'exactly one platform may be active for Free').toHaveCount(1);
  await expect(active).toHaveAttribute('title', 'YouTube');
  await expect(switcher(page).locator('button[title="YouTube"]')).toBeVisible();
}

/** No error toast, ever. A 500 or failed fetch would surface here. */
async function expectNoErrorToast(page: import('@playwright/test').Page) {
  const toasts = page.getByRole('status');
  const n = await toasts.count();
  for (let i = 0; i < n; i++) {
    const text = (await toasts.nth(i).innerText().catch(() => '')) || '';
    expect(text, `unexpected toast: ${text}`).not.toMatch(/error|failed|unexpected|invalid|unauthorized/i);
  }
}

test.describe('STATE 2 — Free platform restrictions', () => {
  test('2.1 anonymous Free: all six locked formats are visible, locked, and inert', async ({ page }) => {
    await instrument(page);
    const cloudAttempts = await blockCloud(page);

    await page.goto('/studio');
    await recordTake(page);
    await expectReview(page);

    // Every launch format is offered — Free is not hiding them, it is
    // upselling them. The matrix is complete and nothing is missing.
    for (const { label } of LOCKED_PLATFORMS) {
      await expectLockedAffordance(page, label);
    }
    await expect(switcher(page).locator('button')).toHaveCount(LOCKED_PLATFORMS.length + 1);
    await expectOnlyYoutubeAvailable(page);

    // Clicking each one raises its own upgrade prompt and changes nothing.
    for (const { label, sublabel } of LOCKED_PLATFORMS) {
      await lockedPlatform(page, label).click();

      const prompt = upgradePrompt(page, label);
      await expect(prompt).toBeVisible();
      await expect(prompt.getByRole('heading', { name: `Create for ${label}` })).toBeVisible();
      await expect(prompt.getByText(`${sublabel} with Creator. Free supports YouTube 16:9 only.`)).toBeVisible();
      // The pitch is concrete, and the restriction is stated.
      await expect(prompt.getByText('All supported platform formats')).toBeVisible();
      await expect(prompt.getByText('1080p with no watermark')).toBeVisible();

      // A guest cannot subscribe yet, and is told so rather than dumped into checkout.
      await expect(prompt.getByRole('button', { name: 'Continue' })).toBeVisible();
      await expect(prompt.getByRole('button', { name: 'Use Free instead' })).toBeVisible();
      await expect(prompt.getByText('Account required to subscribe and download')).toBeVisible();

      // THE KEY ASSERTION: a locked click must not switch the preview format.
      await expectOnlyYoutubeAvailable(page);

      await prompt.getByRole('button', { name: 'Use Free instead' }).click();
      await expect(prompt).toBeHidden();
      await expectOnlyYoutubeAvailable(page);
      await expectNoErrorToast(page);
    }

    // Not one export/cloud request was made while probing all six.
    expect(cloudAttempts, `locked clicks must never reach the cloud: ${cloudAttempts.join(', ')}`).toEqual([]);
  });

  test('2.2 anonymous Free: upgrade CTA leads to auth, and the take is never lost', async ({ page }) => {
    await instrument(page);
    await page.goto('/studio');
    await recordTake(page);
    await expectReview(page);

    await lockedPlatform(page, 'TikTok').click();
    const prompt = upgradePrompt(page, 'TikTok');
    await expect(prompt).toBeVisible();

    await prompt.getByRole('button', { name: 'Continue' }).click();

    // Guest -> auth, not a payment wall and not an error.
    const authDialog = page.getByRole('dialog').filter({ hasText: /email|sign in|log in|create account/i }).first();
    await expect(authDialog).toBeVisible({ timeout: 20_000 });
    await expectNoErrorToast(page);

    // Dismissing auth must leave the take fully intact: dismiss the export
    // sheet, return, and the recording is still there and still exportable.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // The upgrade intent is cleared on dismissal, so it cannot haunt a later visit.
    const staleIntent = await page.evaluate(() => window.localStorage.getItem('sxs-upgrade-intent'));
    expect(staleIntent, 'a dismissed upgrade prompt must not leave a stale intent').toBeNull();

    // The take survived the whole upgrade detour.
    await expect(page.locator('main video')).toHaveAttribute('src', /^blob:/);
    await page.getByRole('button', { name: 'Export recording' }).click();
    const exportDialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(exportDialog).toBeVisible({ timeout: 20_000 });
    // Free still has its one working format, unchanged.
    await expect(exportDialog.getByText('16:9 · 1280 × 720')).toBeVisible();
    await expect(exportDialog.getByRole('button', { name: /^Export YouTube · 1280×720$/ })).toBeVisible();
  });

  test('2.3 authenticated Free: same locks, but the CTA goes straight to Creator pricing', async ({ page }) => {
    const email = `e2e-state2-locks-${Date.now()}@example.com`;
    await cleanupTestUser(email);
    await apiRegister(page.request, email);

    await instrument(page);
    const cloudAttempts = await blockCloud(page);

    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /log\s?in/i })).toHaveCount(0);

    await recordTake(page);
    await expectReview(page);

    // Identical lock matrix to the guest — authentication is not the gate.
    for (const { label } of LOCKED_PLATFORMS) {
      await expectLockedAffordance(page, label);
    }
    await expectOnlyYoutubeAvailable(page);

    for (const { label, sublabel } of LOCKED_PLATFORMS) {
      await lockedPlatform(page, label).click();

      const prompt = upgradePrompt(page, label);
      await expect(prompt).toBeVisible();
      await expect(prompt.getByText(`${sublabel} with Creator. Free supports YouTube 16:9 only.`)).toBeVisible();

      // A signed-in Free user is offered the real upgrade, with no auth detour.
      await expect(prompt.getByRole('button', { name: 'Upgrade to Creator' })).toBeVisible();
      await expect(prompt.getByRole('button', { name: 'Not now' })).toBeVisible();
      await expect(prompt.getByText('Account required to subscribe and download')).toHaveCount(0);

      await expectOnlyYoutubeAvailable(page);

      await prompt.getByRole('button', { name: 'Not now' }).click();
      await expect(prompt).toBeHidden();
      await expectNoErrorToast(page);
    }

    // The upgrade CTA actually opens Creator pricing (not auth, not an error).
    await lockedPlatform(page, 'Instagram Square').click();
    await upgradePrompt(page, 'Instagram Square').getByRole('button', { name: 'Upgrade to Creator' }).click();
    const pricing = page.getByRole('dialog', { name: 'Choose Plan' });
    await expect(pricing, 'Free must be able to reach Creator pricing').toBeVisible({ timeout: 20_000 });
    await expect(pricing.getByText('Creator', { exact: false }).first()).toBeVisible();
    await pricing.getByRole('button', { name: 'Close' }).click();
    await expect(pricing).toBeHidden();

    expect(cloudAttempts, `locked clicks must never reach the cloud: ${cloudAttempts.join(', ')}`).toEqual([]);

    await cleanupTestUser(email);
  });

  test('2.4 authenticated Free: export sheet stays on YouTube and admits the restriction', async ({ page }) => {
    const email = `e2e-state2-sheet-${Date.now()}@example.com`;
    await cleanupTestUser(email);
    await apiRegister(page.request, email);

    await instrument(page);
    const cloudAttempts = await blockCloud(page);

    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /log\s?in/i })).toHaveCount(0);

    await recordTake(page);
    await expectReview(page);

    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    // Signed in, so the guest copy is gone and the Free copy is shown.
    await expect(dialog.getByText('Free Plan — YouTube 16:9 included, unlimited downloads')).toBeVisible();
    await expect(dialog.getByText('Export as guest — YouTube 16:9 included')).toHaveCount(0);
    // The restriction and its cost are both disclosed up front.
    await expect(dialog.getByText('Other formats need Creator. Exports include a watermark.')).toBeVisible();

    // The sheet only confirms a format; it is chosen in the Studio switcher.
    // So the round trip under test is: dismiss -> probe switcher -> reopen.
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    for (const { label } of LOCKED_PLATFORMS) {
      await lockedPlatform(page, label).click();
      await expect(upgradePrompt(page, label)).toBeVisible();
      await upgradePrompt(page, label).getByRole('button', { name: 'Not now' }).click();
      await expectOnlyYoutubeAvailable(page);

      // Reopening must still be YouTube 16:9 720p — the probe left no trace.
      await page.getByRole('button', { name: 'Export recording' }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('16:9 · 1280 × 720')).toBeVisible();
      await expect(dialog.getByRole('button', { name: /^Export YouTube · 1280×720$/ })).toBeVisible();

      // No locked format is ever offered as an export target.
      const exportButtons = await dialog.locator('button').filter({ hasText: /^Export / }).allInnerTexts();
      for (const text of exportButtons) {
        expect(text, 'the only exportable format for Free is YouTube 16:9').toMatch(/^Export YouTube · 1280×720$/);
      }

      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();
      await expectReview(page);
    }

    expect(cloudAttempts).toEqual([]);

    await cleanupTestUser(email);
  });

  test('2.5 a tampered export job from Free is refused cleanly, never with a 5xx', async ({ page, playwright }) => {
    const email = `e2e-state2-api-${Date.now()}@example.com`;
    await cleanupTestUser(email);
    await apiRegister(page.request, email);

    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /log\s?in/i })).toHaveCount(0);
    const request = page.request;

    // Reference the real preset dimensions the client would send, so the request
    // is rejected for the RIGHT reason (locked plan) and not for bad shape.
    const clamped: Record<string, [number, number]> = {
      'youtube-shorts': [720, 1280],
      'instagram-reels': [720, 1280],
      'instagram-post': [720, 720],
      'instagram-portrait': [720, 900],
      tiktok: [720, 1280],
      linkedin: [720, 1280],
    };

    for (const { id, label } of LOCKED_PLATFORMS) {
      const res = await request.post('/api/export-jobs', {
        data: { config: { platformId: id, outputWidth: clamped[id][0], outputHeight: clamped[id][1] } },
      });
      const body = await res.json().catch(() => ({}));

      expect(res.status(), `${label} must be refused, not accepted (${JSON.stringify(body)})`).toBe(403);
      expect(body).toEqual({ error: 'This format requires the Creator plan' });
    }

    // The unlocked platform is still guarded on dimensions: Free is 720p-capped.
    const oversized = await request.post('/api/export-jobs', {
      data: { config: { platformId: 'youtube-landscape', outputWidth: 1920, outputHeight: 1080 } },
    });
    expect(oversized.status()).toBe(400);
    expect((await oversized.json()).error).toBe('Dimensions do not match the validated platform preset');

    // And the whole surface is authenticated. `request` and `page.request` share
    // one cookie jar, so an anonymous call needs a genuinely separate context.
    const anonCtx = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const anon = await anonCtx.post('/api/export-jobs', {
        data: { config: { platformId: 'youtube-landscape', outputWidth: 1280, outputHeight: 720 } },
      });
      expect(anon.status()).toBe(401);
      expect((await anon.json()).error).toBe('Unauthorized');

      const anonPut = await anonCtx.post('/api/exports/presigned-put', { data: { platformId: 'tiktok' } });
      expect(anonPut.status()).toBe(401);
    } finally {
      await anonCtx.dispose();
    }

    // R2 upload is refused for Free outright, before any bucket is touched.
    const put = await request.post('/api/exports/presigned-put', { data: { platformId: 'tiktok' } });
    expect(put.status(), 'Free must never be handed an R2 upload URL').toBe(403);
    expect((await put.json()).error).toBe('Free plan uses local export');

    await cleanupTestUser(email);
  });
});
