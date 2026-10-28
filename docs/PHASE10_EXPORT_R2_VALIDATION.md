# Phase 10 — Export, Local Master, and R2 Delivery Validation

Validation date: 2026-10-27 local (runs timestamped 2026-10-26 18:33–19:00 UTC). Host: Windows 10.0.26300 (x64). App: local Next.js dev server at `http://localhost:3000/studio`. Browsers: Playwright Chromium 151.0.7922.34 and Microsoft Edge 156.0.4314.42, persistent profiles with the Phase 9 recordings.

Method: real-browser exports driven through the actual export dialog, using the four Phase 9 masters still stored in IndexedDB (35 s recovered, two 18 s sanity takes, 529 s long take, two Edge takes). Each exported MP4 was downloaded, served back to a video element, and checked for container markers, duration, dimensions, a decoded frame, the watermark region, and a full-length audio decode. Source WebM blobs were also read back from IndexedDB and fully decoded so export audio could be compared with the source rather than judged in isolation. No entitlements were bypassed, no R2 write was attempted, and the recording engine was not touched.

Application code changed in this phase: two source files and two test files, all for the one defect in `## Reproducible Defects`. The export encoder, entitlements, watermark renderer, storage schema, and R2 routes were not modified.

## Executive Result

GREEN for the Free/local export path. R2 delivery is BLOCKED, not failed.

- Five real exports completed end-to-end in two browsers (three in Chromium, two in Edge). Every output was a valid MP4 (`ftyp`/`moov`/`mdat`, `avc1`, `mp4a`) at 1280×720 with the Free-plan watermark, the expected duration, audio, and a saved 7-day local-export record.
- The 529 s master exported in 339 s to 352,733,553 bytes, was stored in IndexedDB, downloaded with the same byte count, and played back at 528.978 s.
- Export audio matches the source within measurement tolerance: mean RMS changed by −0.07% (long), −0.19% (recovered), −1.5% (near-silent Edge take), and −0.14% (audible Edge take). Peaks and clipping counts match the source; the 3 clipped samples in the long export are present in the long source too.
- One reproducible defect was found and fixed: the Library's "Saved exports" list did not refresh after an export completed while the Library stayed mounted. It now updates immediately; regression test added and verified in Chromium and Edge.
- R2/cloud delivery could not be exercised: the available session is guest/Free, and the local environment has no R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` are empty). Free is refused at the presigned-upload route before any storage call. No shared-system write was attempted.
- This result does not prove Creator export, watermark-free output, 1080p export, real R2 upload/download, or production network behavior. Those remain listed under `## Remaining Limitations`.

## Local Export Pipeline

All runs used the Library "Export" action and the real export dialog. Free plan resolves to YouTube 16:9, 1280×720, watermark required, local-only storage.

| Run | Source duration | Source size | Browser | Export wall time | Output size | Output bitrate | Result |
|---|---:|---:|---|---:|---:|---:|---|
| Recovered | 34.737 s | 17,270,473 B | Chromium 151 | 29,369 ms | 23,159,858 B | 5.35 Mbps | PASS |
| Long | 529.049 s | 264,287,337 B | Chromium 151 | 339,013 ms | 352,733,553 B | 5.33 Mbps | PASS |
| Sanity B | 18.384 s | 9,153,249 B | Chromium 151 | 14,866 ms | 12,312,261 B | 5.38 Mbps | PASS |
| Edge take 1 | 12.369 s | 3,922,649 B | Edge 156 | 6,745 ms | 4,886,549 B | 3.17 Mbps | PASS |
| Edge take 2 | 4.535 s | 725,601 B | Edge 156 | 3,199 ms | 1,060,703 B | 1.90 Mbps | PASS |

Common output properties:

