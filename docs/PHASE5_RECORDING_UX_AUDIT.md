# Phase 5 — Recording UX Audit & Improvements (final report)

Date: 2026-10-24 → 2026-10-25
Phase scope: camera framing, recording clarity, teleprompter, countdown, pause/resume, review/retake, mobile.
Baseline: Phase 4 stable flow (PREPARE → COUNTDOWN → RECORD → PAUSE/RESUME → STOP → REVIEW → RETAKE) preserved.

## 1. Problems found & fixed (Phase 5)

1. **Countdown blank gap / missing "Record" beat**
   - `src/hooks/useRecorder.ts` + `src/components/studio/CountdownOverlay.tsx`
   - Countdown now publishes immediate beats `3 → 2 → 1 → Record`; capture begins only after the Record beat.
   - Overlay uses a stable live region (`Starting in N` / `Recording now`), final cue, record-specific styling.
   - Cancelling announces "Countdown cancelled." and never marks a take complete.

2. **Microphone loss misreported / remaining track not stopped**
   - `src/hooks/useCamera.ts` (kind-aware track-ended handling, full stream release).
   - `src/app/studio/page.tsx` (camera-loss handling: toast + stop active take, or cancel countdown; existing review preserved).

3. **Teleprompter readability / geometry**
   - `src/components/studio/TeleprompterOverlay.tsx`, `src/components/studio/FocalGuideway.tsx`, `src/constants/index.ts`
   - Height-based start/end spacers, safe-top rail (raised 92 → 104 px), responsive `clamp(20px, 4.2vw, fontSize)` sizing, refined shadow, new defaults (32 px / 640 px width).

4. **NEW (found during this final Phase 5 audit pass): scrolling text under top controls**
   - `src/app/globals.css` (`.focus-mask` top fade 8% → 104 px), `src/constants/index.ts` (safe top 92 → 104).
   - Numeric geometry confirmed the REC/PAUSED pill overlapped the first teleprompter line on phones; fade now covers the full control rail while keeping the reading line opaque.

5. **NEW (found during this final Phase 5 audit pass): header label wrapped at 375 px**
   - `src/components/layout/Header.tsx` — `Log in` gets `whitespace-nowrap`.

6. **Quality E2E: take blob read**
   - `e2e/helpers.ts` (`readMasterRecordings` now returns blob `type` + size), `e2e/recording-quality.spec.ts`
   - Replaced blocked `fetch(blob:)` with IndexedDB read of the persisted `recordings` row.

## 2. Files changed (Phase 5 work)

Product:
- `src/hooks/useCamera.ts`
- `src/hooks/useRecorder.ts`
- `src/components/studio/CountdownOverlay.tsx`
- `src/components/studio/TeleprompterOverlay.tsx`
- `src/components/studio/FocalGuideway.tsx`
- `src/components/layout/TransportBar.tsx`
- `src/app/studio/page.tsx`
- `src/constants/index.ts`
- `src/app/globals.css`
- `src/components/layout/Header.tsx`

Tests / E2E:
- `e2e/helpers.ts`, `e2e/recording-quality.spec.ts`, `e2e/recording-loop.spec.ts`
- `src/__tests__/recorder-countdown.test.ts`, `useCameraStop.test.ts`, `countdown-overlay.test.tsx`, `teleprompter-overlay.test.tsx`, `transport-announcer.test.tsx`, `recording-workflow-ownership.test.tsx`, and related recording tests.

## 3. Verification results (automated)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | ✅ clean (after temporary-spec cleanup) |
| `npm test` (Vitest) | ✅ 53 files passed / 24 skipped; 636 tests passed / 302 skipped |
| `npm run build` (Next.js) | ✅ compiled successfully; TS finished; static pages generated; only pre-existing warnings (`CASHFREE_SECRET_KEY`, middleware→proxy) |
| `e2e/recording-quality.spec.ts` (Chromium) | ✅ 4/4 |
| `e2e/recording-loop.spec.ts` (Chromium) | ✅ 14/14 |
| Phase 5 responsive audit (Chromium) | ✅ 9/9 across 390×844, 375×812, 390×600, 768×1024, 1024×768, 1280×720, 1366×768, 1440×900, 1920×1080 |

Responsive matrix assertions (final run): no horizontal overflow / scroll-lock violations, countdown value vs Cancel no overlap, pause/resume + Stop visible with no collisions, review action buttons pairwise non-overlapping, Welcome dialog within viewport, transport within viewport.

## 4. Quality findings

- Real `MediaRecorder` codec/bitrate contract (Chromium fake camera): MIME matched `video/(webm|mp4)`, video bitrate ≥ 2.5 Mbps and ≤ 20 Mbps, audio 128 kbps, stored blob > 100 KB, average bitrate > 200 kbps (non-empty take).
- Stored blob read via IndexedDB now passes; previous failure was CSP-blocked `fetch(blob:)`, not a recording defect.

## 5. Accessibility

- Countdown overlay keeps stable live region; RecordingAnnouncer announces start/pause/resume/stop truthfully; countdown cancel copy fixed.
- Teleprompter text uses contrast-safe shadow and reduced top fade for control clearance.

## 6. Environment failures (not product defects)

- Unreachable Supabase DB; auth callback `ECONNREFUSED ::1:3000`; env-bound `review-playback.spec.ts:197`; Firefox password-recovery failures.
- Full 3-project `npm run test:e2e` remains partially environment-blocked; Chromium suites run here are green.

## 7. Real-hardware status

- **Not validated.** All automated recording/quality/responsive checks used Chromium fake media devices.
- Real capture quality (1080p webcam, laptop camera, external/BT mic, permission denial, device-in-use, unplug/reconnect, switching, exposure, white balance, sharpness, A/V sync, dropped frames, start/stop latency) requires physical hardware — still open.

## 8. Remaining UX issues

- Preview-as row can be partially scrolled/clipped at narrow widths (scrollable container; not a page-level overflow).
- Mobile reading area reduced by safe-top/mask changes; final geometry verified at all required sizes.

## 9. Phase 6 recommendation

- Real-device validation for capture quality and physical camera constraints.
- Re-verify safe-top/focus-mask math after any new top indicator or platform preview layout changes.
