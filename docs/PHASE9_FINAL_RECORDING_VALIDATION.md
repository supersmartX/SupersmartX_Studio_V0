# Phase 9 — Final Recording Validation

Validation date: 2026-10-26. Host: Windows 10.0.26300 (x64), 15.4 GB RAM, 48.8 GB free disk at start. App: local Next.js dev server at `http://localhost:3000/studio`.

Method: real-browser runs against the real USB webcam and real onboard microphone, driven through Playwright persistent profiles with camera/microphone permissions granted. No fake-media flags were used. Browsers: Playwright Chromium 151.0.7922.34 and Microsoft Edge 156.0.4314.42. Media artifacts were read back from IndexedDB (`sxs-studio` v3) after finalization; container frame/audio-packet timestamps were parsed from the stored WebM blobs, and full-length audio was decoded in-browser where noted. Perceptual playback was not auditioned by a human, so perceptual checks are marked NOT TESTED rather than inferred from signal levels.

No application code, recording architecture, recovery logic, entitlements, export, schema, or infrastructure was changed during Phase 9.

## Executive Result

GREEN — engineering validation.

- Six real-hardware takes completed: a 35 s recovery take, two 18 s sanity takes, one 529 s take to the entitlement cap, and two short Edge takes (12.4 s and 4.5 s).
- Every start succeeded; every normal stop finalized; the entitlement-cap stop finalized automatically. No recorder or track error was observed in any run.
- Recovery after a hard refresh during recording succeeded with correct duration, intact metadata, playable video and audio, and no orphaned chunks.
- The longest legitimately available take (529 s, the remaining Free daily allowance) finalized, stored, and played back as a 264,287,337-byte WebM.
- No reproducible defect was found.
- This GREEN means the recording engine has enough evidence to be frozen from an engineering perspective. It does not mean perceptual studio quality, 30 fps capture, voice clarity, lip-sync, or general production readiness has been proven. Those are listed under Remaining Limitations.

## Real Hardware

| Run | Device | Browser | Duration | Result |
|---|---|---|---:|---|
| Recovery | USB2.0 FHD UVC WebCam (3277:0010) + Microphone Array (Realtek(R) Audio) | Chromium 151.0.7922.34 (Playwright) | 34.7 s | PASS — hard refresh mid-take; recording recovered and played |
| Sanity A | Same webcam and microphone | Chromium 151.0.7922.34 (Playwright) | 18.4 s | PASS |
| Sanity B | Same webcam and microphone | Chromium 151.0.7922.34 (Playwright) | 18.4 s | PASS |
| Long | Same webcam and microphone | Chromium 151.0.7922.34 (Playwright) | 529.0 s | PASS — automatic stop at remaining daily allowance |
| Edge take 1 | Same webcam and microphone | Microsoft Edge 156.0.4314.42 | 12.4 s | PASS for video/playback/metadata; audio track near-silent in this take |
| Edge take 2 | Same webcam and microphone | Microsoft Edge 156.0.4314.42 | 4.5 s | PASS — audio path confirmed with live-stream metering |

Only one physical camera/microphone setup was available. Chromium and Edge used the same physical devices; this is not a second hardware configuration.

Track settings observed on all runs: video 1920×1080 @ requested 30 fps, `exposureMode: continuous`, `whiteBalanceMode: continuous`, `colorTemperature: 4600`; audio 48 kHz, mono, 16-bit, `echoCancellation`, `noiseSuppression`, and `autoGainControl` enabled.

## Video

