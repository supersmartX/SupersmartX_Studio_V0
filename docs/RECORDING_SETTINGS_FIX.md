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