| Check | Result |
|---|---|
| Dimensions | 1280×720 in all five outputs (1920×1080 masters correctly downscaled to the Free cap) |
| Container / codecs | MP4 `isom`; `ftyp`, `moov`, `mdat`, `avc1`, `mp4a` present; first bytes `0000001c6674797069736f6d00000200` |
| Dialog result | "Video exported", platform caption "YouTube · 1280 × 720 · HD" |
| Watermark | Present bottom-right in every output; readable "SupersmartX" text with dark backing |
| Local export record | Created for every run with `expiresAt = createdAt + 7 days` |
| Page / console errors | None (`pageErrors: []`; only React DevTools and HMR logs) |

The export dialog targets 10 Mbps video + 192 kbps audio, but the encoder delivered 1.9–5.4 Mbps depending on source motion and content. This is an encoder undershoot, not a correctness failure: the files decode cleanly and durations match. The long output is larger than its 252 MiB WebM source because the export is a fixed-bitrate H.264/AAC re-encode with the watermark added, not a remux.

## Long Master Export

| Metric | Value |
|---|---|
| Source | Phase 9 long master: 529.049 s, 1920×1080, 264,287,337 B (252.0 MiB), VP9/Opus |
| Export wall time | 339,013 ms (5 m 39 s; 0.64× realtime) |
| Output | 1280×720, 528.978 s, 352,733,553 B (336.4 MiB), 5.33 Mbps average |
| Duration delta | −71 ms versus stored master duration (0.013%); well inside the max(1 s, 1%) tolerance |
| Audio | 48 kHz mono AAC; mean RMS 0.012814, peak 1.003466, 3 clipped samples, longest quiet window 25.7 s |
| Watermark | Verified in a bottom-right 440×140 crop (mean luma 130.4, max 218.7; text visually confirmed) |
| IndexedDB | Row `local-1793040036529-ejbq`, 352,733,553 B, `createdAt 2026-10-26T18:40:36.556Z`, `expiresAt 2026-11-02T18:40:36.556Z` |
| Download | `supersmartx-recording-2026-10-26_00-10-37.mp4`, 352,733,553 B (exact match), success toast shown |
| Playback of downloaded file | `readyState 4`, 1280×720, 528.978 s, no decode errors |

The long take's 25.7 s quiet stretch and 3 clipped samples are properties of the source, not the export: the source decode shows the same 25.7 s longest silence, peak 1.003477, and 3 clipped samples.

## Download Integrity

| Artifact | Bytes reported by export | Bytes downloaded | Check |
|---|---:|---:|---|
| Recovered (dialog) | 23,159,858 | 23,159,858 | Exact |
| Long (dialog) | 352,733,553 | 352,733,553 | Exact |
| Sanity B (dialog) | 12,312,261 | 12,312,261 | Exact |
| Sanity B (Library row) | 12,312,261 | 12,312,261 | Exact; SHA-256 `be7a4c8d…a26a0f1` identical to the dialog download |
| Edge take 1 (dialog) | 4,886,549 | 4,886,549 | Exact |
| Edge take 2 (dialog) | 1,060,703 | 1,060,703 | Exact |

- Dialog downloads are named `supersmartx-recording-<date>_<time>.mp4`; Library downloads are named `<platform>-<width>x<height>.mp4`.
- Library download of the sanity B export produced a byte-identical file to the dialog download (`cmp` clean, matching SHA-256).
- The downloaded long file was served back over local HTTP with Range support and decoded successfully, so the saved artifact — not just the in-memory blob — is valid.
- Delete on a Library export shows the inline "Delete this export?" confirmation; cancelling leaves the row and its blob intact (verified, three rows still present).

## Source vs Export Fidelity

Full-length audio decode of the stored WebM source versus the exported MP4 audio:

| Source | Source mean RMS | Export mean RMS | Delta | Source peak | Export peak | Clipped (source → export) |
|---|---:|---:|---:|---:|---:|---:|
| Long | 0.01282268 | 0.01281367 | −0.07% | 1.003477 | 1.003466 | 3 → 3 |
| Recovered | 0.04576423 | 0.04567956 | −0.19% | 0.970261 | 0.970047 | 0 → 0 |
| Edge take 1 | 0.00010040 | 0.00009886 | −1.5% | 0.008343 | 0.008243 | 0 → 0 |
| Edge take 2 | 0.00869191 | 0.00868010 | −0.14% | 0.119232 | 0.119290 | 0 → 0 |

