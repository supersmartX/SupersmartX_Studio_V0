import { chromium } from '@playwright/test';
import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.SXS_RUN_REAL_HARDWARE !== '1') {
  throw new Error('Set SXS_RUN_REAL_HARDWARE=1 to explicitly enable physical camera/microphone capture.');
}

const durationSeconds = Number(process.argv.find((arg) => arg.startsWith('--duration-seconds='))?.split('=')[1] ?? 30);
if (!Number.isFinite(durationSeconds) || durationSeconds < 5 || durationSeconds > 3600) {
  throw new Error('--duration-seconds must be from 5 to 3600.');
}
const recoveryRefresh = process.argv.includes('--recovery-refresh');
const retainDirectoryArg = process.argv.find((arg) => arg.startsWith('--retain-dir='))?.split('=').slice(1).join('=');
const retainDirectory = retainDirectoryArg ? path.resolve(retainDirectoryArg) : null;
const diagnosticsDirectoryArg = process.argv.find((arg) => arg.startsWith('--diagnostics-dir='))?.split('=').slice(1).join('=');
const diagnosticsDirectory = path.resolve(diagnosticsDirectoryArg || '.phase7b-validation/diagnostics');
const cameraLabelArg = process.argv.find((arg) => arg.startsWith('--camera-label='))?.split('=').slice(1).join('=') || null;
const microphoneLabelArg = process.argv.find((arg) => arg.startsWith('--microphone-label='))?.split('=').slice(1).join('=') || null;
const backgroundSeconds = Number(process.argv.find((arg) => arg.startsWith('--background-seconds='))?.split('=')[1] ?? 0);
if (!Number.isFinite(backgroundSeconds) || backgroundSeconds < 0 || backgroundSeconds > 3600) {
  throw new Error('--background-seconds must be from 0 to 3600.');
}
if (retainDirectory) mkdirSync(retainDirectory, { recursive: true });

function redactDeviceIdentifiers(value) {
  if (Array.isArray(value)) return value.map(redactDeviceIdentifiers);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(deviceId|groupId)$/i.test(key))
    .map(([key, entry]) => [key, redactDeviceIdentifiers(entry)]));
}