| Check | Result | Observation |
|---|---|---|
| Sharpness | PASS (sampled) | Face, eyes, hair, and clothing edges are legible at 1920×1080. The image is soft in low light. |
| Face clarity | PASS | Face remained clear and consistently framed in all 15 sampled frames across Chromium, Edge, and the long take. |
| Exposure stability | PASS | Luma mean across 9 Chrome frames: 153.16–158.33 (spread 5.17, ±1.7%); p5 60.6–64.6, p95 213.3–216.2. Continuous auto-exposure is active. No flicker observed in sampled frames. |
| Motion naturalness | NOT TESTED | Smoothness was not judged in real time by a human. Encoded frame cadence was measured instead (below). |
| Blocking / artifacts | PASS (sampled) | No blocking, tearing, or decode corruption visible in sampled frames. A blue cast (Chrome mean RGB ≈ 140–146 / 150–155 / 203–207) and low-light noise are present. Edge frames are more neutral. |
| Requested vs delivered frame rate | REDUCED (capture path) | Requested 30 fps; track settings report 30 fps. Parsed encoded cadence: Chromium 16.55–16.59 fps; Edge ≈ 9.96 fps. Cadence is steady, not bursty; no recorder-side frame loss was observed. |
| Frame continuity | PASS | Chromium frame gaps: p50 61–62 ms, p95 69–76 ms, maximum 70–88 ms. Long take: 8,758 frames over 528.978 s, no gap above 88 ms. |
| Playback | PASS | Review video reached `readyState 4`; no `error`, `waiting`, or `stalled` events during sampling; seeking to 10%, 50%, and 90% produced frames. |
| Duration correctness | PASS | Container span and stored duration agree within 0.1 s in every run. |
| Recorder / track errors | PASS | No recorder or track error events in any run; browser console contained only dev/HMR logs and the expected recovery `beforeunload` dialog. |
| Codec / container | PASS | `video/webm;codecs=vp9,opus` in every run; container reports VP9 + Opus, 1920×1080. |

Measured encoded frame counts: recovery 574 frames / 34.605 s; sanity A 304 / 18.289 s; sanity B 304 / 18.284 s; long 8,758 / 528.978 s; Edge 123 / 12.250 s.

## Audio

| Check | Result | Observation |
|---|---|---|
| Audio track present | PASS | Mono Opus track present in every file; track settings 48 kHz, echo cancellation / noise suppression / AGC on. |
| Voice clarity | NOT TESTED | No controlled speech source and no human auditioning. Signal presence is verified, intelligibility is not. |
| Clipping | PASS | Zero clipped samples (≥0.999) in full decodes: recovery peak 0.970, sanity A peak 0.434, Edge take 2 peak 0.119. |
| Static / noise character | NOT VERIFIED | No listening test or spectral analysis; cannot state "no static". |
| Dropouts | PASS (container level) | Audio packets arrive on a 60 ms cadence; maximum packet gap 79 ms across the 529 s take. Full decodes are continuous; long silent stretches correspond to a quiet room, not missing data. |
| A/V sync | NOT OBJECTIVELY MEASURED | Video and audio spans align within ≈0.1 s (recovery: video 34.605 s, audio 34.620 s, stored 34.737 s). No lip-sync measurement or listening test was performed. |
| Edge audio | PASS after repeat | First Edge take was effectively silent (full decode mean RMS 0.0001, peak 0.008, 122/123 windows below 0.0005). Repeat take metered the live stream at mean RMS 0.0115 / peak 0.120 and decoded to mean RMS 0.0087 / peak 0.119 / zero clipping. The silent take did not reproduce. |
| Microphone independence | PASS | Direct Edge `getUserMedia` metering outside the recorder produced signal (processed config mean RMS 0.029, peak 0.373), confirming the microphone and browser permission were live. |

## Long Recording

| Metric | Result |
|---|---|
| Requested duration | 529 s — the maximum remaining Free daily allowance at test time (`min(600 s per-take cap, 600 s daily − 71 s already used)`) |
| Actual duration | 529.049 s (08:49 in review UI) |
| Stop mode | Automatic at the allowance cap; UI showed “Recording stopped — device-local Free recording allowance reached for today” |
| Finalization success | Yes — recorder finalization 80 ms; review appeared ≈0.76 s after the cap tick |
| Playback success | Yes — seeks at 52.9 s, 264.5 s, and 476.1 s produced frames; no errors, waiting, or stalled events during sampled playback |
| File size | 264,287,337 bytes (252.0 MiB) |
| Resolution | 1920×1080 |
| FPS | 30 requested and reported by track settings; 16.56 fps measured in the encoded stream; intervals p50 62 ms, p95 71 ms, p99 78 ms, max 88 ms |
| Codec / MIME | `video/webm;codecs=vp9,opus`; container VP9 + Opus |
| Configured bitrate | 8,000,000 bps video; 128,000 bps audio |
| Browser-reported bitrate | Not available — MediaRecorder exposes no measured bitrate; the app's `actualVideoBitrate` field mirrors the negotiated configuration |
| Average file bitrate | 3,996,414 bps |
| Recorder errors | None |
| Track errors | None |
| Track continuity | 8,758 video frames and 8,815 audio packets; no video gap >88 ms or audio gap >79 ms |
| Entitlement outcome | Daily allowance reached exactly 600/600 s after the take. The separate 600 s per-take cap was not independently exercised → BLOCKED for that single scenario; the longest legitimately available take PASSED |

