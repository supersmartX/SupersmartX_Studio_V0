# Phase 7 — Real Hardware Results

## Executive Summary

**One real-device setup completed an automated recording; consistency and subjective excellence are not proven.** On Windows, Studio captured a 33.67-second WebM recording using a USB2.0 FHD UVC webcam and the Realtek microphone array in Chrome 151.0.7922.34. The file was approximately 7.25 MB. This is evidence that this camera/microphone/browser combination can produce a recording in this run.

It does not establish repeatability, broad device compatibility, subjective video/audio quality, encoded frame rate, lip sync, recovery reliability, or long-recording stability. The automated run also showed low preview callback cadence despite the camera track reporting 30 fps. Preview callbacks are not encoded frames, and this observation needs a foreground manual repeat before drawing a product conclusion.

**Engine classification: YELLOW — provisional.** This capture does not justify replacing the existing `MediaRecorder` architecture. More representative repeated hardware results are required before claiming consistently excellent output.

## Devices and Environment

| Setup | Camera | Microphone | Browser/OS | Status |
|---|---|---|---|---|
| Physical run 1 | USB2.0 FHD UVC WebCam | Realtek Microphone Array (default input) | Chrome 151.0.7922.34 on Windows 10 | One recording completed |

The operating system also exposed a CMF Neckband Pro hands-free endpoint, but it was not selected or validated in this run. Device identifiers are intentionally omitted.

## Capture Results

| Run | Requested / selected profile | Track-reported settings | Container / codecs | Duration | File size |
|---|---|---|---|---:|---:|
| Physical run 1 | 1920×1080 at 30 fps / 1080p30 | 1920×1080, 30 fps, user-facing | WebM, VP9 video + Opus audio | 33.67 s | 7,253,738 bytes (~7.25 MB) |

The recording was started by the headed Playwright hardware runner in a fresh browser context, without fake-media flags. It is a real physical-device capture, but it is an automated run rather than a user study or a controlled subjective quality review.

## Bitrate Results

| Run | Video bitrate configured / browser reported | Audio bitrate configured / browser reported | Whole-file average |
|---|---:|---:|---:|
| Physical run 1 | 8,000,000 / 8,000,000 bps | 128,000 / 128,000 bps | ~1,723,490 bps |

The whole-file average includes audio and container overhead. It is not the encoded video bitrate and does not establish perceived quality.

## Reliability and Timing

| Run | Combined camera/mic acquisition | Recorder startup | Finalization | Errors observed |
|---|---:|---:|---:|---|
| Physical run 1 | 1,873 ms | 155 ms | 101 ms | None reported in this capture |

Separate camera and microphone acquisition latencies are unavailable because the app acquires both tracks in one `getUserMedia` call. Recovery, refresh recovery, device interruption, and long-duration behavior were not tested.

## A/V Duration

The recorder and persisted master recording metadata reported 33.67 seconds. Mediabunny parsed the output dimensions and codecs, but its metadata duration values were unavailable in this run. No separate audio/video track duration comparison or lip-sync measurement was obtained, so A/V synchronization is **unverified**.

## Quality Observations

- Camera track settings reported 1920×1080 at 30 fps.
- The development diagnostic observed approximately 7.74 preview callbacks per second across 287 callbacks, with 285 timing gaps, a maximum gap of approximately 1,027.9 ms, and 82 presented-frame jumps.
- These are preview scheduling observations, not an encoded-frame count or proof of dropped recording frames. Browser automation and page scheduling may affect them; repeat with the tab foreground under manual operation.
- No blinded or structured evaluator reviewed sharpness, exposure, color, motion, speech clarity, noise, clipping, or sync. “Excellent” quality is not established.

## What This Proves — and Does Not

This run proves that one physical webcam + microphone + Windows + Chrome setup produced a recording Blob and that the browser reported the requested track and recorder settings for this run. It does not prove that a person reviewed playback quality.

It does not prove:

- consistency across repeated takes or across real users' devices;
- that the recorded video contains 30 encoded frames per second;
- excellent image or audio quality, or accurate A/V sync;
- compatibility with built-in cameras, older laptops, USB/Bluetooth microphones, other browsers, or operating systems;
- recovery after refresh/crash/device loss or stable 5/15-minute recording.

## Next Evidence Needed

Five approximate repeat captures are now recorded in [PHASE7B_REAL_DEVICE_RESULTS.md](./PHASE7B_REAL_DEVICE_RESULTS.md). Remaining evidence: manually retain and review the recordings, run visible/audible sync checks, complete selected 5- and 15-minute captures and physical recovery scenarios, then test additional device/browser combinations. Keep device labels private or anonymize them in shared exports. Only make a consistency claim after results span multiple independent device setups and repeat runs with defined acceptance criteria.