async function retainRecordingBlob(page, recordingId, fileName) {
  if (!retainDirectory) return null;
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) throw new Error('Unsafe validation media filename.');
  const outputPath = path.join(retainDirectory, fileName);
  writeFileSync(outputPath, Buffer.alloc(0));
  await page.exposeFunction('__sxsWriteValidationChunk', (name, base64) => {
    if (name !== fileName) throw new Error('Unexpected validation media filename.');
    appendFileSync(outputPath, Buffer.from(base64, 'base64'));
  });
  const result = await page.evaluate(async ({ id, outputName }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('sxs-studio');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const row = await new Promise((resolve, reject) => {
      const request = db.transaction('recordings', 'readonly').objectStore('recordings').get(id);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
    if (!row?.blob) throw new Error('The completed local master Blob is unavailable.');
    const blob = row.blob;
    const chunkSize = 1024 * 1024;
    for (let offset = 0; offset < blob.size; offset += chunkSize) {
      const bytes = new Uint8Array(await blob.slice(offset, offset + chunkSize).arrayBuffer());
      let binary = '';
      for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      }
      await window.__sxsWriteValidationChunk(outputName, btoa(binary));
    }
    db.close();
    return { size: blob.size, mimeType: blob.type || null };
  }, { id: recordingId, outputName: fileName });
  const writtenBytes = statSync(outputPath).size;
  if (writtenBytes !== result.size) throw new Error(`Retained master size mismatch: expected ${result.size}, wrote ${writtenBytes}.`);
  return { path: outputPath, sizeBytes: writtenBytes, mimeType: result.mimeType };
}

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
let failureSnapshotWritten = false;
let captureFailureSnapshot = null;
const runnerStartedAt = Date.now();
try {
  const context = await browser.newContext({ permissions: ['camera', 'microphone'] });
  const page = await context.newPage();
  const runtimeErrors = { consoleErrors: [], pageErrors: [], pageCrashes: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.consoleErrors.push(message.text().slice(0, 1000));
  });
  page.on('pageerror', (error) => runtimeErrors.pageErrors.push(error.message.slice(0, 1000)));
  page.on('crash', () => runtimeErrors.pageCrashes.push(new Date().toISOString()));
  await page.addInitScript(() => {
    const win = window;
    win.__sxsMediaStreams = [];
    win.__sxsMediaRecorders = [];
    const NativeRecorder = win.MediaRecorder;
    if (NativeRecorder) {
      const TrackedRecorder = new Proxy(NativeRecorder, {
        construct(target, args) {
          const recorder = Reflect.construct(target, args);
          win.__sxsMediaRecorders.push(recorder);
          return recorder;
        },
      });
      Object.defineProperty(win, 'MediaRecorder', { value: TrackedRecorder, configurable: true, writable: true });
    }
    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices?.getUserMedia) {
      const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      Object.defineProperty(mediaDevices, 'getUserMedia', {
        configurable: true,
        value: async (constraints) => {
          const stream = await nativeGetUserMedia(constraints);
          win.__sxsMediaStreams.push(stream);
          return stream;
        },
      });
    }
  });

  const collectState = async (stage, elapsedMs = null, error = null) => {
    const browserState = await page.evaluate(async () => {
      const storeRows = async (storeName) => {
        let db;
        try {
          db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('sxs-studio');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          if (!db.objectStoreNames.contains(storeName)) return [];
          return await new Promise((resolve, reject) => {
            const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } catch {
          return null;
        } finally {
          db?.close();
        }
      };
      const [masters, sessions, chunks] = await Promise.all([
        storeRows('recordings'),
        storeRows('recording-sessions'),
        storeRows('recording-chunks'),
      ]);
      const visible = (element) => {
        const style = getComputedStyle(element);
        return style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0;
      };
      return {
        userAgent: navigator.userAgent,
        visibilityState: document.visibilityState,
        visibleControls: [...document.querySelectorAll('button')].filter(visible).map((button) => ({
          label: button.getAttribute('aria-label') || button.innerText?.trim() || null,
          text: button.innerText?.trim() || null,
          disabled: button.disabled,
        })),
        statusText: [...document.querySelectorAll('[role="status"], [role="alert"]')].filter(visible).map((element) => element.textContent?.trim()).filter(Boolean),
        mediaRecorders: (window.__sxsMediaRecorders ?? []).map((recorder) => ({
          state: recorder.state,
          mimeType: recorder.mimeType || null,
          videoBitsPerSecond: Number.isFinite(recorder.videoBitsPerSecond) ? recorder.videoBitsPerSecond : null,
          audioBitsPerSecond: Number.isFinite(recorder.audioBitsPerSecond) ? recorder.audioBitsPerSecond : null,
        })),
        tracks: (window.__sxsMediaStreams ?? []).flatMap((stream) => stream.getTracks().map((track) => ({
          kind: track.kind,
          label: track.label || null,
          readyState: track.readyState,
          muted: track.muted,
          settings: Object.fromEntries(Object.entries(track.getSettings()).filter(([key]) => !/^(deviceId|groupId)$/i.test(key))),
        }))),
        masterRows: masters?.map((row) => ({
          id: row.id,
          mimeType: row.blob?.type || null,
          fileSizeBytes: row.blob?.size ?? null,
          durationSeconds: row.duration ?? null,
          recordingMetadata: row.recordingMetadata ?? null,
          createdAt: row.createdAt ?? null,
        })) ?? null,
        recovery: {
          sessionsAvailable: sessions !== null,
          sessionCount: sessions?.length ?? null,
          chunkCount: chunks?.length ?? null,
          persistedBytes: chunks?.reduce((total, chunk) => total + (chunk.blob?.size ?? 0), 0) ?? null,
        },
        diagnostics: window.__SXS_RECORDING_DIAGNOSTICS__?.events ?? [],
        jsHeap: performance.memory ? {
          usedBytes: performance.memory.usedJSHeapSize ?? null,
          totalBytes: performance.memory.totalJSHeapSize ?? null,
          limitBytes: performance.memory.jsHeapSizeLimit ?? null,
          source: 'Chromium performance.memory page heap; not total browser memory',
        } : null,
      };
    }).catch((cause) => ({ snapshotError: cause instanceof Error ? cause.message : String(cause) }));
    return redactDeviceIdentifiers({
      stage,
      at: new Date().toISOString(),
      currentUrl: page.url(),
      elapsedMs,
      error,
      runtimeErrors,
      ...browserState,
    });
  };

  const persistFailureSnapshot = async (stage, elapsedMs = null, error = null) => {
    failureSnapshotWritten = true;
    const snapshot = await collectState(stage, elapsedMs, error);
    const latestMaster = [...(snapshot.masterRows ?? [])]
      .sort((left, right) => new Date(right.createdAt ?? 0) - new Date(left.createdAt ?? 0))[0];
    if (retainDirectory && latestMaster?.id && (latestMaster.fileSizeBytes ?? 0) > 0) {
      try {
        const extension = latestMaster.mimeType?.includes('mp4') ? 'mp4' : 'webm';
        snapshot.retainedMedia = await retainRecordingBlob(page, latestMaster.id, `${latestMaster.id}.${extension}`);
      } catch (retentionError) {
        snapshot.retentionError = retentionError instanceof Error ? retentionError.message : String(retentionError);
      }
    }
    mkdirSync(diagnosticsDirectory, { recursive: true });
    const filename = `failure-${Date.now()}.json`;
    writeFileSync(path.join(diagnosticsDirectory, filename), JSON.stringify(snapshot, null, 2));
    snapshot.snapshotFile = path.join(diagnosticsDirectory, filename);
    console.log(JSON.stringify({ status: 'failed', ...snapshot }, null, 2));
    return snapshot;
  };
  captureFailureSnapshot = persistFailureSnapshot;

  await page.goto(`${baseURL}/studio`, { waitUntil: 'domcontentloaded' });

  const welcome = page.getByRole('dialog', { name: 'Welcome' });
  if (await welcome.isVisible().catch(() => false)) {
    const getStarted = page.getByRole('button', { name: 'Get Started' });
    if (await getStarted.isVisible().catch(() => false)) await getStarted.click();
  }

  const enable = page.getByRole('button', { name: 'Enable Camera & Microphone' });
  if (await enable.isVisible().catch(() => false)) await enable.click();

  const start = page.getByLabel('Recording controls').getByRole('button', { name: 'Start Recording' });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !(await start.isEnabled().catch(() => false))) {
    const getStarted = page.getByRole('button', { name: 'Get Started' });
    const retry = page.getByRole('button', { name: 'Retry', exact: true });
    if (await getStarted.isVisible().catch(() => false)) await getStarted.click().catch(() => {});
    if (await enable.isVisible().catch(() => false)) await enable.click().catch(() => {});
    if (await retry.isVisible().catch(() => false)) await retry.click().catch(() => {});
    await page.waitForTimeout(1000);
  }
  if (!(await start.isEnabled().catch(() => false))) {
    const cameraError = await page.locator('[role="alert"], [role="status"]').allTextContents().catch(() => []);
    const message = `Studio did not become ready. Status: ${cameraError.join(' | ') || 'unavailable'}`;
    await persistFailureSnapshot('studio-not-ready', null, message);
    throw new Error(message);
  } else if (cameraLabelArg || microphoneLabelArg) {
    const selectDevice = async (kind, requestedLabel) => {
      if (!requestedLabel) return;
      const picker = page.getByRole('button', { name: `${kind} device options` });
      await picker.click();
      const menu = page.getByRole('menu', { name: kind });
      const option = menu.getByRole('menuitemradio', { name: requestedLabel, exact: true });
      if (await option.count() !== 1) {
        throw new Error(`${kind} label was not uniquely available: ${requestedLabel}`);
      }
      const priorEventCount = await page.evaluate(() => window.__SXS_RECORDING_DIAGNOSTICS__?.events.length ?? 0);
      await option.click();
      const deadline = Date.now() + 30_000;
      let reacquired = false;
      while (Date.now() < deadline && !reacquired) {
        reacquired = await page.evaluate((count) => (window.__SXS_RECORDING_DIAGNOSTICS__?.events.slice(count) ?? []).some((event) => event.name === 'capture.acquired'), priorEventCount).catch(() => false);
        if (!reacquired) await page.waitForTimeout(100);
      }
      if (!reacquired) throw new Error(`${kind} selection did not produce a new capture.acquired event.`);
      if (!(await start.isEnabled().catch(() => false))) throw new Error(`${kind} selection did not return Studio to recording-ready state.`);
    };
    try {
      await selectDevice('Camera', cameraLabelArg);
      await selectDevice('Microphone', microphoneLabelArg);
    } catch (error) {
      await persistFailureSnapshot('device-selection-failed', null, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  await start.click();
  if (recoveryRefresh) {
    page.on('dialog', (dialog) => void dialog.accept());
    await page.getByText('Local backup', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.waitForTimeout(1200);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(/Your previous recording was recovered/).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByRole('button', { name: 'Export recording' }).waitFor({ state: 'visible', timeout: 30_000 });

    const recoveryEvidence = await page.evaluate(async () => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('sxs-studio');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const readAll = (storeName) => new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(storeName)) return resolve([]);
        const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const [recordings, sessions, chunks] = await Promise.all([
        readAll('recordings'),
        readAll('recording-sessions'),
        readAll('recording-chunks'),
      ]);
      const video = document.querySelector('main video');
      const latest = recordings.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      const metadata = latest?.recordingMetadata;
      db.close();
      return {
        recoveredMasterCount: recordings.length,
        recoveredMaster: latest ? {
          id: latest.id,
          createdAt: latest.createdAt ?? null,
          mimeType: latest.blob?.type || null,
          fileSizeBytes: latest.blob?.size ?? null,
          durationSeconds: latest.duration ?? null,
          profileId: metadata?.profileId ?? null,
          actualProfileId: metadata?.actualProfileId ?? null,
          actualWidth: metadata?.actualWidth ?? null,
          actualHeight: metadata?.actualHeight ?? null,
          actualFps: metadata?.actualFps ?? null,
        } : null,
        recoverySessionsRemainingAfterAdoption: sessions.length,
        recoveryChunksRemainingAfterAdoption: chunks.length,
        reviewVideoGeometry: video ? { width: video.videoWidth, height: video.videoHeight } : null,
      };
    });
    if (!recoveryEvidence.recoveredMaster?.id) {
      await persistFailureSnapshot('recovery-master-missing', null, 'Recovery message appeared, but no recovered master row was found.');
      throw new Error('Recovery message appeared, but no recovered master row was found.');
    }
    const recoveredVideo = page.locator('main video');
    await recoveredVideo.waitFor({ state: 'visible', timeout: 30_000 });
    await recoveredVideo.evaluate((element) => element.play());
    await page.waitForTimeout(700);
    const recoveryPlayback = await recoveredVideo.evaluate((element) => {
      const media = element;
      const result = {
        durationSeconds: Number.isFinite(media.duration) ? media.duration : null,
        currentTimeSeconds: media.currentTime,
        paused: media.paused,
        readyState: media.readyState,
        videoWidth: media.videoWidth,
        videoHeight: media.videoHeight,
        muted: media.muted,
        mediaErrorCode: media.error?.code ?? null,
      };
      media.pause();
      return result;
    });
    let retainedMedia = null;
    if (retainDirectory) {
      const extension = recoveryEvidence.recoveredMaster.mimeType?.includes('mp4') ? 'mp4' : 'webm';
      retainedMedia = await retainRecordingBlob(page, recoveryEvidence.recoveredMaster.id, `${recoveryEvidence.recoveredMaster.id}.${extension}`);
    }
    console.log(JSON.stringify({
      scenario: 'physical-device-refresh-recovery',
      browserVersion: browser.version(),
      os: { platform: process.platform, release: os.release(), version: os.version() },
      recoveryMessageVisible: true,
      reviewOpened: true,
      recoveryPlayback,
      retainedMedia,
      ...recoveryEvidence,
    }, null, 2));
  } else {
    const stop = page.getByLabel('Recording controls').getByRole('button', { name: 'Stop Recording' });
    let elapsedMs = 0;
    try {
      await stop.waitFor({ state: 'visible', timeout: 30_000 });
      const waitStartedAt = Date.now();
      const targetMs = durationSeconds * 1000;
      while (elapsedMs < targetMs) {
        const intervalMs = Math.min(60_000, targetMs - elapsedMs);
        await page.waitForTimeout(intervalMs);
        elapsedMs = Date.now() - waitStartedAt;
        const sample = await collectState('recording-progress', elapsedMs);
        console.log(JSON.stringify({
          status: 'recording',
          requestedWaitSeconds: durationSeconds,
          elapsedSeconds: Math.round(elapsedMs / 1000),
          currentUrl: sample.currentUrl,
          visibilityState: sample.visibilityState ?? null,
          recorderStates: sample.mediaRecorders?.map((recorder) => recorder.state) ?? null,
          tracks: sample.tracks?.map((track) => ({ kind: track.kind, readyState: track.readyState, muted: track.muted })) ?? null,
          recovery: sample.recovery ?? null,
          jsHeap: sample.jsHeap ?? null,
          runtimeErrors: { console: sample.runtimeErrors?.consoleErrors?.length ?? 0, page: sample.runtimeErrors?.pageErrors?.length ?? 0, crashes: sample.runtimeErrors?.pageCrashes?.length ?? 0 },
        }));
        const recorderStates = sample.mediaRecorders?.map((recorder) => recorder.state) ?? [];
        if (recorderStates.length > 0 && recorderStates.every((state) => state === 'inactive')) {
          const status = sample.statusText?.join(' | ') || 'no status message';
          const message = `Recorder became inactive before the requested ${durationSeconds}-second run completed at ${Math.round(elapsedMs / 1000)} seconds; ${status}.`;
          await persistFailureSnapshot('recording-ended-before-requested-duration', elapsedMs, message);
          throw new Error(message);
        }
      }

      if (!(await stop.isVisible().catch(() => false))) {
        await persistFailureSnapshot('stop-control-missing', elapsedMs, 'Stop control was not visible after the requested recording wait.');
        throw new Error('Stop control was not visible after the requested recording wait.');
      }
      await stop.click();
      await page.waitForTimeout(200);
      const confirmStop = page.getByLabel('Recording controls').getByRole('button', { name: 'Stop Recording' });
      if (!(await confirmStop.isVisible().catch(() => false))) {
        await persistFailureSnapshot('stop-confirm-control-missing', elapsedMs, 'The Stop confirmation control disappeared before confirmation.');
        throw new Error('The Stop confirmation control disappeared before confirmation.');
      }
      await confirmStop.click();
      await stop.waitFor({ state: 'detached', timeout: 30_000 });
      await page.getByRole('button', { name: 'Export recording' }).waitFor({ state: 'visible', timeout: 60_000 });

      const evidence = await page.evaluate(async () => {
        const diagnostics = (window).__SXS_RECORDING_DIAGNOSTICS__;
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open('sxs-studio');
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const rows = await new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains('recordings')) return resolve([]);
          const request = db.transaction('recordings', 'readonly').objectStore('recordings').getAll();
          request.onsuccess = () => resolve(request.result.map((row) => ({
            id: row.id,
            createdAt: row.createdAt ?? null,
            mimeType: row.blob?.type || null,
            fileSize: row.blob?.size ?? null,
            duration: row.duration ?? null,
            recordingMetadata: row.recordingMetadata ?? null,
          })));
          request.onerror = () => reject(request.error);
        });
        db.close();
        return {
          userAgent: navigator.userAgent,
          capturedAt: new Date().toISOString(),
          diagnostics: diagnostics?.events ?? [],
          recordings: rows,
        };
      });

      const latest = [...evidence.recordings].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0))[0] ?? null;
      if (!latest) throw new Error('No saved master was found in local IndexedDB after finalization.');

      const video = page.locator('main video');
      await video.waitFor({ state: 'visible', timeout: 30_000 });
      let retainedMedia = null;
      if (retainDirectory) {
        const extension = latest.mimeType?.includes('mp4') ? 'mp4' : 'webm';
        const fileName = `${latest.id}.${extension}`;
        retainedMedia = await retainRecordingBlob(page, latest.id, fileName);
      }
      await video.evaluate((element) => element.play());
      await page.waitForTimeout(1_000);
      const playback = await video.evaluate((element) => {
        const media = element;
        const result = {
          durationSeconds: Number.isFinite(media.duration) ? media.duration : null,
          currentTimeSeconds: media.currentTime,
          paused: media.paused,
          readyState: media.readyState,
          videoWidth: media.videoWidth,
          videoHeight: media.videoHeight,
          muted: media.muted,
          mediaErrorCode: media.error?.code ?? null,
        };
        media.pause();
        return result;
      });

      const output = redactDeviceIdentifiers({
        status: 'completed',
        runId: latest.id,
        capturedAt: latest.createdAt ?? evidence.capturedAt,
        browserVersion: browser.version(),
        os: { platform: process.platform, release: os.release(), version: os.version() },
        requestedDurationSeconds: durationSeconds,
        actualDurationSeconds: latest.duration,
        deviceLabels: evidence.diagnostics.findLast((event) => event.name === 'capture.acquired')?.data?.devices ?? null,
        retainedMedia,
        playback,
        diagnostics: evidence.diagnostics,
        recording: latest,
        runtimeErrors,
      });
      if (retainDirectory) {
        const sidecarPath = path.join(retainDirectory, `${latest.id}.json`);
        writeFileSync(sidecarPath, JSON.stringify(output, null, 2));
        output.manifestPath = sidecarPath;
      }
      console.log(JSON.stringify(output, null, 2));
    } catch (error) {
      if (!failureSnapshotWritten && !runtimeErrors.pageCrashes.length) {
        await persistFailureSnapshot('recording-workflow-failed', elapsedMs, error instanceof Error ? error.message : String(error));
      }
      throw error;
    }
  }
  await context.close();
} catch (error) {
  if (!failureSnapshotWritten && captureFailureSnapshot) {
    try {
      await captureFailureSnapshot('unhandled-workflow-failure', Date.now() - runnerStartedAt, error instanceof Error ? error.message : String(error));
    } catch { /* retain the original failure and stdout snapshot if present */ }
  }
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
