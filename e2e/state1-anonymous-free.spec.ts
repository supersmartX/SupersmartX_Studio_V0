/* STATE 1 — Anonymous Free: full state-machine walk.
 *
 * No session, no account, no R2. Every assertion here must hold for a user who
 * has never signed in, on a machine with no cloud storage configured.
 *
 * R2 is not merely "not configured" here — every R2/cloud/export-job endpoint
 * is actively ABORTED at the network layer, so a pass proves the local export
 * path is genuinely independent rather than accidentally reaching a bucket.
 */
import { readFile, stat } from 'node:fs/promises';
import {
  test,
  expect,
  instrument,
  blockCloud,
  transport,
  switcher,
  studioReady,
  stopRecording,
  pauseRecording,
  resumeRecording,
  recordTake,
  expectReview,
  readVideo,
  readTimer,
  trackState,
  readLocalExports,
  readMasterRecordings,
  LOCKED_PLATFORMS,
  grantMediaPermissions,
} from './helpers';
import { readMp4Artifact } from '../src/lib/export/mp4-metadata';

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

test.beforeEach(async ({ context, browserName }) => {
  await grantMediaPermissions(context, browserName);
});

// Every test here calls studioReady(), which only returns once a real camera
// is acquired; Playwright's Firefox cannot supply the fake device that needs.
test.skip(({ browserName }) => browserName !== 'chromium', 'requires fake media devices');

test.setTimeout(300_000);

