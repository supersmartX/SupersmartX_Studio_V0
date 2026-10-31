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

    // The pending countdown offers an explicit Cancel immediately, and the
    // first beat is already visible (the old UI spent 800ms on a blank frame).
    const cancel = page.getByRole('button', { name: 'Cancel countdown' });
    await expect(cancel).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('countdown-value')).toHaveText('3', { timeout: 600 });
    await cancel.click();

    // Clean non-recording state: no phantom Stop, no overlay, camera kept
    // (Start can simply be pressed again).
    await expect(transport(page).getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 10_000 });
    await expect(cancel).toHaveCount(0);
    await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toHaveCount(0);
    // Cancelling a countdown is not a stopped take: the live region must not
    // tell a screen-reader user that a recording is ready to review.
    await expect(page.getByText('Countdown cancelled.')).toHaveCount(1);
    await expect(page.getByText(/recording is ready to review/i)).toHaveCount(0);

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

test.describe('no technical dimensions chrome (clean-canvas redesign)', () => {
  test('no dimensions read-out on the canvas; a take reports real geometry in the status line', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    // Before capture the canvas carries no dimensions at all — neither the
    // ACTUAL figure nor a "Target …" label. The clean creator canvas is not a
    // technical read-out.
    await expect(page.getByText(/^Target \d+ × \d+$/)).toHaveCount(0);
    await expect(page.getByText(/^\d+ × \d+$/)).toHaveCount(0);

    // During a take the REAL track geometry appears in the status line
    // (role=status, real MediaStreamTrack settings — never a configured
    // target), exactly where supporting information now belongs.
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    const stop = transport(page).getByRole('button', { name: 'Stop Recording' });
    await stop.waitFor({ timeout: 30_000 });

    const statusLine = page.getByRole('status').filter({ hasText: /\d+ × \d+/ });
    await expect(statusLine, 'actual W × H is displayed while capturing').toBeVisible({ timeout: 15_000 });
    await expect(statusLine).toContainText(/\d+ × \d+/);

    await stopRecording(page);
    await expectReview(page);
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
    // The end-stop is a real-time event (~20s at default prompter speed), so
    // this test needs more than the global 30s budget to reach it and still
    // have room for the assertion window.
    test.slow();
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    // A short script already "ends" — the end-check stops the take without
    // any user action, and that stop is the one that announces itself.
    await page.getByLabel('Script Editor').fill('Script end announcement test.');

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });

    // Measured against this app's real scroll: the script clears the visible
    // area at ~30px/s (default speed) after the 85% bottom pad has scrolled
    // through, which lands around 18-19s for a one-line script. A 20s window
    // left no headroom on a loaded CI box, so it failed on scheduling jitter
    // while the behavior itself was correct. The assertion is unchanged: the
    // take must still stop BY ITSELF and say so — only the time budget is real.
    await expect(
      page.getByRole('status').getByText('Script ended — recording stopped'),
      'the teleprompter end-stop must announce itself with the FC copy',
    ).toBeVisible({ timeout: 35_000 });

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

    // Scoped to the dialog: the review surface behind it also exposes a named
    // seek slider ("Seek playback position"), so an unscoped role lookup is
    // ambiguous. This test is about the export player's controls.
    const slider = dialog.getByRole('slider', { name: 'Seek', exact: true });
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

/**
 * Phase 4 review contract: Stop ends in a saved take the user can judge, not a
 * control puzzle. The two decisions that used to be implicit are made explicit
 * and asserted against real IndexedDB state:
 *   - Retake is NON-destructive (the current take stays in the library);
 *   - Delete is available for a fresh take and really removes it.
 */
test.describe('camera-off readiness (Phase 4)', () => {
  test('camera off blocks Start with an actionable way back on', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    const start = transport(page).getByRole('button', { name: 'Start Recording' });
    await transport(page).getByRole('button', { name: 'Turn off camera' }).click();

    await expect(page.getByRole('status', { name: 'Camera is off' })).toBeVisible();
    await expect(page.getByText('Turn your camera on to start recording.')).toBeVisible();
    await expect(start).toBeDisabled();

    await page.getByRole('button', { name: 'Turn camera back on' }).click();
    await expect(page.getByRole('status', { name: 'Camera is off' })).toHaveCount(0);
    await expect(start).toBeEnabled();
  });
});