## Recovery

| Check | Result |
|---|---|
| Recovered recording exists | PASS — one master `rec-mvpho21h-k9zim6`, name “Recovered recording”; sessions 0, chunks 0 after adoption |
| Duration reasonable | PASS — 34.737 s stored; video span 34.605 s; audio decoded 34.620 s; 35.343 s wall recording time |
| Video plays | PASS — 574 encoded frames, 6 keyframes; frames sampled at 3.5 s, 17.4 s, 31.3 s |
| Audio plays | PASS — full decode mean RMS 0.0458, peak 0.970, zero clipped samples |
| No obvious corruption | PASS — WebM parses cleanly; both tracks present and aligned; no decode or playback error |
| A/V sync acceptable | NOT OBJECTIVELY MEASURED — track endpoints within ≈0.1 s; no lip-sync/listening test |
| Metadata intact | PASS — profile `1080p30`, requested/actual 1920×1080@30, deviceId, MIME, configured/actual video 8 Mbps, audio 128 kbps, duration, fileSize, average bitrate all preserved |
| Recovery errors | None — reload 239 ms, recovery toast shown, budget charged 35 s after save |

The app intentionally prefers an already-restored master over a new pending session, so this test was run first on a clean profile. That behavior is by design and was not changed.

## Second Configuration

| Device | Browser | Result |
|---|---|---|
| Same USB webcam + Realtek microphone | Microsoft Edge 156.0.4314.42 | PASS — 12.4 s take, 1920×1080 VP9/Opus WebM, playback and metadata correct, no errors; encoded cadence ≈9.96 fps |
| Same USB webcam + Realtek microphone | Microsoft Edge 156.0.4314.42 | PASS — 4.5 s audio-confirmation take; live stream and recorded audio both carried signal, zero clipping, no errors |
| No second physical camera/microphone, Safari, or mobile browser | — | UNAVAILABLE |

The first Edge take's near-silent audio was not reproduced on the second Edge take or on direct microphone metering, so it is recorded as an observation, not a defect.

## Start / Stop Reliability

| Run | Start | Stop/Finalize | Result |
|---|---|---|---|
| Recovery | Start accepted; recorder startup 179 ms | No normal stop — hard reload mid-take; recovery adopted in 239 ms | PASS |
| Sanity A | 4.379 s wall (1.125 s capture acquisition + 3 s countdown); recorder 147 ms | 544 ms stop→review; recorder finalization 39 ms | PASS |
| Sanity B | 5.731 s wall (2.476 s capture acquisition + countdown); recorder 150 ms | 532 ms stop→review; finalization 41 ms | PASS |
| Long | 5.361 s wall (2.097 s capture acquisition + countdown); recorder 178 ms | Automatic stop at 529 s allowance; review ≈0.76 s later; finalization 80 ms | PASS |
| Edge take 1 | 3.237 s wall (includes countdown); recorder 234 ms | 775 ms stop→review; finalization 33 ms | PASS |
| Edge take 2 | 6.229 s wall (2.892 s capture acquisition + countdown); recorder 297 ms | 645 ms stop→review; finalization 49 ms | PASS |

