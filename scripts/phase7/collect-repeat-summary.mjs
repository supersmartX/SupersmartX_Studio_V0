import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

if (process.env.SXS_RUN_REAL_HARDWARE !== '1') {
  throw new Error('Set SXS_RUN_REAL_HARDWARE=1 to explicitly enable physical camera/microphone capture.');
}

const runs = Number(process.argv.find((arg) => arg.startsWith('--runs='))?.split('=')[1] ?? 5);
const durationSeconds = Number(process.argv.find((arg) => arg.startsWith('--duration-seconds='))?.split('=')[1] ?? 30);
const retainDirArg = process.argv.find((arg) => arg.startsWith('--retain-dir='))?.split('=').slice(1).join('=');
const retainDirectory = retainDirArg ? path.resolve(retainDirArg) : null;
const cameraLabelArg = process.argv.find((arg) => arg.startsWith('--camera-label='))?.split('=').slice(1).join('=') || null;
const microphoneLabelArg = process.argv.find((arg) => arg.startsWith('--microphone-label='))?.split('=').slice(1).join('=') || null;
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('--runs must be an integer from 1 to 20.');
if (!Number.isFinite(durationSeconds) || durationSeconds < 5 || durationSeconds > 3600) {
  throw new Error('--duration-seconds must be from 5 to 3600.');
}

const collector = fileURLToPath(new URL('./collect-real-hardware.mjs', import.meta.url));
const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const output = [];
if (retainDirectory) mkdirSync(retainDirectory, { recursive: true });

function parseFinalJson(stdout) {
  const lines = stdout.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index].trimStart().startsWith('{')) continue;
    try { return JSON.parse(lines.slice(index).join('\n').trim()); } catch { /* try an earlier object */ }
  }
  return null;
}

function lastEvent(events, name) {
  return events?.filter((entry) => entry.name === name).at(-1)?.data ?? null;
}

