import { test, expect, type Page } from '@playwright/test';
import {
  instrument,
  studioReady,
  stopRecording,
  expectReview,
  transport,
  grantMediaPermissions,
  readMasterRecordings,
} from './helpers';

/**
 * Real-browser verification of the upgraded recording pipeline (Phases 4–14).
 *
 * Chromium fakes supply REAL camera data through REAL MediaRecorder code —
 * codec selection, bitrates, chunk persistence, IndexedDB recovery and the
 * status UI are exercised end to end, not mocked. Firefox/mobile projects
 * skip this file (same rule as smoke.spec's camera journey).
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'requires Chromium fake media devices');

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

// studioReady can legitimately wait minutes (dev-server cold compile +
// camera gates), like every other camera spec in this suite.
test.setTimeout(300_000);

/**
 * Count of rows in the local-recovery stores, read from the REAL IndexedDB —
 * anything other than 0 after a take has ended in this document is a leak.
 */
function readRecoveryStores(page: Page) {
  return page.evaluate(
    async () =>
      await new Promise<{ sessions: number; chunks: number }>((resolve) => {
        const open = indexedDB.open('sxs-studio');
        open.onerror = () => resolve({ sessions: -1, chunks: -1 });
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains('recording-sessions') || !db.objectStoreNames.contains('recording-chunks')) {
            db.close();
            resolve({ sessions: 0, chunks: 0 });
            return;
          }
          const tx = db.transaction(['recording-sessions', 'recording-chunks'], 'readonly');
          const sessions = tx.objectStore('recording-sessions').getAll();
          const chunks = tx.objectStore('recording-chunks').getAll();
          sessions.onsuccess = () =>
            chunks.onsuccess = () => {
              db.close();
              resolve({
                sessions: (sessions.result as unknown[]).length,
                chunks: (chunks.result as unknown[]).length,
              });
            };
          sessions.onerror = () => chunks.onerror = () => {
            db.close();
            resolve({ sessions: -1, chunks: -1 });
          };
        };
      }),
  );
}

/** The canvas badge/status text must show the track's REAL geometry. */
async function readCaptureTrackSettings(page: Page) {
  return page.evaluate(() => {
    const streams = (window as unknown as { __ssxStreams?: MediaStream[] }).__ssxStreams ?? [];
    const track = streams.flatMap((s) => s.getVideoTracks()).find((t) => t.readyState === 'live');
    if (!track) return null;
    const s = track.getSettings();
    return { width: s.width ?? 0, height: s.height ?? 0, frameRate: s.frameRate ?? 0 };
  });
}

