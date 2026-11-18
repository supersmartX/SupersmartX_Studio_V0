# Phase 8 — Real-World Recording Quality Validation

**Classification: RED for the reviewed capture conditions; root cause unresolved.** This is a finding about these retained captures, not a universal claim about every device or session. The observed recordings repeatedly decode at about 9.96 fps despite 30 fps track settings, and representative video samples are near-black. The samples therefore fail a basic usable-picture check, while the cause (scene, camera state, browser/device path, or capture conditions) was not isolated. Audio quality and A/V sync remain unrateable because the captures contain no controlled speech or sync marker.

## Executive Result

- Reviewed 11 retained masters: five repeat baseline takes, headset-mic take, short headset verification, 570-second long take, refresh-recovery take, smoke take, and one new Edge Studio take. Also inspected two standalone `getUserMedia` + `MediaRecorder` controls outside Studio.
- All reviewed masters decode as WebM VP9/Opus at 1920×1080. Their video tracks report 30 fps, but decoded cadence is approximately 9.94–9.98 fps. The five baseline runs cluster at 9.957–9.959 fps; the long run is 9.960 fps; Edge Studio is 9.959 fps.
- Sampled frames from baseline, long, recovery, standalone Chrome/Chromium, and standalone Edge masters are near-black or black. A few sampled middle frames from the long file contain low-level non-black pixels; this does not establish a usable image.
- Standalone capture outside Studio reproduced the same ~9.96 fps cadence on the same machine and physical camera. This reduces evidence for a Studio-specific recorder cause but does not identify the upstream cause.
- The 570.628-second capture completed and fully decoded. The requested 900-second capture remains blocked at the Free plan's 600-second device-local allowance; it was not treated as a recorder failure.
- Refresh recovery produced a decodable 2.102-second VP9/Opus recording, but its sampled frames are black. Recovery of data is observed; useful recovered picture is not established.
- No production application code or recording architecture was changed. MediaRecorder remains the architecture decision because evidence does not localize the cadence or black-frame result to Studio.

## Test Matrix

| Device | OS | Browser | Camera | Mic | Runs | Result |
|---|---|---|---|---|---:|---|
| Windows test machine | Windows 11 Home Single Language | Chrome 151 | USB2.0 FHD UVC WebCam | Realtek Microphone Array | 8 Studio masters, including five repeats and 570 s run | All decoded; ~9.96 fps; samples black/near-black |
| Windows test machine | Windows 11 Home Single Language | Chrome 151 | USB2.0 FHD UVC WebCam | CMF Neckband Pro Bluetooth mic | 2 Studio masters | Decoded; ~9.96 fps; no controlled voice sample |
| Windows test machine | Windows 11 Home Single Language | Edge 156.0.4314.58 | USB2.0 FHD UVC WebCam | Realtek Microphone Array | 1 Studio master | 30.73 s; 9.959 fps; sampled visual result near-black |
| Windows test machine | Windows 11 Home Single Language | Chromium version unavailable | USB2.0 FHD UVC WebCam | Realtek Microphone Array | 1 standalone control | Outside Studio; 199 frames / 198 intervals over 19.872 s = 9.964 fps |
| Windows test machine | Windows 11 Home Single Language | Edge 156.0.4314.58 | USB2.0 FHD UVC WebCam | Realtek Microphone Array | 1 standalone control | Outside Studio; 199 frames / 198 intervals over 19.869 s = 9.965 fps |

The standalone controls used the physical camera and microphone through a video element and MediaRecorder without Studio. They help compare the path but do not prove the hardware, driver, lighting, foreground state, or browser is the cause.

## Video Quality

| Test | Result | Rating | Evidence |
|---|---|---|---|
| Sharpness, fine detail, face clarity, color/skin, framing | Not assessable from sampled black/near-black frames; no controlled subject/scene | FAILED for usable-picture check; detail criteria unrateable | Representative frame samples from baseline, long, recovery, standalone, and Edge files |
| Exposure, clipping, shadow detail, noise | Sampled frames provide no usable scene; exact cause unresolved | FAILED for usable-picture check | Pixel/luma sample metrics in `.phase7b-validation/phase8-review/inventory.json` |
| Compression/blocking | Decode succeeds, but black samples cannot show compression quality | Not rateable | VP9 files independently decoded with PyAV |
| Motion smoothness, frame pacing, stutter | About 9.96 decoded fps versus reported 30 fps; median interval 96–98 ms, p95 about 111–117 ms | POOR in reviewed files | Full decoded frame timestamp analysis |
| Overall video | Reviewed captures do not demonstrate a consistently usable image | FAILED for this capture set | Near-black samples and repeated low decoded cadence; cause not localized |

Frame counts and timestamp spans were independently decoded with PyAV. Representative frame montage and per-file measurements are retained in `.phase7b-validation/phase8-review/`; the directory is ignored by Git and contains local validation media. Structured per-recording metadata is in [PHASE8_RECORDING_INVENTORY.csv](./PHASE8_RECORDING_INVENTORY.csv).

## Audio Quality

