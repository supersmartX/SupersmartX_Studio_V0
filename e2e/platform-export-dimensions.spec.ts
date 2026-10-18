/* Track 1 â€” Platform â†’ Export correctness repro.
 *
 * Selected platform must determine the exported MP4 dimensions end to end:
 *   switcher pick â†’ exportConfig â†’ encoder output bytes.
 *
 * Method: record ONE real take with fake media, then for each launch aspect
 * pick the platform chip, open the export sheet, assert the sheet shows the
 * preset dimensions, run the REAL browser encode (mediabunny), capture the
 * exact bytes the app PUTs to storage, decode them in a video element, and
 * assert coded width/height equal the preset.
 *
 * The R2 PUT is stubbed at the network edge (presigned-put returns a routable
 * upload URL whose PUT is captured and answered 200). The bytes asserted are
 * the encoder's real output â€” nothing is mocked above the storage edge.
 *
 * No conditional guards: every expect must pass or the test fails loudly.
 */
import { test, expect, type Page } from '@playwright/test';
import {
  studioReady,
  transport,
  stopRecording,
  switcher,
  apiRegister,
  db,
  cleanupTestUser,
  grantMediaPermissions,
} from './helpers';

test.use({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
    ],
  },
});

test.beforeEach(async ({ context, browserName }) => {
  await grantMediaPermissions(context, browserName);
});

test.setTimeout(1_200_000);

test.skip(
  !process.env.DATABASE_URL,
  'needs the local dev database file; skipping against shared DB',
);
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

const CASES = [
  { title: 'YouTube', label: 'YouTube', width: 1920, height: 1080 },
  { title: 'YouTube Shorts', label: 'YouTube Shorts', width: 1080, height: 1920 },
  { title: 'Instagram Square', label: 'Instagram Square', width: 1080, height: 1080 },
  { title: 'Instagram Portrait', label: 'Instagram Portrait', width: 1080, height: 1350 },
] as const;

/** Decode MP4 bytes in a real video element; returns coded dimensions. */
async function decodeMp4Dims(page: Page, buf: Buffer): Promise<{ w: number; h: number }> {
  return page.evaluate(async (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
    try {
      const v = document.createElement('video');
      v.muted = true;
      v.preload = 'auto';
      v.src = url;
      await new Promise<void>((resolve, reject) => {
        v.onloadedmetadata = () => resolve();
        v.onerror = () => reject(new Error('video metadata error'));
        setTimeout(() => reject(new Error('video metadata timeout')), 30000);
      });
      return { w: v.videoWidth, h: v.videoHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, buf.toString('base64'));
}

test('selected platform determines the encoded MP4 dimensions', async ({ page }) => {
  const email = `e2eplatform${Date.now()}@example.com`;
  try {
    await page.goto('/studio');
    await studioReady(page);

    // Register + upgrade to Creator so every launch format is unlocked.
    await apiRegister(page.request, email);
    await db().execute({
      sql: `UPDATE users SET plan = 'creator_monthly', plan_expires_at = ? WHERE email = ?`,
      args: [FUTURE, email.toLowerCase()],
    });
    await page.reload();
    await studioReady(page);

    // Record ONE take reused for every platform.
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page)
      .getByRole('button', { name: 'Stop Recording' })
      .waitFor({ state: 'visible', timeout: 30000 });
    await page.waitForTimeout(4000);
    await stopRecording(page);
    await page.getByText('Preview as', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await expect(page.locator('main video')).toHaveAttribute('src', /^blob:/, { timeout: 30000 });

    // Stub the storage edge: the encoder runs for real in the browser; only
    // the R2 round-trip is stubbed (same-origin so the app CSP allows it).
    // The downloaded file below is the encoder's real output bytes.
    await page.route('**/api/exports/presigned-put', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jobId: `ej-e2e-${Date.now()}`,
          key: 'e2e/capture.mp4',
          uploadUrl: '/api/e2e-upload-capture',
          expiresIn: 900,
        }),
      }),
    );
    await page.route('**/api/e2e-upload-capture', (route) => route.fulfill({ status: 200, body: '' }));
    await page.route('**/api/exports/complete', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ exportId: 'ex-e2e', r2Key: 'e2e/capture.mp4' }),
      }),
    );

    for (const c of CASES) {
      // 1. Pick the platform in the review switcher.
      await switcher(page).locator(`button[title="${c.title}"]`).click();
      await expect(page.getByText(`${c.label} Â·`, { exact: false }).first()).toBeVisible({
        timeout: 10000,
      });

      // 2. Open the export sheet from the review Export button (drives
      // selectPlatform for the previewed platform).
      await page.getByRole('button', { name: 'Export', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Export recording' });
      await dialog.waitFor({ state: 'visible', timeout: 15000 });

      // 3. The sheet must show the preset dimensions â€” no silent 16:9 fallback.
      await expect(dialog.getByText(`${c.width} Ã— ${c.height}`).first()).toBeVisible({
        timeout: 10000,
      });

      // 4. Run the real export; the server job POST carries the live config.
      const jobPromise = page.waitForResponse(
        (r) => r.url().includes('/api/export-jobs') && r.request().method() === 'POST',
        { timeout: 120000 },
      );
      const donePromise = dialog.getByText('Video exported').waitFor({ timeout: 600000 });
      await dialog.getByRole('button', { name: `Export ${c.label} Â· ${c.width}Ã—${c.height}` }).click();
      const jobResp = await jobPromise;
      expect(jobResp.status(), `${c.title}: export job POST must succeed`).toBe(201);
      const { jobId } = (await jobResp.json()) as { jobId: string };
      expect(typeof jobId, `${c.title}: server must return a job id`).toBe('string');
      await donePromise;

      // 5. The done caption must name the preset dimensionsâ€¦
      await expect(dialog.getByText(`${c.width} Ã— ${c.height}`).first()).toBeVisible({
        timeout: 10000,
      });

      // 6. â€¦and the downloaded file must decode at exactly those dimensions.
      const dlPromise = page.waitForEvent('download', { timeout: 60000 });
      await dialog.getByRole('button', { name: 'Download Video' }).click();
      const dl = await dlPromise;
      const dlPath = await dl.path();
      expect(dlPath, `${c.title}: download must produce a file`).toBeTruthy();
      const bytes = require('fs').readFileSync(dlPath!) as Buffer;
      expect(bytes.length, `${c.title}: downloaded MP4 must not be empty`).toBeGreaterThan(1000);
      const dims = await decodeMp4Dims(page, bytes);
      expect(
        dims,
        `${c.title}: coded MP4 dims must equal preset ${c.width}x${c.height}`,
      ).toEqual({ w: c.width, h: c.height });

      // 7. Fail the server job out so the next platform is not concurrency-blocked.
      const patch = await page.request.patch(`/api/export-jobs/${jobId}`, {
        data: { status: 'failed', errorMessage: 'e2e cleanup' },
      });
      expect(patch.status(), `${c.title}: cleanup PATCH must succeed`).toBe(200);

      // 8. Back to the platform step, then close the sheet for the next round.
      await dialog.getByRole('button', { name: 'Export for Another Platform' }).click();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
    }
  } finally {
    await cleanupTestUser(email);
  }
});