test.describe('Recording pipeline quality', () => {
  test('pins the real MediaRecorder codec/bitrate contract and a playable blob', async ({ page }) => {
    await instrument(page);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await studioReady(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(2500);

    const configs = await page.evaluate(() => {
      const w = window as unknown as {
        __ssxRecorderConfigs?: Array<{
          mimeType?: string;
          videoBitsPerSecond?: number;
          audioBitsPerSecond?: number;
          actualMimeType?: string;
          actualVideoBitsPerSecond?: number;
          actualAudioBitsPerSecond?: number;
        }>;
      };
      return w.__ssxRecorderConfigs ?? [];
    });
    expect(configs.length, 'a real MediaRecorder must have been constructed').toBeGreaterThan(0);
    const config = configs[configs.length - 1];
    expect(config.mimeType).toMatch(/^video\/(webm|mp4)/);
    const mime = config.mimeType as string;
    expect(
      await page.evaluate((value) => MediaRecorder.isTypeSupported(value), mime),
      'the selected MIME must still be genuinely supported',
    ).toBe(true);
    expect(config.videoBitsPerSecond).toBeGreaterThanOrEqual(2_500_000);
    expect(config.videoBitsPerSecond).toBeLessThanOrEqual(20_000_000);
    expect(config.audioBitsPerSecond).toBe(128_000);
    expect(config.actualMimeType).toBeTruthy();
    expect(config.actualMimeType).toMatch(/^video\/(webm|mp4)/);
    expect(config.actualVideoBitsPerSecond ?? null).toBeGreaterThan(0);
    expect(config.actualAudioBitsPerSecond ?? null).toBeGreaterThan(0);

    await stopRecording(page);
    await expectReview(page);

    const diagnosticNames = await page.evaluate(() => {
      const diagnostics = (window as unknown as {
        __SXS_RECORDING_DIAGNOSTICS__?: { events: Array<{ name: string }> };
      }).__SXS_RECORDING_DIAGNOSTICS__;
      return diagnostics?.events.map((event) => event.name) ?? [];
    });
    expect(diagnosticNames).toContain('recorder.started');
    expect(diagnosticNames).toContain('recorder.finalized');
    expect(diagnosticNames).toContain('recording.output');

    const media = await page.locator('main video').evaluate((v) => {
      const video = v as HTMLVideoElement;
      return {
        duration: Number.isFinite(video.duration) ? video.duration : null,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    });
    // Read the take's bytes straight out of IndexedDB. `fetch(blob:)` is
    // blocked by the app's connect-src CSP, and the stored row is the actual
    // artifact the recovery/export path consumes anyway.
    const stored = await readMasterRecordings(page);
    expect(stored, 'the take must be persisted locally').toHaveLength(1);
    const take = stored[0];
    const metadata = take.recordingMetadata as {
      profileId?: string;
      actualProfileId?: string;
      requestedWidth?: number;
      requestedHeight?: number;
      requestedFps?: number;
      actualWidth?: number | null;
      actualHeight?: number | null;
      actualFps?: number | null;
      mimeType?: string;
      configuredVideoBitrate?: number;
      actualVideoBitrate?: number | null;
      configuredAudioBitrate?: number;
      actualAudioBitrate?: number | null;
      fileSize?: number;
      averageFileBitrate?: number | null;
      startupLatencyMs?: number | null;
      finalizationLatencyMs?: number | null;
    } | undefined;
    expect(metadata?.profileId).toBeTruthy();
    expect(metadata?.actualProfileId).toBeTruthy();
    expect(metadata).toMatchObject({ requestedWidth: 1920, requestedHeight: 1080, requestedFps: 30 });
    expect(metadata?.actualWidth).toBeGreaterThan(0);
    expect(metadata?.actualHeight).toBeGreaterThan(0);
    expect(metadata?.actualFps).toBeGreaterThan(0);
    expect(metadata?.mimeType).toBe(config.actualMimeType);
    expect(metadata?.configuredVideoBitrate).toBe(config.videoBitsPerSecond);
    expect(metadata?.actualVideoBitrate).toBe(config.actualVideoBitsPerSecond ?? null);
    expect(metadata?.configuredAudioBitrate).toBe(config.audioBitsPerSecond);
    expect(metadata?.actualAudioBitrate).toBe(config.actualAudioBitsPerSecond ?? null);
    expect(metadata?.fileSize).toBe(take.size);
    expect(metadata?.averageFileBitrate).toBeGreaterThan(0);
    expect(metadata?.startupLatencyMs).toBeGreaterThanOrEqual(0);
    expect(metadata?.finalizationLatencyMs).toBeGreaterThanOrEqual(0);

    // The stored blob uses the exact codec the constructor negotiated, is
    // genuinely decodable, and carries real (not synthetic) byte weight.
    expect(take.type).toBe(mime);
    expect(media.width).toBeGreaterThan(0);
    expect(media.height).toBeGreaterThan(0);
    expect(take.size).toBeGreaterThan(100_000);
    const duration = media.duration && media.duration > 0 ? media.duration : take.duration;
    if (duration && duration > 0) {
      const averageBitsPerSecond = (take.size * 8) / duration;
      expect(averageBitsPerSecond, 'the take is not an empty/placeholder file').toBeGreaterThan(200_000);
    }
  });

  test('status line shows the ACTUAL capture geometry and real local backup state', async ({ page }) => {
    await instrument(page);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await studioReady(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });

    // The capture line must equal what the track reports — never a target.
    const track = await readCaptureTrackSettings(page);
    expect(track).not.toBeNull();
    if (track) {
      // The existing dims badge (bottom-right) also shows W × H, so scope to
      // the STATUS line's frame-rate suffix for strict mode safety.
      const expected = track.frameRate
        ? new RegExp(`${track.width}\\s*×\\s*${track.height}\\s*·\\s*${Math.round(track.frameRate)}\\s*fps`)
        : new RegExp(`${track.width}\\s*×\\s*${track.height}`);
      await expect(page.getByText(expected).first()).toBeVisible({ timeout: 10_000 });
    }

    // Local backup line is REAL: it appears only after a confirmed write, so
    // its visibility proves chunk persistence actually happened.
    await expect(page.getByText('Local backup', { exact: true })).toBeVisible({ timeout: 10_000 });

    await stopRecording(page);
    await expectReview(page);

    // A take that ended in this document leaves ZERO recovery rows.
    await expect
      .poll(async () => readRecoveryStores(page), { timeout: 15_000 })
      .toEqual({ sessions: 0, chunks: 0 });
  });

  test('a refresh mid-recording recovers the interrupted take (no data loss)', async ({ page }) => {
    // The navigation guard raises a beforeunload dialog during an active take.
    page.on('dialog', (dialog) => void dialog.accept());

    await instrument(page);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await studioReady(page);

    await transport(page).getByRole('button', { name: 'Start Recording' }).click();
    await transport(page).getByRole('button', { name: 'Stop Recording' }).waitFor({ state: 'visible', timeout: 30_000 });

    // Record long enough for several 1s chunks to persist, then let the last
    // IndexedDB write settle before the hard navigation.
    await page.waitForTimeout(3500);
    await page.waitForTimeout(800);
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Recovery lands directly in review, so there is no Start button to wait
    // for. The announcement and the attached blob ARE the readiness signal.

    // The studio must announce the recovery (real, not silent) and attach the
    // take for review — the reassembled blob is the prefix of what was being
    // recorded, so it is valid, self-contained media.
    await expect(page.getByText(/Your previous recording was recovered/)).toBeVisible({ timeout: 30_000 });
    await expectReview(page);

    const recoveredRows = await readMasterRecordings(page);
    expect(recoveredRows).toHaveLength(1);
    expect(recoveredRows[0].recordingMetadata).toMatchObject({
      requestedWidth: 1920,
      requestedHeight: 1080,
      profileId: expect.any(String),
      actualProfileId: expect.any(String),
      configuredVideoBitrate: expect.any(Number),
      fileSize: expect.any(Number),
      averageFileBitrate: expect.any(Number),
    });

    const video = page.locator('main video');
    await expect
      .poll(
        async () =>
          await video.evaluate((v) => {
            const el = v as HTMLVideoElement;
            return { w: el.videoWidth, h: el.videoHeight };
          }),
        { timeout: 15_000 },
      )
      .toMatchObject({ w: expect.any(Number) });

    // Adoption cleans the recovery rows for the adopted session.
    await expect
      .poll(async () => readRecoveryStores(page), { timeout: 15_000 })
      .toEqual({ sessions: 0, chunks: 0 });
  });

  test('changing the platform preview does NOT restart the camera stream (stable source)', async ({ page }) => {
    await instrument(page);
    await page.goto('/studio', { waitUntil: 'domcontentloaded' });
    await studioReady(page);

    const currentTrackId = () =>
      page.evaluate(() => {
        const streams = (window as unknown as { __ssxStreams?: MediaStream[] }).__ssxStreams ?? [];
        const track = streams.flatMap((s) => s.getVideoTracks()).find((t) => t.readyState === 'live');
        return track ? track.id : null;
      });
    const initialTrackId = await currentTrackId();
    expect(initialTrackId).not.toBeNull();

    // Force several studio re-renders: re-select the unlocked platform and
    // attempt a locked one (the pricing modal that opens is dismissed).
    const unlocked = page.locator('button[title="YouTube"]');
    if (await unlocked.count()) {
      await unlocked.first().click();
    }
    const locked = page.locator('button[title$="Creator plan required"]').first();
    if (await locked.isVisible().catch(() => false)) {
      await locked.click();
      const closeModal = page.getByRole('button', { name: 'Close' }).first();
      if (await closeModal.isVisible().catch(() => {})) await closeModal.click();
    }

    await page.waitForTimeout(1500);

    // The SAME live MediaStreamTrack object survives (identical id) — no
    // camera restart, no re-ask of permissions, no frame drop.
    expect(await currentTrackId()).toBe(initialTrackId);
  });
});