| Test | Result | Rating | Evidence |
|---|---|---|---|
| Voice clarity and intelligibility | No controlled speech was recorded | NOT RATEABLE | Captures contain mono 48 kHz Opus; decoded audio does not establish speech quality |
| Noise, static, Bluetooth artifacts, loudness, dropouts | No controlled speaking/noise stimulus; baseline/headset levels mostly very quiet | NOT RATEABLE | Audio decode metrics; no controlled A/B speech material |
| Clipping | Long capture showed no clipped samples; this does not establish voice quality | No clipping observed in analyzed long sample | RMS about -41.84 dBFS, peak -5.79 dBFS |
| A/V alignment | No controlled marker | NOT RATEABLE | No sync measurement available |
| Overall audio | Track presence and decode verified; subjective audio quality not established | NOT RATEABLE | No speech-quality review possible from these samples |

## A/V Synchronization

| Run | Sync Result | Classification |
|---|---:|---|
| All retained takes | Not measured; no controlled simultaneous visible/audible marker | Not classified |

None of the retained recordings contains a controlled simultaneous visible and audible clap/slate marker. No offset in milliseconds is claimed. The required three short marker takes and manual comparison remain outstanding.

## Long Recording

| Metric | Result |
|---|---|
| Requested duration | 900 seconds |
| Longest retained run | 570.628 seconds, completed and decoded |
| Decoded video | 5,682 frames over 570.403 seconds; 9.960 fps; 1920×1080 VP9 |
| File size | 131,928,718 B |
| Startup / finalization | 259 ms / 145 ms |
| Recorder / track errors | None logged |
| 900-second test | **BLOCKED** at 600.101 seconds by Free plan device-local allowance; finalized at entitlement stop |

This entitlement limit is not evidence of a 15-minute encoder failure. Entitlements were not bypassed or modified.

## Startup / Finalization

| Run | Start | Finalization | Result |
|---|---:|---:|---|
| Baseline 1 | 155 ms | 65 ms | Completed |
| Baseline 2 | 277 ms | 133 ms | Completed |
| Baseline 3 | 249 ms | 119 ms | Completed |
| Baseline 4 | 253 ms | 53 ms | Completed |
| Baseline 5 | 259 ms | 54 ms | Completed |
| Headset mic | 352 ms | 49 ms | Completed |
| Long run | 259 ms | 145 ms | Completed |
| Edge Studio | 201 ms | 31 ms | Completed |
| Baseline median / slowest | 253 / 277 ms | 65 / 133 ms | No recorder errors logged |

Measurements are from the local collector and do not establish broader performance guarantees.

## Recovery

| Test | Result |
|---|---|
| Refresh-interrupted capture | Recovered 2.102 s, 79,116 B WebM VP9/Opus; 20 frames decoded over 1.912 s; player advanced without media error |
| Picture/audio content | Sampled video frames black; no controlled speech or sync test, so useful content and sync are not established |
| Playback | Container and video decode succeeded; full playback and speech quality were not verified |

## Failures

- **Reproducible in this setup:** independently decoded cadence is ~9.96 fps across five baseline Studio masters, a 570-second Studio master, the Edge Studio master, and standalone Chrome/Edge controls. These files contradict 30 fps track reports. This identifies an output symptom but does not localize its cause.
- **Reproducible in retained samples:** representative frames from the reviewed groups are black/near-black. Since no controlled visible scene was confirmed, this documents unusable output in this sample set; it does not establish why.

## Limitations

- **Observed:** ~9.96 fps decoded cadence in repeated Studio runs and independent standalone Chrome/Edge controls while track settings report 30 fps.
- **Observed:** sampled video is black/near-black across several recording groups.
- **Unresolved:** no controlled foreground, well-lit live scene was confirmed. The computer-use native pipe was unavailable, so the actual foreground preview and unobstructed camera view could not be inspected. Browser `visibilityState=visible` is not proof that the window was physically foregrounded.
- **Unresolved:** no speech script, audible/visible marker, second physical camera, second computer, Firefox, Safari, or macOS test.
- **Blocked by plan limit:** 900-second capture; no entitlement workaround attempted.
- The Chromium version for the standalone Chromium control was not present in its run record and is marked unavailable in the source controls.

## Architecture Decision

**Keep MediaRecorder and the current recording architecture.** The same low decoded cadence occurs in standalone controls outside Studio on the same setup. That evidence does not justify replacing MediaRecorder, adding WebCodecs, or changing the recording engine. No root cause has been isolated, so no production-code fix is justified in this phase.

## Recommendation

Run a controlled, human-present follow-up on the same device: put a well-lit detailed scene in view, physically confirm the camera is unobstructed, keep the Studio window foregrounded, and verify the live preview before recording. Retain three short video/speech takes and three simultaneous clap/slate takes; manually rate the 15 video and 10 audio dimensions and measure sync from the retained files. If the ~10 fps cadence persists under those conditions, then trace camera/driver/USB and browser capture delivery with fresh evidence before considering a minimal fix. Keep the 900-second test blocked until a legitimately entitled environment is available.

