/**
 * CR-001: TransportBar must remain accessible when switching panels during recording.
 *
 * Regression test for the fix: TransportBar visibility condition changed from
 * `isStudio` to `(isStudio || recorder.recordingState !== 'idle')` to ensure
 * recording controls are always accessible during an active recording, even
 * when the user switches to the Library panel.
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
  readMasterRecordings,
  newVideoButton,
  recordingsNav,
  grantMediaPermissions,
} from './helpers';
import type { Page } from '@playwright/test';

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

// This file drives the recorder through fake Chromium media devices.
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

/**
 * CR-001: TransportBar remains visible and functional when switching from
 * Studio to Library panel during an active recording.
 */
test('TransportBar remains accessible when switching panels during recording', async ({ page }) => {
  await page.goto('/studio');
  await dismissWelcomeModal(page);

  // Ensure we start with no recordings
  await expect(readMasterRecordings(page)).resolves.toHaveLength(0);

  // Start a recording and leave it RUNNING. recordTake() records AND stops, so
  // it cannot be used here: this scenario needs the recorder still active while
  // the panel changes.
  await studioReady(page);
  await transport(page).getByRole('button', { name: 'Start Recording' }).click({ timeout: 20_000 });
  await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });

  // Switch to Library panel while recording is active
  await recordingsNav(page).click();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible({ timeout: 30_000 });

  // CR-001: TransportBar MUST still be visible in Library panel during recording
  await expect(transport(page)).toBeVisible({ timeout: 10_000 });
  await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toBeVisible({ timeout: 10_000 });

  // Verify recording is still active (timer is running)
  const timerBefore = await transport(page).getByText(/\d{2}:\d{2}/).first().textContent();
  await page.waitForTimeout(2000);
  const timerAfter = await transport(page).getByText(/\d{2}:\d{2}/).first().textContent();
  expect(timerAfter).not.toBe(timerBefore);

  // Stop the recording from Library panel. The transport stop is the two-step
  // confirm (click, 200ms, click again) — same as helpers.stopRecording().
  const stopFromLibrary = transport(page).getByRole('button', { name: 'Stop Recording' });
  await stopFromLibrary.click();
  await page.waitForTimeout(250);
  await transport(page).getByRole('button', { name: 'Stop Recording' }).click();
  await stopFromLibrary.waitFor({ state: 'detached', timeout: 30_000 });

  // Verify recording stopped and finalized correctly
  await expectReview(page);

  // Verify we can still see the completed recording
  await expect(page.getByText('Recording stopped')).toBeVisible({ timeout: 10_000 });
});

/**
 * TransportBar should NOT be visible in Library panel when idle (no active recording).
 */
test('TransportBar hidden in Library panel when idle', async ({ page }) => {
  await page.goto('/studio');
  await dismissWelcomeModal(page);

  // Switch to Library panel when idle
  await recordingsNav(page).click();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible({ timeout: 30_000 });

  // TransportBar should NOT be visible when idle in Library panel
  await expect(transport(page)).not.toBeVisible({ timeout: 5_000 });
});

test('a take stopped from the Library panel appears in the list without leaving the tab', async ({ page }) => {
  await page.goto('/studio');
  await dismissWelcomeModal(page);
  await studioReady(page);

  const count = async () => {
    const text = await page.locator('main').innerText();
    const m = text.match(/(\d+)\s+recordings?/);
    return m ? Number(m[1]) : 0;
  };

  await recordTake(page, 4);
  // Baseline from IndexedDB, not the DOM: the Library panel has not been opened
  // yet, so its rendered count is not a reliable starting point.
  const afterStudioStop = (await readMasterRecordings(page)).length;
  expect(afterStudioStop, 'the first take must be persisted').toBe(1);

  // Second take, stopped from the Library panel while the tab stays mounted.
  await newVideoButton(page).click();
  await studioReady(page);
  await transport(page).getByRole('button', { name: 'Start Recording' }).click({ timeout: 20_000 });
  await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);

  await recordingsNav(page).click();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible({ timeout: 30_000 });

  await transport(page).getByRole('button', { name: 'Stop Recording' }).click();
  const stopBtn = transport(page).getByRole('button', { name: 'Stop Recording' });
  await page.waitForTimeout(250);
  await transport(page).getByRole('button', { name: 'Stop Recording' }).click();
  await stopBtn.waitFor({ state: 'detached', timeout: 30_000 });

  // The take is on disk. Polled, not read instantly: persisting the take is
  // async with respect to the stop button detaching.
  await expect
    .poll(async () => (await readMasterRecordings(page)).length, {
      message: 'the stopped take must be persisted',
      timeout: 20_000,
    })
    .toBe(afterStudioStop + 1);

  // ...and the visible list must show it WITHOUT navigating away and back.
  await expect
    .poll(() => count(), { message: 'the Library list must show the new take without leaving the tab', timeout: 10_000 })
    .toBe(afterStudioStop + 1);

  const stillHere = await page.getByRole('heading', { name: 'Recordings' }).isVisible();
  expect(stillHere, 'the assertion must hold while still on the Library tab').toBe(true);
});

/**
 * TransportBar returns to Studio panel after stopping from Library.
 */
test('TransportBar visible in Studio after stopping from Library', async ({ page }) => {
  await page.goto('/studio');
  await dismissWelcomeModal(page);

  // Start a recording and leave it RUNNING — this scenario needs the recorder
  // active while the panel changes, so recordTake() (which stops) cannot be used.
  await studioReady(page);
  await transport(page).getByRole('button', { name: 'Start Recording' }).click({ timeout: 20_000 });
  await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ timeout: 30_000 });

  // Switch to Library panel
  await recordingsNav(page).click();
  await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible({ timeout: 30_000 });

  // Stop from Library panel (two-step confirm, per helpers.stopRecording())
  const stopInLibrary = transport(page).getByRole('button', { name: 'Stop Recording' });
  await stopInLibrary.click();
  await page.waitForTimeout(250);
  await transport(page).getByRole('button', { name: 'Stop Recording' }).click();
  await stopInLibrary.waitFor({ state: 'detached', timeout: 30_000 });

  // Return to Studio panel. BottomNav (and therefore compactStudioTab) is
  // `xl:hidden`, so at the 1440px viewport used here the Studio button lives in
  // the main navigation rail.
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Studio' }).click({ timeout: 15_000 });

  // TransportBar should be visible in Studio panel with completed recording
  await expect(transport(page)).toBeVisible({ timeout: 10_000 });
  // After stop, Stop is gone and the finished take owns the next action:
  // review offers Retake (non-destructive) rather than a second central Record.
  await expect(transport(page).getByRole('button', { name: 'Stop Recording' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retake', exact: true })).toBeVisible({ timeout: 10_000 });
});
