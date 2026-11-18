# Review layout fix — 2026-11-17

## Approved scope and architecture
Web SaaS Studio post-recording review. Replace the bottom overlay with a normal-flow responsive control panel: right sidebar at the existing lg breakpoint, below the canvas at smaller sizes. Reuse Canvas, ReviewPlayer, PlatformPreviewSwitcher, existing tokens and handlers. The size-contained canvas fits the selected aspect ratio to the remaining space. The sidebar scrolls independently; the mobile panel is capped at 45% of available height to retain preview space.

## Flow and component contract
Entry: a completed or restored recording. Actions: preview platform, playback, export, retake and delete. Existing loading, failure, recovery, permission and plan-lock paths remain owned by their current components. PlatformPreviewSwitcher gains an optional sidebar boolean (default false); its selection, locked-platform handling and accessible pressed state are unchanged. Exit: existing export, retake, deletion or navigation flow. No navigation levels added.

## Security and performance
No server, authentication, authorization, billing, storage or recording pipeline changes. Existing entitlement checks remain. Responsive CSS adds no dependency, network request, database query or resize listener. No new security risks identified within this layout-only scope.

## Acceptance and fresh validation
- Given a completed recording, when reviewing at 1440x620, 1024x600, 390x844 or 844x390, then all four frame edges remain within the viewport and the review panel does not overlap the frame.
- Given review, when selecting 16:9, 9:16, 1:1 or 4:5, then the frame retains the selected ratio.
- Given a short viewport, when accessing later formats, then the controls scroll into reach.
- TypeScript check passed; modified application files passed ESLint.
- 43 targeted unit/integration tests passed (canvas media/shape, platform selection, recording ownership).
- Chromium layout regression passed all 16 viewport/ratio combinations using fake camera capture and a mocked Creator session; no account or database changes. Desktop and mobile screenshots visually inspected.

## Release scope
Local changes only. No deployment performed. Monitor post-recording review on real devices after release; rollback consists of reverting this layout change, with no data migration.
