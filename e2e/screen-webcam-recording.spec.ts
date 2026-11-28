/**
 * Screen + Webcam (Loom-style) recording — items 1–10 of the feature's testing
 * contract, exercised against REAL recorded output in a real Chromium session:
 *
 *   - mode switch: Screen + Cam presents the webcam toolbar before any share;
 *   - the take runs against the composition layer and produces a real blob in
 *     review whose dimensions are the COMPOSED canvas (1280x720), not the
 *     camera's 640x480 — preview composition == recorded output;
 *   - drag, hide, show and resize happen MID-TAKE and never stop the take;
 *   - the master recording lands in IndexedDB with real bytes and duration.
 *
 * Chromium's fake media devices supply the camera/mic; the display surface is
 * faked in-page: getDisplayMedia resolves with a live canvas.captureStream()
 * painting an animated frame, so the compositor consumes a real video track
 * without needing a desktop to share. Guest-only, cloud blocked — same ground
 * rules as recording-loop.spec.ts.
 */
import {
  test,
  expect,
  instrument,
  blockCloud,
  transport,
  expectReview,
  dismissWelcomeModal,
  studioReady,
  stopRecording,
  readMasterRecordings,
  readVideo,
  grantMediaPermissions,
} from './helpers';

test.use({
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

test.beforeEach(async ({ page, context, browserName }) => {
  await instrument(page);
  await blockCloud(page);
  await grantMediaPermissions(context, browserName);
});

test.setTimeout(300_000);

// Fake Chromium media devices are required to capture in CI.
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

/**
 * Replaces getDisplayMedia with an animated 1280x720 canvas stream BEFORE any
 * page script runs. The painted frame counter makes the surface verifiably
 * live (and distinguishable from a frozen still), and the canvas track reports
 * real width/height settings, so the compositor sizes the output exactly as it
 * would from a desktop capture.
 */
async function installFakeScreen(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md || typeof md.getDisplayMedia !== 'function') return;
    const w = window as unknown as { __ssxStreams: MediaStream[] };
    md.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('fake screen: no 2d context');
      let frames = 0;
      let raf = 0;
      const paint = () => {
        frames += 1;
        ctx.fillStyle = frames % 2 ? '#1d4ed8' : '#7c3aed';
        ctx.fillRect(0, 0, 1280, 720);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 96px sans-serif';
        ctx.fillText(`SSX FAKE SCREEN ${frames}`, 120, 380);
        raf = requestAnimationFrame(paint);
      };
      paint();
      const track = canvas.captureStream(30).getVideoTracks()[0];
      track.addEventListener('ended', () => cancelAnimationFrame(raf));
      const stream = new MediaStream([track]);
      w.__ssxStreams.push(stream);
      return stream;
    };
  });
}

async function selectScreenCamMode(page: import('@playwright/test').Page) {
  await transport(page).getByRole('radio', { name: 'Screen + Cam' }).click();
}

test.describe('Screen + Webcam recording', () => {
  test('mode switch presents the webcam toolbar before any share starts', async ({ page }) => {
    await installFakeScreen(page);
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    await selectScreenCamMode(page);

    // Toolbar is live pre-configure; the draggable frame only exists over a
    // live composition (no share yet).
    await expect(page.getByTestId('webcam-toolbar')).toBeVisible();
    await expect(page.getByTestId('webcam-overlay-frame')).toHaveCount(0);
    // Both device chips are visible in combined mode.
    await expect(transport(page).getByRole('button', { name: 'Turn off camera' })).toBeVisible();
  });

  test('a real screen+webcam take survives drag/hide/show/resize and records composed output', async ({ page }) => {
    await installFakeScreen(page);
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);
    await selectScreenCamMode(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    // Countdown (if enabled) then the live take.
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });

    const frame = page.getByTestId('webcam-overlay-frame');
    await expect(frame).toBeVisible({ timeout: 15_000 });

    // --- Drag mid-take -------------------------------------------------
    const before = await frame.boundingBox();
    expect(before).not.toBeNull();
    await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.width / 2 - 120, before!.y + before!.height / 2 - 80, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const afterDrag = await frame.boundingBox();
    expect(afterDrag).not.toBeNull();
    expect(afterDrag!.x).toBeLessThan(before!.x);
    expect(afterDrag!.y).toBeLessThan(before!.y);

    // --- Hide mid-take: frame gone, take still running ------------------
    await page.getByRole('button', { name: 'Hide webcam' }).click();
    await expect(frame).toHaveCount(0);
    await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toBeVisible();
    await page.waitForTimeout(1500);

    // --- Show mid-take: restored immediately ----------------------------
    await page.getByRole('button', { name: 'Show webcam' }).click();
    await expect(frame).toBeVisible({ timeout: 5_000 });

    // --- Resize mid-take ------------------------------------------------
    const preResize = await frame.boundingBox();
    await page.getByRole('button', { name: 'Make webcam smaller' }).click();
    await page.waitForTimeout(300);
    const postResize = await frame.boundingBox();
    expect(preResize).not.toBeNull();
    expect(postResize).not.toBeNull();
    expect(postResize!.height).toBeLessThan(preResize!.height);

    // --- Finish the take -------------------------------------------------
    await page.waitForTimeout(3000);
    await stopRecording(page);
    await expectReview(page);

    // The reviewed video's dimensions are the COMPOSED canvas (the fake
    // screen's 1280x720), not the fake camera's 640x480 — proof the take
    // recorded the composition, not a raw source.
    const dims = await readVideo(page.locator('main video'));
    expect(dims.w).toBe(1280);
    expect(dims.h).toBe(720);

    // Real bytes in the master library store.
    const masters = await readMasterRecordings(page);
    expect(masters).toHaveLength(1);
    expect(masters[0].size).toBeGreaterThan(10_000);
    expect(masters[0].duration).toBeGreaterThanOrEqual(3);
  });

  test('screen-only mode still records without the webcam overlay', async ({ page }) => {
    await installFakeScreen(page);
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    await transport(page).getByRole('radio', { name: 'Screen', exact: true }).click();
    await expect(page.getByTestId('webcam-toolbar')).toHaveCount(0);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByTestId('webcam-overlay-frame')).toHaveCount(0);
    await page.waitForTimeout(3500);
    await stopRecording(page);
    await expectReview(page);

    const masters = await readMasterRecordings(page);
    expect(masters).toHaveLength(1);
    expect(masters[0].size).toBeGreaterThan(10_000);
  });
});