test.describe('STATE 1 — Anonymous Free', () => {
  test('1.1 /studio opens without login', async ({ page }) => {
    await instrument(page);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });

    // No redirect to /, no sign-in wall: we are still on /studio.
    expect(new URL(page.url()).pathname).toBe('/studio');
    await expect(page.getByRole('main')).toBeVisible();

    // The session endpoint is reachable and reports an anonymous identity.
    const session = await page.request.get('/api/auth/session');
    expect(session.status()).toBe(200);
    expect((await session.json()) ?? {}).toEqual({});

    // The UI offers sign-in but never requires it.
    await studioReady(page);
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'User menu' })).toHaveCount(0);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
  });

  test('1.2 camera and microphone permission work', async ({ page }) => {
    
    await instrument(page);
    await page.goto('/studio');
    await studioReady(page);

    const granted = await page.evaluate(async () => {
      const [cam, mic] = await Promise.all([
        navigator.permissions.query({ name: 'camera' as PermissionName }),
        navigator.permissions.query({ name: 'microphone' as PermissionName }),
      ]);
      return { camera: cam.state, microphone: mic.state };
    });
    expect(granted.camera, 'camera permission must be granted for an anonymous take').toBe('granted');
    expect(granted.microphone, 'microphone permission must be granted for an anonymous take').toBe('granted');

    // A live stream exists and BOTH tracks are running (not just a video stub).
    const live = await page.evaluate(() => {
      const streams = (window as unknown as { __ssxStreams: MediaStream[] }).__ssxStreams;
      return streams.map((s) => ({
        video: s.getVideoTracks().map((t) => ({ state: t.readyState, label: t.label })),
        audio: s.getAudioTracks().map((t) => ({ state: t.readyState, label: t.label })),
      }));
    });
    expect(live.length, 'getUserMedia must have been called').toBeGreaterThan(0);
    const active = live.filter((s) => s.video.some((t) => t.state === 'live') && s.audio.some((t) => t.state === 'live'));
    expect(active.length, 'a stream with a live video AND audio track is required').toBeGreaterThan(0);

    // Muting only toggles the audio track; the camera stays live.
    await expect(transport(page).getByRole('button', { name: 'Mute microphone' })).toBeVisible();
    await transport(page).getByRole('button', { name: 'Mute microphone' }).click();
    await expect(transport(page).getByRole('button', { name: 'Unmute microphone' })).toBeVisible();
    const afterMute = await page.evaluate(() => {
      const streams = (window as unknown as { __ssxStreams: MediaStream[] }).__ssxStreams;
      const liveStream = streams[streams.length - 1];
      return {
        audioEnabled: liveStream.getAudioTracks().map((t) => t.enabled),
        videoLive: liveStream.getVideoTracks().map((t) => t.readyState),
      };
    });
    expect(afterMute.audioEnabled.every((e) => e === false), 'mute must disable the audio track').toBe(true);
    expect(afterMute.videoLive.every((s) => s === 'live'), 'mute must not touch the camera track').toBe(true);
  });

  test('1.3 script and teleprompter work', async ({ page }) => {
    
    await instrument(page);
    await page.goto('/studio');
    await studioReady(page);

    const script = 'Welcome to SupersmartX Studio. This is the anonymous free take.';
    const editor = page.getByLabel('Script Editor');
    await expect(editor).toBeVisible();
    await editor.fill(script);
    await expect(editor).toHaveValue(script);
    await expect(page.getByText(`${script.split(/\s+/).length} words`)).toBeVisible();

    // The script survives a reload (local, no account).
    await page.reload();
    await studioReady(page);
    await expect(page.getByLabel('Script Editor')).toHaveValue(script);

    // Teleprompter is live on the canvas, and it scrolls while recording.
    const prompter = page.getByLabel('Teleprompter script');
    await expect(prompter).toBeVisible();
    await expect(prompter).toContainText('Welcome to SupersmartX Studio');

    // The scroll container is the labelled wrapper's own child, not the wrapper
    // (the wrapper is overflow-hidden and never scrolls).
    const scroller = prompter.locator('> div');
    const scrollable = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight);
    expect(scrollable, 'teleprompter must be scrollable before a take').toBe(true);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    await expect(scroller).toBeVisible();
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 15_000, message: 'teleprompter must auto-scroll during a take' })
      .toBeGreaterThan(0);

    // Pausing holds the prompter; resuming restarts it.
    await pauseRecording(page);
    const heldAt = await scroller.evaluate((el) => el.scrollTop);
    await page.waitForTimeout(2000);
    expect(await scroller.evaluate((el) => el.scrollTop), 'teleprompter must hold while paused').toBe(heldAt);
    await resumeRecording(page);
    await expect
      .poll(() => scroller.evaluate((el) => el.scrollTop), { timeout: 15_000, message: 'teleprompter must scroll again after resume' })
      .toBeGreaterThan(heldAt);

    await stopRecording(page);
    await expectReview(page);
  });

  test('1.4 record, pause, resume, stop; camera stops; review appears', async ({ page }) => {
    
    await instrument(page);
    await page.goto('/studio');
    await studioReady(page);

    // RECORD
    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    // Capture started the moment Stop appeared (the countdown is over and is
    // itself never recorded) — this is the wall-clock reference the paused
    // seconds must be excluded from.
    const captureStart = Date.now();
    await expect(page.getByRole('status').getByText('REC', { exact: true })).toBeVisible();
    await page.waitForTimeout(2500);
    expect(await readTimer(page), 'recording timer must advance').not.toBe('00:00');

    // PAUSE
    await pauseRecording(page);
    await expect(transport(page).getByRole('button', { name: 'Resume Recording' })).toBeVisible();

    // A paused take must not keep burning the clock.
    const atPause = await readTimer(page);
    await page.waitForTimeout(2500);
    expect(await readTimer(page), 'timer must hold while paused').toBe(atPause);

    // RESUME
    await resumeRecording(page);
    await page.waitForTimeout(2500);
    expect(await readTimer(page), 'timer must resume after resume').not.toBe(atPause);

    // STOP
    await page.waitForTimeout(1500);
    await stopRecording(page);

    // REVIEW
    await expectReview(page);
    await expect(page.getByText('YouTube', { exact: true })).toBeVisible();
    const review = await readVideo(page.locator('main video'));
    expect(review.w, 'review video must have decoded real dimensions').toBeGreaterThan(0);
    expect(review.h).toBeGreaterThan(0);
    expect(review.duration, 'review video must have a real duration').toBeGreaterThan(0);

    // PAUSE-AWARE ACCOUNTING (Phase 1 item 1): the take above captured
    // ~7s of media behind a 2.5s pause. The Free daily budget must be
    // charged ACTIVE time only — wall-clock billing would make the charged
    // figure track the total elapsed time instead. `charged` was 0 before
    // this take (fresh context), so it is exactly this take's charge.
    const charged = Number(await page.evaluate(() => localStorage.getItem('sxs-record-secs') ?? '0'));
    const wallSecs = (Date.now() - captureStart) / 1000;
    expect(charged, 'the take must be charged for what it actually recorded').toBeGreaterThanOrEqual(5);
    expect(
      wallSecs - charged,
      `charge must exclude the paused time (wall ${wallSecs.toFixed(1)}s, charged ${charged}s)`,
    ).toBeGreaterThanOrEqual(2);
    // The reviewed asset's media duration agrees with the charged figure —
    // both describe active capture, not paused wall time. (Read from the
    // stored row: Chromium reports `duration: Infinity` for MediaRecorder
    // webm blobs, which is precisely why the completion probe falls back to
    // the recorder's active-clock figure.)
    const storedRows = await readMasterRecordings(page);
    expect(storedRows).toHaveLength(1);
    expect(
      Math.abs(storedRows[0].duration - charged),
      `stored duration ${storedRows[0].duration}s ≈ charged ${charged}s`,
    ).toBeLessThanOrEqual(1.5);

    // CAMERA ACTUALLY STOPS — every track the app acquired must be ended.
    // (Also proves tracks really were acquired: a vacuous "0 live" is a bug.)
    const tracks = await trackState(page);
    expect(tracks.total, 'the take must have acquired real camera/mic tracks').toBeGreaterThan(0);
    await expect
      .poll(() => trackState(page), { timeout: 15_000, message: 'camera/mic must be released on stop (OS indicator off)' })
      .toEqual({ total: tracks.total, live: 0 });
  });

  test('1.5 recording survives refresh; master video remains available', async ({ page }) => {
    
    await instrument(page);
    await page.goto('/studio');
    await recordTake(page);

    await page.reload();
    await studioReady(page);

    // The take is durable locally, with no account involved.
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Recordings' }).click();
    await expect(page.getByRole('heading', { name: 'Recordings' })).toBeVisible();
    await expect(page.getByText('1 recording', { exact: false }).first()).toBeVisible({ timeout: 20_000 });

    // The master blob is intact: it previews with decoded dimensions.
    await page.getByRole('button', { name: /^Preview video$/ }).first().click();
    const preview = page.getByRole('dialog', { name: 'Existing video' });
    await expect(preview).toBeVisible();
    const meta = await readVideo(preview.locator('video'));
    expect(meta.w, 'master video must still decode after refresh').toBeGreaterThan(0);
    expect(meta.h).toBeGreaterThan(0);
    expect(meta.duration).toBeGreaterThan(0);
    await preview.getByRole('button', { name: 'Close' }).click();

    // The master video is still exportable after the reload.
    await page.getByRole('button', { name: /^Export video$/ }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('16:9 · 1280 × 720')).toBeVisible();
  });

  test('1.6 free export: YouTube 16:9 1280x720, watermark, local download, no R2, no login', async ({ page }) => {
    
    await instrument(page);
    const cloudAttempts = await blockCloud(page);

    await page.goto('/studio');
    await recordTake(page);
    await expectReview(page);

    // Anonymous Free sees exactly one format, and it is YouTube 16:9 720p.
    expect(
      await switcher(page).locator('button[title$="Creator plan required"]').count(),
      'every non-16:9 format is Creator-locked for anonymous',
    ).toBe(LOCKED_PLATFORMS.length);

    await page.getByRole('button', { name: 'Export recording' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByText('Export as guest — YouTube 16:9 included')).toBeVisible();
    await expect(dialog.getByText('16:9 · 1280 × 720')).toBeVisible();

    const exportButton = dialog.getByRole('button', { name: /^Export YouTube · 1280×720$/ });
    await expect(exportButton).toBeVisible();

    // Export
    await exportButton.click();
    await expect(dialog.getByRole('heading', { name: 'Exporting...' })).toBeVisible({ timeout: 20_000 });
    await expect(dialog.getByRole('heading', { name: 'Video exported' })).toBeVisible({ timeout: 180_000 });

    // The composition is stated exactly as downloaded.
    await expect(dialog.getByText('YouTube · 1280 × 720 · HD')).toBeVisible();

    // WATERMARK — proven by the actual canvas draws during the encode.
    const watermarkDraws = await page.evaluate(
      () => (window as unknown as { __ssxCanvasText: string[] }).__ssxCanvasText.filter((t) => t === 'SupersmartX').length,
    );
    expect(watermarkDraws, 'Free exports must burn the SupersmartX watermark into the frames').toBeGreaterThan(0);

    // No sign-in was ever requested.
    await expect(page.getByRole('dialog', { name: /Create New Profile|Log in or create account|Enter your email/ })).toHaveCount(0);

    // LOCAL DOWNLOAD — from the blob, with no server round-trip.
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 });
    await dialog.getByRole('button', { name: 'Download Video' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^supersmartx-recording-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.mp4$/);

    const filePath = await download.path();
    expect(filePath, 'downloaded file must exist on disk').toBeTruthy();
    const { size } = await stat(filePath!);
    expect(size, 'downloaded file must not be empty').toBeGreaterThan(1000);

    // Still no sign-in prompt after the download.
    await expect(page.getByRole('dialog', { name: /Create New Profile|Log in or create account|Enter your email/ })).toHaveCount(0);

    // NO R2 — the export landed in the local store, and the cloud surface was
    // never touched (it was hard-blocked for the whole test).
    const locals = await readLocalExports(page);
    expect(locals, 'Free export must be persisted locally').toHaveLength(1);
    expect(locals[0].platform).toBe('youtube-landscape');
    expect(locals[0].outputWidth).toBe(1280);
    expect(locals[0].outputHeight).toBe(720);
    expect(locals[0].fileSize).toBeGreaterThan(1000);

    // PHASE 3 — the downloaded bytes are parsed HERE in Node with the SAME
    // production parser the server verifies with, and must agree with the
    // record the local store just claimed: a real ISO-BMFF container (ftyp
    // first), moov and mdat present, a video sample entry, the exact frame
    // the store records, and a positive-finite container duration.
    const fileBytes = new Uint8Array(await readFile(filePath!));
    const artifact = readMp4Artifact(fileBytes.buffer as ArrayBuffer);
    expect(artifact, 'the downloaded export must be a parseable MP4').not.toBeNull();
    expect(artifact?.hasFtyp, 'ftyp must be the first box').toBe(true);
    expect(artifact?.hasMoov).toBe(true);
    expect(artifact?.hasMdat).toBe(true);
    expect(artifact?.videoTrackCount).toBeGreaterThanOrEqual(1);
    expect({ width: artifact?.width, height: artifact?.height }).toEqual({
      width: locals[0].outputWidth,
      height: locals[0].outputHeight,
    });
    expect(artifact?.durationSeconds ?? 0, 'container duration must be positive').toBeGreaterThan(0);
    expect(Number.isFinite(artifact?.durationSeconds), 'container duration must be finite').toBe(true);
    expect(fileBytes.byteLength, 'byte count must match the store\u2019s claim').toBe(locals[0].fileSize);
    expect(cloudAttempts, `anonymous Free must never reach the cloud: ${cloudAttempts.join(', ')}`).toEqual([]);
  });
});
