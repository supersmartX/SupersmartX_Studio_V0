# Phase 7 — Real Hardware Recording Validation

## Purpose and guardrails

This procedure evaluates the existing browser-native `MediaRecorder` path on physical devices. Chromium fake-media tests remain behavioral regression tests and are not hardware evidence. Raw recordings stay in the browser's local IndexedDB; this procedure does not upload recording chunks or export media to R2.

No quality score is calculated. Record requested profile, device-reported capture, recorder-reported values, output metadata, and subjective observations separately. A missing browser metric is `unavailable`, never a guessed value.

## Development diagnostics

Run the app in development mode, open `/studio`, grant camera and microphone access, and complete a short recording. The development-only API is available in the browser console:

```js
window.__SXS_RECORDING_DIAGNOSTICS__?.events
window.__SXS_RECORDING_DIAGNOSTICS__?.exportJson()
window.__SXS_RECORDING_DIAGNOSTICS__?.clear()
```

The API stores timestamped metric events only; it does not store frames or audio. Device labels may be present after permission is granted. Remove labels and other identifying details before sharing a diagnostics export.

Diagnostic event names include capture request/acquisition/failure, track-ended, recorder start/configuration/error/finalization, output metadata, container track durations, preview frame observations, and recovery write failures. Camera and microphone initialization are a single `getUserMedia` operation in this architecture; individual camera-vs-microphone latency is explicitly `null`, while combined acquisition latency is measured.

## Measurement definitions

| Metric | Source | Interpretation |
|---|---|---|
| Requested resolution/FPS | Constraint/profile request | Target only; not an achievement claim |
| Actual capture resolution/FPS | `MediaStreamTrack.getSettings()` | Device/browser-reported settings |
| Selected and actual profile | Capability ranges and track settings | Separate target selection from achieved capture classification |
| Recorder MIME/bitrate | `MediaRecorder` instance | Browser-reported values, nullable if unavailable |
| Configured bitrate | Constructor options | Requested encoder target, not guaranteed output rate |
| File size/average file bitrate | Final Blob size and media duration | Average includes audio and container overhead; not video bitrate |
| Preview-observed FPS/gaps | `requestVideoFrameCallback` | Preview callback timing only; not encoded-frame count or proof of camera drops |
| Video/audio duration | Container metadata when available | Duration comparison; not a lip-sync score |
| Perceptual quality, sharpness, exposure, color, audio clarity, sync | Human review | Subjective observations; record evaluator and scene |

`cameraInitializationMs` and `microphoneInitializationMs` remain unavailable because the app requests both tracks together. `combinedCaptureAcquisitionMs` records the measured acquisition call time. Preview callback counts are separate from recorded frame counts; the latter are not claimed unless a reliable container/browser source supplies them.

## Repeatable test matrix

Record device model/OS, browser name/version, camera, microphone, room/lighting, app build, date, run ID, and whether the run is attended. Test all combinations the device/OS actually supports; do not attempt Safari on Windows or Bluetooth microphone modes the browser does not expose.

| Device class | Capture setup | Browser coverage |
|---|---|---|
| Modern laptop | Built-in camera and microphone array | Current Chrome and Edge; Safari on macOS; Firefox where supported |
| Older/lower-powered laptop | Built-in camera and microphone | Current supported browser plus one alternate browser |
| External 1080p webcam | USB webcam and built-in or USB microphone | Chrome/Edge on supported desktop OS; Firefox where supported |
| Desktop webcam | Integrated/USB camera and desktop microphone | Chrome/Edge; Firefox where supported |
| USB microphone | Laptop or desktop camera plus USB microphone | Chrome/Edge; Safari on macOS where applicable |
| Bluetooth microphone | Laptop/desktop camera plus headset microphone in the browser-selected hands-free mode | Chrome/Edge/Firefox on supported OS; Safari only when the OS/browser exposes that input |

Do not count a device as tested because it appears in the operating-system inventory. A run counts only after a physical-device recording completes and its output is reviewed.

## Repeatable scenes

Keep camera position, subject distance, room, and light placement consistent between runs. Do not include confidential screens, documents, or bystanders without consent.

### Video scenes

- **A — Talking head:** face centered, stationary camera, normal indoor lighting, ordinary speaking movement.
- **B — Fine detail:** hair, skin texture, printed text, fine lines, and patterned clothing visible in frame.
- **C — Motion:** repeat head, hand, and moderate body movement.
- **D — Difficult lighting:** bright background, lower indoor light, and a high-contrast scene.

### Audio scenes

- **A — Conversational:** normal speech at a fixed distance and level.
- **B — Quiet:** soft speech at the same distance.
- **C — Loud:** raised voice without clipping by design.
- **D — Background noise:** normal speech with a repeatable, controlled noise source.

Label observations as subjective. Preserve a local test recording only as long as needed for review; explicitly delete test recordings through the app when authorized by the tester.

## Durations and repetitions

For each representative setup, perform at least three 30-second runs. For selected stable devices, perform one 5-minute and one 15-minute run; consider 30 or 60 minutes only when the shorter runs are stable and there is a clear reason. Repeat the same scene and device settings. Do not claim consistency from a single run.

For every run record:

```text
Run ID, date, device class/model, OS, browser/version
Camera and microphone labels (where disclosed)
Requested profile and actual profile
Requested constraints and actual track settings
MIME/container, configured bitrates, browser-reported bitrates
Recorder duration, final media/video/audio duration where available
File size and average file bitrate (whole-file only)
Combined capture acquisition, recorder startup, and finalization times
Preview callback count/rate/gaps, clearly labeled as preview measurements
Recovery write failures, recorder errors, track-ended events
Recovery/playback/export result
Subjective video/audio observations and evaluator
```

Use `unavailable` for missing values. Do not infer frame drops, image quality, audio quality, or A/V synchronization from bitrate or duration alone.

## Long recording procedure

On selected stable devices, run 5- and 15-minute captures before considering longer runs. Monitor the local backup status, browser memory, chunk/session counts, completion/finalization, playback, review, and export. Keep the browser tab foreground for the baseline run; test backgrounding as a separate condition. Note whether device power-saving or thermal behavior changes the result.

## Recovery procedure

Use a disposable test profile and an unimportant test take. For each case, record the event and outcome:

1. Start a take, wait for multiple local backup writes, then refresh and verify recovery opens in review.
2. Start a take, wait for backup writes, then close the tab/browser only if the test profile has no important unsaved data.
3. Start a take, background the tab for a defined interval, return, and stop normally.
4. Start a take and disconnect/disable the camera only when the device can be safely reconnected.
5. Start a take and disconnect/disable the microphone only when safe.

For each case inspect playability, recovered duration, missing/corrupt chunks, review state, and cleanup. Do not interrupt a user's real recording or use a primary browser profile for destructive recovery tests.

## Regression checks

```bash
npx tsc --noEmit
npm test
npm run build
npx playwright test e2e/recording-quality.spec.ts e2e/recording-loop.spec.ts --project=chromium
```

These establish code behavior only. They do not replace the physical-device matrix above.