| Source | Stored video duration | Export duration | Delta |
|---|---:|---:|---:|
| Long | 529.049 s | 528.978 s | −71 ms |
| Recovered | 34.737 s | 34.657 s | −80 ms |
| Sanity B | 18.384 s | 18.323 s | −61 ms |
| Edge take 1 | 12.369 s | 12.319 s | −50 ms |
| Edge take 2 | 4.535 s | 4.473 s | −62 ms |

All deltas are inside the export duration tolerance. Audio levels survive the AAC re-encode without audible-scale attenuation; the near-silent Edge take stays near-silent, which is faithful behavior rather than export loss. No frame-level image comparison was made beyond sampled visual inspection.

## Library Saved Exports

Defect found and fixed (details under `## Reproducible Defects`).

Before the fix, two independent runs reproduced the stale list:

- Recovered export: IndexedDB contained `local-1793039617700-c1a8` (23,159,858 B), but the Library still displayed "No saved exports yet".
- Long export: the Library displayed the older 22.1 MB recovered row but not the 352.7 MB export that had just completed.

After the fix:

- The sanity B export row appeared immediately as "youtube-landscape (local) · 11.7 MB · just now" without leaving the Library; the long and recovered rows were also present.
- The same immediate refresh was observed in Edge for both Edge exports (one row added after each run).
- Rows are sorted newest first, show dimensions, size, relative time, Download and Delete.
- TTL is exactly 7 days from `createdAt` on every row (verified on all five exports).

## Auth Boundaries

Unauthenticated HTTP calls against the running app, no cookies and no mutations:

| Request | Status | Body |
|---|---:|---|
| `POST /api/export-jobs` | 401 | `{"error":"Unauthorized"}` |
| `POST /api/exports/presigned-put` | 401 | `{"error":"Unauthorized"}` |
| `POST /api/exports/complete` | 401 | `{"error":"Unauthorized"}` |
| `GET /api/exports` | 401 | `{"error":"Unauthorized"}` |
| `GET /api/download?exportId=nonexistent` | 401 | `{"error":"Unauthorized"}` |
| `GET /api/exports/x/preview` | 401 | `{"error":"Unauthorized"}` |
| `DELETE /api/exports/x` | 401 | `{"error":"Unauthorized"}` |
| `DELETE /api/export-jobs/x` | 401 | `{"error":"Unauthorized"}` |
| `PATCH /api/export-jobs/x` | 401 | `{"error":"Unauthorized"}` |
| `GET /api/export-jobs/x/status` | 401 | `{"error":"Unauthorized"}` |
| `POST /api/export-jobs/cleanup` | 401 | `{"error":"Unauthorized"}` |

A non-existent `exportId` returns the same 401 as a valid one, so the unauthenticated boundary does not leak object existence.

## R2 Delivery

BLOCKED — environment and entitlement, not a demonstrated failure.

