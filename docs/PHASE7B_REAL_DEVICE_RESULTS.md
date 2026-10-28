# Phase 7B — Real-Device Validation Results

## 1. Test environment

- Windows 11 Home Single Language (`10.0.26300`), Chrome `151.0.7922.34`.
- SupersmartX Studio on the existing local development server (`http://localhost:3000`).
- Physical capture runs used the USB2.0 FHD UVC webcam. The default mic was the Realtek Microphone Array; one run explicitly selected the CMF Neckband Pro Bluetooth headset mic.
- The app showed the anonymous Free plan. Its device-local recording allowance stops recording at 600 seconds per day. A 15-minute recording therefore cannot be performed in this account.
- Machine make/model, room, lighting, power mode, and a controlled scene/speech script were not recorded. Do not infer those conditions.
- Validation media and diagnostics are local under ignored `.phase7b-validation/`; they are not uploaded or committed. Device and group IDs are omitted from report metadata.

## 2. Device/browser matrix

| Combination | Camera | Captured microphone | Browser / OS | Result |
|---|---|---|---|---|
| Baseline | USB2.0 FHD UVC WebCam | Realtek Microphone Array | Chrome 151 / Windows 11 | Five ~30-second captures and one 570-second capture completed; a separate run hit the 600-second Free allowance |
| Alternate input | Same USB webcam | Headset (CMF Neckband Pro) (Bluetooth) | Chrome 151 / Windows 11 | One ~30-second capture completed; acquired track label verified from its metadata sidecar |
| Other camera/browser | NVIDIA Broadcast virtual camera was enumerated but not selected; no other browser was tested | — | — | Not tested |

The alternate microphone is physical headset hardware. No second physical camera, second computer, Edge, Firefox, Safari, or macOS result is claimed.

## 3. Short-run results

All five baseline masters were copied byte-for-byte from local IndexedDB to `.phase7b-validation/final-5-runs/`. Each Review video element decoded at 1920×1080 with `readyState=4`, advanced during playback, was unmuted, and reported no media error. The collector did not play any take to completion or make subjective quality judgments.

| Run | Profile / track settings | MIME | Configured / reported V+A bitrate (bps) | Duration | Size | Whole-file avg bitrate | Startup / finalize (ms) | Preview callback fps* | Errors |
|---:|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | 1080p30, 1920×1080 @ 30 | WebM VP9/Opus | 8,000,000 / 8,000,000; 128,000 / 128,000 | 30.679 s | 6,596,276 B | 1,720,076 | 155 / 65 | 9.96 | None logged |
| 2 | 1080p30, 1920×1080 @ 30 | WebM VP9/Opus | 8,000,000 / 8,000,000; 128,000 / 128,000 | 33.791 s | 7,595,469 B | 1,798,223 | 277 / 133 | 4.22 | None logged |
| 3 | 1080p30, 1920×1080 @ 30 | WebM VP9/Opus | 8,000,000 / 8,000,000; 128,000 / 128,000 | 33.999 s | 8,105,004 B | 1,907,116 | 249 / 119 | 1.00 | None logged |
| 4 | 1080p30, 1920×1080 @ 30 | WebM VP9/Opus | 8,000,000 / 8,000,000; 128,000 / 128,000 | 30.659 s | 6,610,412 B | 1,724,887 | 253 / 53 | 9.95 | None logged |
| 5 | 1080p30, 1920×1080 @ 30 | WebM VP9/Opus | 8,000,000 / 8,000,000; 128,000 / 128,000 | 30.675 s | 6,585,074 B | 1,717,379 | 259 / 54 | 9.96 | None logged |
| Bluetooth mic | 1080p30, 1920×1080 @ 30 | WebM VP9/Opus | 8,000,000 / 8,000,000; 128,000 / 128,000 | 30.598 s | 6,614,572 B | 1,729,413 | 352 / 49 | 9.96 | None logged |

Across the five baseline runs, reported geometry, track FPS, profile, MIME/codecs, and configured/reported bitrate were consistent. Duration and file size varied. Whole-file average bitrate includes both tracks and container overhead; it is not video bitrate. The Bluetooth mic take was retained under `.phase7b-validation/headset-microphone/`; its actual acquired audio track was the headset, despite the enumerated device list also containing the default Realtek mic.

\* `preview.frame-observation` callbacks measure preview scheduling, not encoded frames. The unusually low and variable observations, including long callback gaps, are not proof that the saved recording dropped frames. They warrant controlled foreground review. No encoded frame count was available.

## 4. 15-minute result

The requested 900-second run did **not** complete as requested. At 600.101 seconds, the app finalized a 138,136,141-byte 1080p30 VP9/Opus master (whole-file average 1,841,505 bps; configured/reported video 8,000,000 bps and audio 128,000 bps; startup 279 ms; finalization 146 ms). The UI status was “Recording stopped — device-local Free recording allowance reached for today.” The recorder was inactive, both tracks ended normally, and recovery session/chunk stores were empty after finalization. No recorder, track-ended, console, page, or crash errors appeared.

The collector then reported its Stop control missing at the requested 900-second endpoint. This is an entitlement/environment blocker, not evidence of a 15-minute encoder failure. The failure snapshot contains the URL, controls, status, elapsed time, recorder/track state, master metadata, recovery state, diagnostics, and JS heap observation at `.phase7b-validation/diagnostics/`. This particular 600-second master was not retained before its temporary browser context closed.

