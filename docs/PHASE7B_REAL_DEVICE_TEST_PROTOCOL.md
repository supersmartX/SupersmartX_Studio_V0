# Phase 7B — Real-Device Test Protocol

## Purpose and limits

Use one repeatable procedure to measure capture behavior on physical devices. This protocol does not assign a quality score, infer encoded FPS from track settings, or claim synchronization from bitrate or duration. Record unavailable values as `unavailable`. Do not change the `MediaRecorder` architecture or recording/export/privacy behavior during validation.

The Phase 7B baseline is the physical Windows + Chrome + USB webcam + Realtek microphone setup described in [PHASE7_REAL_HARDWARE_RESULTS.md](./PHASE7_REAL_HARDWARE_RESULTS.md). Its previous capture was automated and was not manually reviewed.

The guarded development-mode collector can retain physical masters locally for review. For five ~30-second baseline takes, run `SXS_RUN_REAL_HARDWARE=1 node scripts/phase7/collect-repeat-summary.mjs --runs=5 --duration-seconds=30 --retain-dir=.phase7b-validation/baseline-5`. To select an available camera or microphone by its exact visible label, add `--camera-label="..."` or `--microphone-label="..."`; the report records the acquired track label, not merely the first enumerated device. The tool creates a fresh disposable browser context per run, copies the exact local master Blob to the ignored retention directory, verifies byte size, and writes a metadata sidecar, `manifest.json`, and `HUMAN_REVIEW.md`. These copies remain local and do not change the product export/privacy flow.

For a normal long capture with retention, use `SXS_RUN_REAL_HARDWARE=1 node scripts/phase7/collect-real-hardware.mjs --duration-seconds=570 --retain-dir=.phase7b-validation/long-under-cap`. The collector samples recording/recovery/runtime state every 60 seconds. If the recorder becomes inactive before the requested interval, it records a failure snapshot with visible UI status, track/recorder state, master metadata and recovery state, and attempts to retain any completed master still present in IndexedDB. `--recovery-refresh --retain-dir=...` performs the physical refresh/recovery path and attempts playback and local retention. Validation output is ignored by Git.

The app's anonymous Free plan is capped at 600 seconds per day on the tested setup. A 15-minute test requires a legitimate account/entitlement that permits it; do not bypass or alter entitlements to simulate longer access. A 600-second cap reached is an environment blocker for the 15-minute acceptance criterion, even when the capped recording finalizes successfully. The automated collectors do not control the scene or produce a clap marker, so the human-review and sync procedures below are still required.

## Before a test session

1. Use a disposable browser profile or a dedicated test browser context, not a profile containing important unsaved recordings.
2. Record date, run IDs, machine make/model/class, OS version, app commit/build, browser/version, power source/power mode, camera, microphone, room, lighting, and scene. Omit device IDs from shared reports.
3. Close video-call, camera, and audio apps that could claim the devices. Connect power for long runs. Keep the browser tab foreground for baseline runs.
4. In Studio, select the intended camera and microphone. Grant permissions. Confirm labels after permission and verify the app preview visibly uses the selected camera. A default device is not evidence of a requested selection.
5. Keep settings constant for a repeated-run group: profile, camera, microphone, framing, distance, lighting, room, scene, and speech level.

## Standard capture procedure

For every run:

1. Start Studio and wait for camera/microphone initialization to complete.
2. Select and record the intended camera and microphone labels. Verify selected IDs internally if needed, but do not publish IDs.
3. Record requested constraints/profile and actual video/audio `MediaStreamTrack.getSettings()` before starting. Record actual profile separately from selected/requested profile.
4. Start recording and note start-request and recorder-start timestamps. Use the same countdown setting for all repeated runs.
5. Record the controlled scene for the duration defined by the test. For the baseline, use a 30-second talking-head scene with normal speech, stable framing, and consistent indoor lighting. Include visible fine detail and moderate head/hand motion within the same take.
6. Stop normally. Wait for finalization and local IndexedDB save to complete. Record any recorder, track-ended, or recovery-write diagnostic event.
7. Keep the master recording in the app's local library for review. Do not upload it or send its bytes to a service. Open it in Review and verify it plays to completion. Record playback/export observations separately; export is optional and only to a local destination when the tester explicitly wants a file.
8. Inspect app metadata and the development diagnostics export. Capture requested/actual profile, actual dimensions/FPS, MIME/codecs, configured and browser-reported bitrates, file size, duration, whole-file average bitrate, startup/finalization, track-ended/errors, and recovery state. Strip device IDs before sharing.
9. Review the same recording for picture and sound using the rubric below. Record evaluator, conditions, category, and a short reason. Do not manufacture numerical scores.
10. Repeat from step 1 without changing the setup. Assign a new run ID.

