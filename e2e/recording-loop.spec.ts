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

/**
 * UX-002 (visible half) — the Stop -> Confirm arm window.
 *
 * The accessible name has been stable ("Stop Recording") since the earlier
 * remediation and is protected by helpers.stopRecording(), which re-queries that
 * name across the transition. What had NO coverage at all was the visible label:
 * the audit's finding was that the swap happened at 10px and "can be missed",
 * and nothing asserted it.
 *
 * The labelled control is the SECONDARY stop button, which only exists while
 * PAUSED (TransportBar renders the primary circle while recording). So each test
 * records, pauses, and then drives the arm window on that control.
 *
 * Legibility is asserted as a COMPUTED font size, not a class name — this reads
 * what the browser actually renders, so a class rename or a cascade change
 * cannot make it pass.
 */
test.describe('stop arm window — visible Confirm label (UX-002)', () => {
  // Same shape the shared helper uses to find the pause control
  // (e2e/helpers.ts PAUSE_ICON) rather than an invented icon class.
  const PAUSE_ICON = 'path[d^="M10 9v6m4-6v6"]';

  /** Records, then pauses so the secondary labelled stop control appears. */
  async function recordThenPause(page: import('@playwright/test').Page) {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await transport(page).locator(`button:has(${PAUSE_ICON})`).click();
    await transport(page).getByRole('button', { name: 'Resume Recording' }).waitFor({ timeout: 15_000 });
  }

  test('the Stop label is legible and keeps the stable accessible name', async ({ page }) => {
    await recordThenPause(page);

    const stop = transport(page).getByRole('button', { name: 'Stop Recording' });
    await expect(stop, 'the paused stop control must be reachable by its stable name').toBeVisible();

    // Rendered size, not a class string.
    const size = await stop.locator('span').first().evaluate((el) => getComputedStyle(el).fontSize);
    expect(
      parseFloat(size),
      'the visible Stop label must be legible (>=12px); 10px was the audited defect',
    ).toBeGreaterThanOrEqual(12);
    await expect(stop, 'and it must actually say Stop').toContainText('Stop');
  });

  test('arming shows Confirm, keeps the same accessible name, and disarms after 3s', async ({ page }) => {
    await recordThenPause(page);

    const stop = transport(page).getByRole('button', { name: 'Stop Recording' });
    await stop.click();

    // Armed: the visible word changes...
    await expect(stop, 'arming must visibly say Confirm').toContainText('Confirm');
    // ...while the accessible name does NOT.
    await expect(
      transport(page).getByRole('button', { name: 'Stop Recording' }),
      'the accessible name must stay "Stop Recording" through the arm transition',
    ).toBeVisible();
    expect(
      await transport(page).getByRole('button', { name: 'Stop Recording' }).count(),
      'exactly one control carries the stable name',
    ).toBe(1);

    const confirmSize = await stop.locator('span').first().evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(confirmSize), 'the Confirm label must be legible too').toBeGreaterThanOrEqual(12);

    // The 3s arm window still self-disarms — the interaction is unchanged.
    await expect(stop, 'the arm window must expire back to Stop').toContainText('Stop', { timeout: 8000 });
    expect(await readMasterRecordings(page), 'an expired arm window must not stop the take').toHaveLength(0);
  });

  test('confirming after arming actually stops the take', async ({ page }) => {
    await recordThenPause(page);

    const stop = transport(page).getByRole('button', { name: 'Stop Recording' });
    await stop.click();
    await expect(stop).toContainText('Confirm');
    await stop.click();

    await expectReview(page);
    expect(await readMasterRecordings(page), 'a confirmed stop must produce exactly one take').toHaveLength(1);
  });

  test('the transport keeps its height and does not overflow at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await recordThenPause(page);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `the transport must not overflow at 375px (overflowX=${overflow})`).toBe(0);

    // The bar itself must not grow to accommodate the larger label.
    const barHeight = await transport(page).evaluate((el) => el.getBoundingClientRect().height);
    expect(barHeight, 'the transport height must be unchanged').toBeLessThanOrEqual(64);
  });
});

