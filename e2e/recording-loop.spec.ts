/**
 * Phase 1 recording-loop coverage — FC-1.0 items 1–4 and 8 through a real
 * Chromium capture session:
 *
 *   - countdown contract (item 2): cancellable countdown, disabled = immediate
 *     start, no quota consumed by a countdown that never records;
 *   - capture dimensions (item 3): the badge shows the configured TARGET
 *     before capture and the ACTUAL track dimensions once the camera is live;
 *   - review audio (item 4): a visible mute/unmute control that really flips
 *     playback, starting audible where autoplay policy allows;
 *   - script-end stop (item 8): reaching the end of the script stops the take
 *     and announces it with the FC copy — and only that path announces.
 *
 * Guest-only, fake media devices, cloud endpoints blocked — same ground rules
 * as workflow-ownership.spec.ts.
 */
import {
  test,
  expect,
  instrument,
  blockCloud,
  transport,
  recordTake,
  expectReview,
  dismissWelcomeModal,
  studioReady,
  stopRecording,
  readMasterRecordings,
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

test.describe('countdown contract (FC-1.0 item 2)', () => {
  test('the countdown is cancellable into a clean, uncharged state', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();

    // The pending countdown offers an explicit Cancel.
    const cancel = page.getByRole('button', { name: 'Cancel countdown' });
    await expect(cancel).toBeVisible({ timeout: 15_000 });
    await cancel.click();

    // Clean non-recording state: no phantom Stop, no overlay, camera kept
    // (Start can simply be pressed again).
    await expect(transport(page).getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 10_000 });
    await expect(cancel).toHaveCount(0);
    await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toHaveCount(0);

    // Nothing was recorded: no take, no quota burn.
    expect(await readMasterRecordings(page), 'a cancelled countdown creates no recording').toHaveLength(0);
    const charged = Number(await page.evaluate(() => localStorage.getItem('sxs-record-secs') ?? '0'));
    expect(charged, 'a cancelled countdown must not consume the daily allowance').toBe(0);

    // The recorder is fully usable afterwards.
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });
    await stopRecording(page);
    await expectReview(page);
    expect(await readMasterRecordings(page)).toHaveLength(1);
  });

  test('countdown disabled starts recording immediately — no invisible wait', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    // Turn the countdown off through the existing setting. It lives in the
    // collapsible "Camera & Preview" section of the inspector.
    const cameraSection = page.getByRole('button', { name: 'Camera & Preview' });
    await expect(cameraSection).toBeVisible({ timeout: 15_000 });
    if ((await cameraSection.getAttribute('aria-expanded')) === 'false') {
      await cameraSection.click();
    }
    const countdownSwitch = page.getByRole('switch', { name: 'Countdown' });
    await expect(countdownSwitch).toBeVisible({ timeout: 15_000 });
    await countdownSwitch.click();
    await expect(countdownSwitch).toHaveAttribute('aria-checked', 'false');

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();

    // With the countdown off, capture begins at once: the Stop control must
    // appear well inside the 3.2s the countdown would have consumed, and the
    // countdown overlay never shows.
    await expect(page.getByRole('button', { name: 'Cancel countdown' })).toHaveCount(0);
    await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toBeVisible({ timeout: 2500 });
    await expect(page.getByRole('status').getByText('REC', { exact: true })).toBeVisible({ timeout: 10_000 });

    await stopRecording(page);
    await expectReview(page);
  });
});

test.describe('capture dimension badge (FC-1.0 item 3)', () => {
  test('shows the configured target before capture, actual dimensions after', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);

    // Before any capture: the configured dimensions, explicitly labelled as
    // a target — never claimed as a captured resolution.
    const target = page.getByText(/^Target \d+ × \d+$/);
    await expect(target, 'pre-capture badge must label configuration as target').toBeVisible({ timeout: 15_000 });

    // Camera live: the badge switches to the ACTUAL track dimensions.
    await studioReady(page);
    await expect(target, 'once capturing, the target label must disappear').toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByText(/^\d+ × \d+$/).first(), 'actual W × H is displayed').toBeVisible({ timeout: 15_000 });
  });
});

test.describe('review audio path (FC-1.0 item 4)', () => {
  test('review playback starts audible and the sound control flips playback mute', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await recordTake(page, 4);
    await expectReview(page);

    const video = page.locator('main video');
    const toggle = page.getByRole('button', { name: /^(Mute|Unmute) review playback$/ });
    await expect(toggle, 'a take with audio must expose a review sound control').toBeVisible({ timeout: 15_000 });

    // Autoplay policy is relaxed for this suite, so playback starts AUDIBLE
    // (if policy blocked it, the control would simply start in "Unmute").
    expect(await video.evaluate((v) => (v as HTMLVideoElement).muted)).toBe(false);

    await toggle.click();
    await expect(page.getByRole('button', { name: 'Unmute review playback' })).toBeVisible();
    expect(await video.evaluate((v) => (v as HTMLVideoElement).muted), 'mute flips playback').toBe(true);

    await page.getByRole('button', { name: 'Unmute review playback' }).click();
    await expect(page.getByRole('button', { name: 'Mute review playback' })).toBeVisible();
    expect(await video.evaluate((v) => (v as HTMLVideoElement).muted), 'and back to audible').toBe(false);
  });
});

test.describe('script-end auto-stop (FC-1.0 DC-2)', () => {
  test('reaching the end of the script stops the take and says so', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    // A short script already "ends" — the end-check stops the take without
    // any user action, and that stop is the one that announces itself.
    await page.getByLabel('Script Editor').fill('Script end announcement test.');

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });

    await expect(
      page.getByRole('status').getByText('Script ended — recording stopped'),
      'the teleprompter end-stop must announce itself with the FC copy',
    ).toBeVisible({ timeout: 20_000 });

    // The auto-stop produced a real take.
    await expectReview(page);
    expect(await readMasterRecordings(page)).toHaveLength(1);
  });
});