test.describe('review decision contract (Phase 4)', () => {
  test('Retake after a camera-off take turns the camera back on', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await studioReady(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1_000);
    await transport(page).getByRole('button', { name: 'Turn off camera' }).click();
    await expect(page.getByRole('status', { name: 'Camera is off' })).toBeVisible();
    await stopRecording(page);
    await expectReview(page);

    // Retake is a new take, not a replay of the camera-off state. The live
    // camera chip is hidden in review, so retake must restore it itself.
    await page.getByRole('button', { name: 'Retake', exact: true }).click();
    await expect(page.getByText('Camera turned on for your retake.')).toBeVisible();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    await expect(page.getByRole('status', { name: 'Camera is off' })).toHaveCount(0);

    await page.waitForTimeout(1_000);
    await stopRecording(page);
    await expectReview(page);
  });

  test('review says the take is ready and Retake keeps it in the library', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    await recordTake(page, 2);
    await expectReview(page);

    await expect(page.getByText('Your recording is ready.')).toBeVisible();
    await expect(page.getByText('Saved in this browser')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete recording' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retake', exact: true })).toBeVisible();
    // Stop removes the focused Stop control; focus must land on the review
    // surface, not the document body, or keyboard users start over in the header.
    await expect
      .poll(() => page.locator('[data-review-tray]').evaluate((el) => el.contains(document.activeElement)))
      .toBe(true);
    // The accessible description, not just the 9px visual sub-label, explains
    // what happens to the finished take.
    await expect(page.locator('#review-retake-note')).toHaveText(/stays in your library/);

    // The live-device chips belong to preparing/recording. In review the camera
    // and mic are released, and the player owns playback sound; leaving these
    // here made the mic chip look like a playback mute.
    const bar = transport(page);
    await expect(bar.getByRole('button', { name: 'Mute microphone' })).toHaveCount(0);
    await expect(bar.getByRole('button', { name: 'Turn off camera' })).toHaveCount(0);

    const before = await readMasterRecordings(page);
    expect(before, 'a fresh take is persisted immediately').toHaveLength(1);

    await page.getByRole('button', { name: 'Retake', exact: true }).click();
    await expect(bar.getByRole('button', { name: 'Mute microphone' })).toBeVisible();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1_500);
    await stopRecording(page);
    await expectReview(page);

    await expect.poll(async () => (await readMasterRecordings(page)).length).toBe(2);
    const after = await readMasterRecordings(page);
    expect(after.map((r) => r.id)).toContain(before[0].id);
  });

  test('deleting a fresh take clears review and returns to a clean ready state', async ({ page }) => {
    await page.goto('/studio');
    await dismissWelcomeModal(page);
    // Long enough that a take still playing behind the confirmation would
    // still be playing when the assertion below looks at it.
    await recordTake(page, 4);
    await expectReview(page);

    expect(await readMasterRecordings(page)).toHaveLength(1);

    page.once('dialog', async (dialog) => {
      // The delete confirmation is a real dialog in the UI now, never a native
      // one; a native dialog here means the shared confirm was bypassed.
      await dialog.dismiss();
    });
    await page.getByRole('button', { name: 'Delete recording' }).click();

    // Deleting the only copy of the bytes asks first, in the shared alertdialog.
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText(/cannot be undone/i);
    // The take must not keep playing — audibly — behind the question about
    // whether to delete it.
    await expect
      .poll(() => page.locator('video').first().evaluate((v: HTMLVideoElement) => v.paused), { timeout: 2_000 })
      .toBe(true);
    // Cancel leaves the take, the review and the library row exactly as they were.
    await confirm.getByRole('button', { name: 'Keep recording' }).click();
    await expect(confirm).toHaveCount(0);
    await expect(page.getByText('Your recording is ready.')).toBeVisible();
    // Cancelling only interrupted the viewing: the take itself is untouched.
    await expect
      .poll(() => page.locator('video').first().evaluate((v: HTMLVideoElement) => v.paused), { timeout: 2_000 })
      .toBe(false);
    expect(await readMasterRecordings(page)).toHaveLength(1);

    await page.getByRole('button', { name: 'Delete recording' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete recording' }).click();

    // Back to the pre-record state, with no stale review actions or blob video.
    await expect(transport(page).getByRole('button', { name: 'Start Recording' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: 'Retake', exact: true })).toHaveCount(0);
    await expect(page.getByText('Your recording is ready.')).toHaveCount(0);
    await expect.poll(async () => (await readMasterRecordings(page)).length).toBe(0);
  });
});