/**
 * Controls auto-hide vs keyboard focus (WCAG 2.1.1 / 2.4.7).
 *
 * The export player's control bar hides itself 3s after the pointer stops moving.
 * That must never leave keyboard focus sitting on an invisible control, and it
 * must not strand the bar on screen once focus leaves.
 *
 * Regression history: an earlier implementation satisfied the first half - it
 * held the bar open while focused - by cancelling the hide timer on focus. That
 * version hid correctly while focused but then never hid again after focus left,
 * so the mouse experience was silently broken. A retention-only assertion passes
 * that version. Both halves are therefore asserted here, and "stays hidden" is
 * checked twice, so the stale-state regression cannot come back.
 */
test.describe('player controls auto-hide vs keyboard focus', () => {
  /** The overlay that carries the opacity transition is the seek slider's
   *  positioned ancestor. Asserted on computed style, never on a class string. */
  const controlsOpacity = (page: import('@playwright/test').Page) =>
    page.evaluate(() => {
      const slider = document.querySelector('[role="slider"][aria-label="Seek"]');
      const overlay = slider?.closest('div.absolute');
      return overlay ? getComputedStyle(overlay).opacity : null;
    });

  test('controls stay visible while the seek slider holds focus, then auto-hide resumes when focus leaves', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    // record -> stop -> review, using the file's established helpers.
    await recordTake(page);
    await expectReview(page);

    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog, 'the export dialog must open').toBeVisible({ timeout: 20_000 });

    const slider = page.getByRole('slider', { name: 'Seek' });
    await expect(slider, 'the seek bar must be exposed as a named slider').toBeVisible({ timeout: 20_000 });

    // Park the pointer away from the player so no mouse movement can re-show the
    // bar and mask a focus-driven failure.
    await page.mouse.move(20, 20);

    // Baseline: the bar auto-hides, because the pointer is not over the player.
    await expect
      .poll(() => controlsOpacity(page), { message: 'the bar must start hidden with no pointer over it', timeout: 10_000 })
      .toBe('0');

    // Focus enters the controls by real keyboard navigation. Programmatic
    // .focus() would NOT set :focus-visible in Chromium, so the focus indicator
    // under test could never appear - and a keyboard user is the case that
    // matters here anyway.
    let tabbed = 0;
    for (; tabbed < 60; tabbed += 1) {
      await page.keyboard.press('Tab');
      if (await slider.evaluate((el) => document.activeElement === el)) break;
    }
    expect(tabbed, 'the seek slider must be reachable by keyboard (WCAG 2.1.1)').toBeLessThan(60);

    // The bar must become visible WITHOUT any mouse movement - this is the
    // tab-into-an-initially-hidden-overlay path.
    await expect
      .poll(() => controlsOpacity(page), { message: 'focus entering the controls must reveal them', timeout: 10_000 })
      .toBe('1');

    // Hold focus well past the 3s auto-hide. The wait is deliberate: the timer
    // firing is the behaviour under test, so we must outlast it. Uses the real
    // 3s window rather than assuming it.
    await page.waitForTimeout(4_000);
    expect(
      await controlsOpacity(page),
      'a focused control must stay visible beyond the 3s auto-hide, with a perceivable focus indicator',
    ).toBe('1');
    expect(
      await slider.evaluate((el) => el.matches(':focus-visible')),
      'the focused slider must still carry a visible focus indicator after 4s',
    ).toBe(true);

    // Focus genuinely leaves the controls (a button outside the overlay).
    await page.getByRole('button', { name: 'Close' }).evaluate((el: HTMLElement) => el.focus());

    // The mouse-driven auto-hide must resume.
    await expect
      .poll(() => controlsOpacity(page), { message: 'auto-hide must resume once focus leaves the controls', timeout: 10_000 })
      .toBe('0');

    // And must STAY hidden. A one-shot poll cannot catch a bar that hides and
    // then immediately re-appears; this second check closes that gap.
    await page.waitForTimeout(2_000);
    expect(
      await controlsOpacity(page),
      'the controls must remain hidden after focus leaves (no stale focus state)',
    ).toBe('0');
  });
});