- The available browser profile is signed out. The app treats it as a guest/Free user; the export was the Free local path.
- Free is explicitly refused at `POST /api/exports/presigned-put` with 403 "Free plan uses local export" before storage configuration is consulted. This is covered by `src/__tests__/export-limits.test.ts` and `src/__tests__/export-complete-security.test.ts`.
- The local environment is not R2-ready: `R2_BUCKET_NAME` and `R2_ENDPOINT` are set, but `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are empty. `getR2ConfigurationError()` returns "R2_ACCOUNT_ID is not set" and `isR2Configured()` is false (covered by `src/__tests__/r2-configuration-and-upload-errors.test.ts`).
- No Creator test account or session was available, and no R2 bucket write was attempted. Writing to the shared bucket or creating a production account requires explicit authorization.
- Server-side cloud-export behavior is covered by unit tests (`export-complete-security`, `export-concurrency`, `export-job-cleanup`, `artifact-verification`, `phase2-server-hardening`, `server-authoritative`), but those use mocks. No real object was uploaded, completed, or downloaded through R2 in this phase.

## Second Browser

Microsoft Edge 156.0.4314.42, persistent Edge profile, same export dialog:

| Run | Output | Duration | Audio | Watermark | Library refresh |
|---|---|---|---|---|---|
| Edge take 1 (12.4 s source) | 4,886,549 B, 1280×720 | 12.319 s | Mean 0.0000989 / peak 0.008243; matches its near-silent source | Present | New row appeared immediately |
| Edge take 2 (4.5 s source) | 1,060,703 B, 1280×720 | 4.473 s | Mean 0.008680 / peak 0.119290; matches source | Present | New row appeared immediately |

Edge take 1 is the known near-silent capture from Phase 9; its export preserves that near-silence, which confirms the export is not attenuating audio. Edge take 2 has audible audio and exported at the same level as its source. The sampled Edge take 2 frame is very dark (the source starts dark); the watermark is still legible.

## Reproducible Defects

### Defect 1 — Saved exports list does not refresh after a local export (fixed)

- Severity: medium. The exported file exists and can be downloaded from the success dialog, but the Library's "Saved exports" section does not show it until the panel is unmounted and re-entered.
- Reproduction: open Library; export any recording with the Library mounted; wait for "Video exported"; click "Open My Library". The new row is absent. Reproduced with the recovered export (empty list) and the long export (old row shown, new row missing).
- Root cause: `RecordingsPanel` loaded local exports only on mount and when `refreshKey` changed. `refreshKey` is `exportJobs.length`; a Free local export never creates a server export job, so the key never changed.
- Fix: `saveLocalExport` now dispatches `sxs:local-exports-changed` after the IndexedDB transaction completes; `RecordingsPanel` subscribes and reloads its local export list. Files: `src/lib/local-exports-store.ts`, `src/components/studio/LibraryPanel.tsx`.
- Regression coverage: `src/__tests__/download-result.test.tsx` ("shows an export saved while the panel is already mounted"). The mock in `src/__tests__/recording-workflow-ownership.test.tsx` was updated for the new export.
- Verification: new row appeared immediately in Chromium (sanity B) and Edge (both takes); Library download was byte-identical to the dialog download; full unit suite passed.

No other reproducible export or delivery defect was found.

## Remaining Limitations

- R2/cloud delivery is unverified: no Creator session, no R2 credentials, no real upload, presigned PUT, completion, server download, retry, or quota behavior.
- Creator-only behavior (1920×1080 output, no watermark, cloud history) was not exercised in a browser; only unit tests and code inspection cover it.
- The export retry UI was not exercised because no export failure was induced.
- Only one physical camera/microphone and one machine were used. Edge is a second browser, not a second hardware configuration.
- Audio was compared by full decode statistics, not by listening; voice clarity, intelligibility, lip-sync, and perceived A/V sync remain NOT TESTED.
- Video quality was judged from sampled frames and watermark crops, not a perceptual/objective quality metric.
- The longest export was 529 s (353 MB). The server's artifact duration cap (≈1,685 s / 28 m 5 s at the configured bitrates) and 2,048 MB size cap were not approached; IndexedDB quota behavior above 353 MB was not tested.
- All runs used the Next dev server; wall times include development overhead and are not production performance measurements.
- Mobile browsers, Safari, and Firefox were not tested.

## FINAL ARCHITECTURE DECISION

KEEP EXPORT ARCHITECTURE

The local export, watermark, download, and 7-day saved-export paths are validated end-to-end on real recordings in two browsers. The only defect was a UI refresh gap in the Library, fixed without changing the export engine, encoding, entitlements, or storage formats. The recording engine remains frozen under the Phase 9 `KEEP MEDIACRECORDER` decision.

R2 delivery is BLOCKED, so this decision covers the local export architecture only. Do not describe cloud export or Creator delivery as validated until a Creator test account and R2 credentials are available and a real upload → complete → download cycle has been run.