A separate retained 570-second run completed normally at 570.628 seconds: 131,928,718 bytes (retained copy size matched), 1080p30 VP9/Opus, 1,849,593 bps whole-file average, 259 ms startup, 145 ms finalization, no recorder/track/recovery-write errors, and successful Review decode/playback observation (1920×1080, `readyState=4`, unmuted, no media error). DOM playback duration was unavailable (`null`); IndexedDB metadata reported 570.628 seconds. This establishes a stable run below the allowance, not 15-minute performance.

## 5. Video quality observations

**Not human-reviewed.** The retained masters are available for sharpness, motion, exposure, color, framing, and encoding-artifact review. Track-reported 1080p30, configured bitrate, and successful decode do not establish perceived quality. No reviewer assigned a rating.

## 6. Audio quality observations

**Not human-reviewed.** The Realtek and Bluetooth headset takes contain audio tracks and decode in Review; this does not establish speech clarity, noise, clipping, distortion, pumping, dropouts, or Bluetooth latency. No reviewer assigned a rating.

## 7. A/V sync result

**Not tested.** No controlled clap/flash marker was captured, and no measured offset is available. Track presence, nominal settings, and master duration do not prove synchronization. The repeatable manual procedure is in [PHASE7B_REAL_DEVICE_TEST_PROTOCOL.md](./PHASE7B_REAL_DEVICE_TEST_PROTOCOL.md).

## 8. Recovery result

One physical-device refresh test completed the sequence Record → refresh → recovery adoption → Review → playback. The recovered local WebM master was 79,116 bytes with 2.102-second recording metadata. Review playback decoded at 1920×1080, `readyState=4`, advanced to 1.03 seconds, was unmuted, and had no media error. The video element reported 1.912 seconds duration, 190 ms shorter than the master metadata; this very short interrupted clip is not enough to characterize duration accuracy. Recovery session/chunk stores were empty after adoption. The recovered bytes are retained under `.phase7b-validation/recovery-refresh/`.

The normal-stop path was also exercised by all five short takes, the Bluetooth take, and the 570-second take; each finalized and opened Review with decoded playback. Full-length playback to completion was not verified. Background-tab, camera-disconnect, and microphone-loss recovery cases were not tested.

## 9. Performance observations

- During the 570-second foreground run, 60-second snapshots showed an active recorder and live tracks at every sample, continuous recovery writes (57 to 546 chunks; 13.2 to 131.8 MB), and no console/page/crash errors. The tab remained visible.
- Chromium `performance.memory` page JS heap observations fluctuated roughly from 17 to 28 MB during that run. This is page heap only, not total browser/process memory. No exact CPU metric was available.
- The 600-second capped run likewise remained visible/responsive to collector snapshots, with no runtime errors. At the cap, the UI finalized the take and stopped both tracks.
- Teleprompter behavior, objective UI latency, thermal effects, CPU pressure, and encoded frame pacing were not measured.

## 10. Failures and blockers

- **15-minute environment blocker:** anonymous Free recording allowance is capped at 600 seconds per day; the app explicitly surfaced the reason and produced a finalized 600.101-second master. No Creator entitlement/account was available for this validation, and no entitlements were changed.
- **Collector correction:** the previous workflow waited until the full requested interval before diagnosing a missing Stop control. It now detects an inactive recorder at the next 60-second sample, records the visible app status and full diagnostics, and attempts to retain any finalized master present in IndexedDB. Failure summary device labels now use acquired track labels rather than the first enumerated device. These changes were syntax-checked; the new early-stop/retention branch was not exercised after the patch.
- An earlier failed headset summary displayed the first enumerated Realtek microphone. Sidecar evidence confirmed the captured audio track was the requested Bluetooth headset; summary extraction was corrected.
- No reproducible recording-engine quality defect was established. Preview callback cadence is a diagnostic observation only.

## 11. Evidence limitations

One Windows host, one Chrome version, one physical camera, and two microphone paths were tested. The scene, lighting, machine model/power mode, human picture/sound review, clap-based sync, full playback to completion, and alternate browser/OS coverage are absent. The 15-minute target was blocked by the Free allowance; the longest normal retained take was 570.628 seconds. Preview callbacks cannot establish encoded frame rate. The 600-second finalized master from the blocked run is represented by diagnostic metadata only, not a retained media file.

Automated regressions are software checks with fake media and are not hardware evidence. `npx tsc --noEmit` passed; `npm test` passed (55 files / 648 tests; 302 skipped by existing configuration); the targeted Chromium E2E suites passed (18/18). `npm run build` also passed from an isolated validation copy with its own `.next` output, leaving the running dev server undisturbed. Build output warned that `CASHFREE_SECRET_KEY` is missing and that the middleware filename convention is deprecated; neither blocked the build. Both Phase 7 collector scripts passed `node --check`, and `git diff --check` reported no whitespace errors.

## 12. Final classification

**YELLOW — current MediaRecorder behavior is promising, but production-quality evidence is incomplete.** Five repeat takes and two additional real captures (Bluetooth mic and 570-second long take) finalized consistently on the available Chrome setup; physical refresh recovery was playable; and no concrete recording-engine failure or quality defect was demonstrated. These results still do not establish excellent subjective quality, A/V sync, encoded frame pacing, full-duration playback, 15-minute operation, or broader device/browser consistency. Keep MediaRecorder. The smallest next phase is a human-review and sync-validation pass on the retained masters, plus a 15-minute run under a legitimate Creator allowance and the corrected collector. Do not change recording architecture without a reproducible engine limitation.

The validation-only package and exact local paths are under the ignored `.phase7b-validation/` directory. The files are local and are not part of normal product export or upload behavior.
