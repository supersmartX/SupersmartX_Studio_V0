# Recording settings access - 2026-11-03

Approved scope: keep the Studio web app settings accessible during countdown,
recording and pause. Preserve the active recording and existing review/export flow.

## Cause and design

InspectorPanel replaced its content with an empty desktop column during capture,
and the page rejected attempts to toggle settings. The existing panel now remains
mounted at its existing width. Compact screens use the existing drawer with Close
and Escape. Teleprompter controls open by default during capture. Script remains
readable; editing, clearing and replacing it are unavailable until preparation.
Countdown is disabled with explanatory copy. Existing transport device-switch
locks remain in force. Mirror and focus affect preview only.

The recorder retains its MediaRecorder pipeline. Its existing scroll callback now
reads current speed settings from a ref, so speed changes apply during a take.
No new packages, endpoints, permissions, storage or authorization paths are added.
Existing tokens and shared controls are reused. No backend or security changes.

## Acceptance criteria

- Given preparation, when countdown/recording begins, then the desktop panel stays
  visible and the camera keeps its existing available width.
- Given an active or paused take, when Settings is selected, then the panel opens;
  Close closes it, and the compact drawer supports Escape.
- Given an active take, when scroll speed changes, then actual scrolling changes
  without stopping or restarting capture.
- Given an active take, when Script or Camera settings are inspected, then script
  editing/clearing and countdown changes are locked with an explanation.
- Given pause, resume and stop, then settings remain available until the existing
  review/export surface takes over.

## Verification

Component tests: src/__tests__/inspector-recording.test.tsx.
Browser tests: e2e/recording-inspector.spec.ts, desktop and compact Chromium with
fake media devices. This validates UI/capture transitions, not real-camera quality.
Deployment is outside this fix; the production site needs the normal release flow.

Fresh results:
- TypeScript (`npx tsc --noEmit`): passed.
- ESLint on changed source and component test: no errors. The repository ESLint
  configuration excludes e2e files; those were checked by TypeScript/Playwright.
- Full Vitest suite: 81 files passed, 26 skipped; 905 tests passed, 339 skipped.
- Chromium desktop (1440px) and compact (390px): both passed with retries disabled,
  including actual scroll-rate comparison, pause/resume, close/reopen and review.
- Both captured screenshots were visually inspected.
- Production build: passed. Existing middleware deprecation notice remains.


## Review and export follow-up - 2026-11-04

Approved correction: release the empty desktop inspector column after Stop and
center review within the available workspace. The settings button opens the
existing export dialog during review. Its accessible name becomes Export settings,
and its expanded state reflects the dialog. Closing returns to the same take.
The export loading and ready states reuse the existing drawer backdrop (60 percent
dimming and 4px blur) instead of the nearly opaque black backdrop.

Architecture/security: reuse the existing modal, export callbacks, focus handling,
and backdrop style. No new dependency, endpoint, storage or entitlement path.
Recording controls retain their previous behavior. Review has no inspector node,
so it reserves no width; returning to preparation renders the settings again.

Acceptance criteria:
- Given an open desktop inspector, when recording stops, then review reaches the
  workspace's right edge with no empty inspector column.
- Given review, when Export settings is selected, then the export dialog opens
  with its normal controls and the background cannot receive interaction.
- Given export, when Escape or Close is used, then review remains available;
  Escape returns keyboard focus to the settings trigger.
- Given a compact viewport, the same review/export flow fits the viewport and
  preserves the captured take.

Tests extend the existing recording-inspector component and browser suites.
The 2026-11-03 full-suite results above are historical, not a new full-suite run.

Fresh follow-up verification (2026-11-04):
- Targeted Vitest: 20 tests passed across inspector, header and review-state suites.
- Chromium at 1440px and 390px: both recording/review/export tests passed with
  retries disabled, including workspace width, settings entry, background inertness,
  Escape/focus restoration, normal Export entry and Close.
- Review and export screenshots inspected at desktop and mobile widths.
- TypeScript, ESLint on affected source/test files, and production build passed.
- Existing Next.js middleware deprecation warning remains.
- Browser validation used fake camera input; real-camera output was not assessed.