- All six starts succeeded on the first click; no run required a retry.
- Stop is a deliberate two-click arm within 3 s by design; every two-click stop finalized. No stuck state, double finalize, or lost take occurred.
- Startup wall time is dominated by camera acquisition (1.1–2.9 s) plus the 3 s countdown; recorder startup itself stayed 147–297 ms.
- Finalization to review stayed 532–775 ms; recorder finalization itself stayed 33–80 ms.
- No recorder or track error occurred in any run.

## Reproducible Defects

None found.

Observations that were explicitly checked and are not reproducible defects:

- **First Edge take near-silent audio.** Not reproduced on the second Edge take, with live-stream metering, or with direct microphone capture. Treated as environment/quiet-room behavior; no code change warranted.
- **Delivered frame rate below requested.** Track settings report 30 fps, but the encoded stream measured 16.55–16.59 fps in Chromium and ≈9.96 fps in Edge on this 1080p USB2 camera. Cadence was stable and no frames were missing in bursts; this is a capture-path/hardware behavior, not a recorder failure. The app's `actualFps` metadata reflects track settings, not measured delivery.
- **Long-take preview render callbacks dropped.** During the 529 s take the preview observer fell to 9.5 fps with a 1.06 s maximum callback gap, while the encoded recording held 16.56 fps with an 88 ms maximum frame gap. This is a preview/compositor effect in the automated window, with no recorded-media impact.
- **Native WebM duration is `Infinity`.** The review `<video>` reports Infinity for all WebM takes; the app displays and seeks using the stored duration (08:49 for the long take, 00:34 for recovery, 00:18 for sanity takes). No user-facing duration error was observed.

## Remaining Limitations

**Verified**
- Real 1920×1080 capture and real microphone capture through Chromium and Edge on this host.
- Playback, seeking, stored duration, metadata, and average bitrate for 18 s, 34.7 s, and 529 s recordings.
- Automatic entitlement-cap stop at 529 s, with the Free daily counter reaching 600/600 and no budget bypass.
- Hard-refresh recovery adoption with clean session/chunk cleanup.
- Start/stop/finalize timing and absence of recorder/track errors across six takes.
- Container-level audio continuity (60 ms packet cadence, max gap 79 ms over 529 s) and zero clipped samples in decoded audio.

**Unavailable**
- A second physical camera/microphone setup, Safari, and mobile browsers. Edge used the same hardware.
- A Creator/unlimited account.
- Browser-reported encoded bitrate (not exposed by MediaRecorder).

**Not tested**
- Human-perceived voice clarity, intelligibility in a real speaking scenario, static/noise character, and naturalness of motion.
- Objective A/V lip-sync.
- The 30 fps target: measured delivery was 16.6 fps in Chromium and 10 fps in Edge at 1080p.
- Device switching, microphone mute, camera loss mid-take, background-tab recording, multiple tabs, and OS sleep.
- Export, R2 upload, authentication, entitlements beyond the Free daily cap, and payment flows — explicitly out of Phase 9 scope.
- Long-term IndexedDB quota behavior for multiple 250 MB masters.

**Blocked by entitlement**
- A single 600 s take. At test time only 529 s of the 600 s Free daily allowance remained; the 600 s per-take cap was not separately exercised. No entitlement code was modified.

**Hardware unavailable**
- Any camera/microphone other than the USB2.0 FHD UVC webcam and Realtek microphone array. The “Camera (NVIDIA Broadcast)” virtual device was enumerated but not used as a second physical configuration.
- Hardware evidence of 30 fps at 1080p on this camera. Measured delivery was lower despite the 30 fps track setting.

**Other observed quality limitations**
- Low-light softness/noise and a blue color cast in Chromium takes; Edge take frames were more neutral.
- A 529 s 1080p take produces ≈252 MiB in browser storage; this validated for one recording but was not stress-tested across many large masters.

## FINAL ARCHITECTURE DECISION

KEEP MEDIACRECORDER

No reproducible defect demonstrated that the recording architecture is insufficient. MediaRecorder, the codec ladder, profiles, adaptive bitrate, IndexedDB master storage and recovery, review flow, export, R2, auth, entitlements, payments, and UX remain unchanged. The recording engine should now be frozen from an engineering perspective; remaining gaps are perceptual validation and hardware/capture-path delivery, not recorder architecture.