for (let index = 1; index <= runs; index += 1) {
  const args = [collector, `--duration-seconds=${durationSeconds}`];
  if (retainDirectory) args.push(`--retain-dir=${retainDirectory}`);
  if (cameraLabelArg) args.push(`--camera-label=${cameraLabelArg}`);
  if (microphoneLabelArg) args.push(`--microphone-label=${microphoneLabelArg}`);
  const result = spawnSync(process.execPath, args, {
    cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
    env: { ...process.env, PLAYWRIGHT_BASE_URL: baseURL },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  if (result.error || result.status !== 0) {
    output.push({
      run: index,
      requestedDurationSeconds: durationSeconds,
      result: 'failed',
      error: result.error?.message ?? result.stderr.trim().slice(-1000) ?? `exit ${result.status}`,
    });
    continue;
  }

  const capture = parseFinalJson(result.stdout);
  if (!capture) {
    output.push({ run: index, requestedDurationSeconds: durationSeconds, result: 'invalid collector output' });
    continue;
  }

  const events = capture.diagnostics ?? [];
  const acquired = lastEvent(events, 'capture.acquired');
  const acquiredTracks = acquired?.tracks ?? [];
  const start = lastEvent(events, 'recorder.start-requested');
  const started = lastEvent(events, 'recorder.started');
  const finalized = lastEvent(events, 'recorder.finalized');
  const media = lastEvent(events, 'recording.output') ?? capture.recording ?? null;
  const preview = lastEvent(events, 'preview.frame-observation');
  const summary = capture.recording ?? capture.recordings?.[0] ?? capture.recoveredMaster ?? null;
  const failureMaster = capture.masterRows?.[0] ?? null;
  const mediaDevices = acquired?.devices ?? capture.deviceLabels ?? [];
  const errors = (capture.diagnostics ?? [])
    .filter((entry) => [
      'recorder.error',
      'capture.track-ended',
      'recovery.chunk-write-failed',
      'recovery.session-write-failed',
    ].includes(entry.name))
    .map((entry) => entry.name);

  output.push({
    run: index,
    result: capture.status === 'failed' ? 'failed' : media && summary ? 'recorded' : 'incomplete',
    recordingId: capture.runId ?? summary?.id ?? null,
    capturedAt: capture.capturedAt ?? capture.at ?? null,
    browserVersion: capture.browserVersion ?? null,
    camera: acquiredTracks.find((track) => track.kind === 'video')?.label ?? mediaDevices.find((device) => device.kind === 'videoinput')?.label ?? null,
    microphone: acquiredTracks.find((track) => track.kind === 'audio')?.label ?? mediaDevices.find((device) => device.kind === 'audioinput')?.label ?? null,
    os: capture.os ?? { platform: process.platform, release: null, version: null },
    selectedProfile: start?.profileId ?? summary?.recordingMetadata?.profileId ?? null,
    actualProfile: start?.actualProfileId ?? summary?.recordingMetadata?.actualProfileId ?? null,
    actualWidth: start?.actualWidth ?? summary?.recordingMetadata?.actualWidth ?? failureMaster?.recordingMetadata?.actualWidth ?? null,
    actualHeight: start?.actualHeight ?? summary?.recordingMetadata?.actualHeight ?? failureMaster?.recordingMetadata?.actualHeight ?? null,
    actualFps: start?.actualFps ?? summary?.recordingMetadata?.actualFps ?? failureMaster?.recordingMetadata?.actualFps ?? null,
    mimeType: media?.mimeType ?? summary?.mimeType ?? failureMaster?.mimeType ?? null,
    configuredVideoBitrate: media?.configuredVideoBitrate ?? summary?.recordingMetadata?.configuredVideoBitrate ?? failureMaster?.recordingMetadata?.configuredVideoBitrate ?? null,
    reportedVideoBitrate: media?.actualVideoBitrate ?? summary?.recordingMetadata?.actualVideoBitrate ?? failureMaster?.recordingMetadata?.actualVideoBitrate ?? null,
    configuredAudioBitrate: media?.configuredAudioBitrate ?? summary?.recordingMetadata?.configuredAudioBitrate ?? failureMaster?.recordingMetadata?.configuredAudioBitrate ?? null,
    reportedAudioBitrate: media?.actualAudioBitrate ?? summary?.recordingMetadata?.actualAudioBitrate ?? failureMaster?.recordingMetadata?.actualAudioBitrate ?? null,
    durationSeconds: media?.duration ?? summary?.duration ?? failureMaster?.durationSeconds ?? null,
    fileSizeBytes: media?.fileSize ?? summary?.fileSize ?? failureMaster?.fileSizeBytes ?? null,
    averageWholeFileBitrate: media?.averageFileBitrate ?? summary?.recordingMetadata?.averageFileBitrate ?? failureMaster?.recordingMetadata?.averageFileBitrate ?? null,
    combinedCaptureAcquisitionMs: acquired?.combinedCaptureAcquisitionMs ?? null,
    startupMs: started?.startupLatencyMs ?? null,
    finalizationMs: finalized?.finalizationLatencyMs ?? null,
    previewObservedFps: preview?.observedPlaybackFps ?? null,
    previewCallbackCount: preview?.observedFrameCallbacks ?? null,
    previewMaximumGapMs: preview?.maxFrameGapMs ?? null,
    errors,
    recoveryWriteFailures: errors.filter((name) => name.startsWith('recovery.')).length,
    localMasterRows: capture.recordings?.length ?? capture.masterRows?.length ?? capture.recoveredMasterCount ?? (summary ? 1 : 0),
    retainedMediaPath: capture.retainedMedia?.path ?? null,
    playback: capture.playback ?? null,
    error: capture.error ?? (result.status !== 0 ? result.stderr.trim().slice(-1000) : null),
    failureEvidence: capture.status === 'failed' ? capture : null,
    subjectiveVideoAudioReview: 'not performed by collector',
    avSyncReview: 'not performed by collector',
  });
  process.stdout.write(`${JSON.stringify(output.at(-1))}\n`);
}

const summary = { summary: { requestedRuns: runs, completedCaptures: output.filter((run) => run.result === 'recorded').length }, runs: output };
if (retainDirectory) {
  writeFileSync(path.join(retainDirectory, 'manifest.json'), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(retainDirectory, 'HUMAN_REVIEW.md'), [
    '# Local Phase 7B Human Review',
    '',
    'These are byte-for-byte copies of local master Blobs copied by the validation collector. They remain on this machine. Do not upload them or include them in source control.',
    '',
    'For each manifest entry, open its retained `.webm` or `.mp4` file and review the video and audio using `docs/PHASE7B_REAL_DEVICE_TEST_PROTOCOL.md`. Enter ratings, observations, evaluator, and sync findings in the Phase 7B results report. The collector does not assign subjective ratings.',
    '',
    'Recordings are named by their local master ID. Metadata sidecars redact device and group IDs.',
    '',
  ].join('\n'));
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (output.some((run) => run.result !== 'recorded')) process.exitCode = 1;