## Minimum repeatability set

Run five approximately 30-second takes on the baseline setup. Do not switch device, browser, profile, room, lighting, framing, or scene between takes. Compare actual geometry/FPS, MIME, reported bitrates, size, duration, startup, and finalization. File average bitrate is whole-file data, not encoded video bitrate. A difference is not automatically a failure; investigate only reproducible behavior inconsistent with the device/browser's delivered settings or the acceptance criteria.

## Human review rubric

Use `Excellent`, `Good`, `Acceptable`, `Problematic`, or `Not reviewed` for each dimension, with a concise explanation. Ratings are subjective observations, not quality scores.

**Video:** inspect eyes/hair/skin/printed text/fine patterns for sharpness; moderate motion for stutter/smearing; bright/dark areas for clipping or exposure pumping; skin and neutral objects for color/white-balance shifts; and fine detail for blockiness, mosquito noise, ringing, or detail loss.

**Audio:** listen to normal and soft speech, and any controlled noise portion. Note clarity, background noise, distortion/clipping, gain/noise-suppression pumping, and voice consistency. Do not claim absence of defects from waveform presence alone.

## A/V sync procedure

Use a clearly visible and audible clap near the start, at approximately 30 seconds, 5 minutes, and 15 minutes in the applicable runs. Clap in frame, close enough to the camera that the hand contact is visually clear; keep the clap within normal microphone range. Review the resulting recording and compare the visible contact frame with the sound transient. If frame/audio presentation timing can be measured reproducibly, record method and uncertainty with the observed offset. Otherwise report only `No obvious sync drift observed` or the qualitative problem. Do not invent a numeric offset.

Run sync checks on a ~30-second baseline and on the 5- and 15-minute captures. This protocol does not infer sync from the presence of tracks or their nominal durations.

## Long recording and recovery

On the baseline hardware, run one 5-minute and one 15-minute foreground recording. Monitor local backup state, chunk/session writes, recorder and track errors, continuity, browser resource behavior, finalization, duration, playback, review, and local export if desired. Record memory observations only from a named measurement source; do not estimate from impressions.

Using disposable test data, separately test: (A) refresh after multiple confirmed backup writes and verify recovered duration/playback/review; (B) background the tab for a defined interval, return, and stop normally; (C) disconnect camera only if safe; (D) make microphone unavailable only if safe. Do not test disruptive recovery on an important recording or primary profile. Record the event and outcome, including whether the app reports the missing track honestly.

## Device and browser matrix

Test only hardware and OS/browser combinations actually available. Record exact available devices rather than filling unavailable rows with assumptions. After the baseline, prioritize integrated laptop camera/mic, USB camera + USB mic, a second Windows machine, lower-powered hardware, and macOS where available. Compare Chrome, Edge, Firefox, or Safari only where installed and supported.

## Evidence record

For each run record: run ID/date; device/OS/browser/build; selected camera/microphone; requested and actual profile; constraints and actual track settings; container/MIME/codecs; configured/reported bitrates; duration, size, average whole-file bitrate; startup/finalization; preview callback metrics (clearly labeled); recovery-write errors/session outcome; playback/review/export; human video/audio observations and evaluator; sync method/result; and any notes. Store metrics only in the report; keep raw media local to the browser unless a tester intentionally chooses a local export for review.

## Problem classification

- **P0:** recording fails or recording is lost.
- **P1:** severe A/V desynchronization, severe repeatable frame instability, severe audio corruption, or repeated finalization failure.
- **P2:** reproducible unexpected quality degradation, incorrect profile selection, unnecessary low resolution, or unexplained bitrate behavior.
- **P3:** minor browser/device inconsistency or diagnostic issue.

Classify only reproducible issues supported by evidence. A device-specific lower resolution/FPS is not inherently a failure if the app reports it honestly and the recording is stable and usable.
