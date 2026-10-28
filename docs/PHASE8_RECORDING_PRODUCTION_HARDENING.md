# Phase 8 — Recording Production Hardening (Engineering Only)

Date: 2026-10-26
Scope: Engineering hardening of the existing recording pipeline. No real-device or cross-browser release validation was performed in this phase; that remains the separate Final Release Validation phase.

## Objective

Continue from Phase 7B with a surgical audit of:

Camera → MediaStream → MediaRecorder → chunks → local recovery → master recording → Review → Export

and fix only defects that could be demonstrated from the codebase or the automated browser environment.

Constraints observed:

- The existing recording architecture was kept intact.
- No replacement of MediaRecorder, no WebCodecs, no recording-engine redesign.
- No changes to Prisma/Supabase, R2, export architecture, authentication, entitlements, payment, or UI/UX architecture.
- No speculative rewrites. Correct code was left untouched.
- No claims about real-camera quality or hardware performance.

## Current Architecture

### Capture

- `useCamera` requests a `MediaStream` with `ideal` 1920×1080@30 capture constraints and an `exact` deviceId when the user has selected a device. A fallback ladder lowers quality while preserving the selected device identity.
- Actual capture geometry comes from `MediaStreamTrack.getSettings()`, never from the requested constraints.
- `devicechange` refreshes the device lists. A track `ended` event (camera or microphone removed) releases the whole session and surfaces a Retry path.

### Encoding

- MediaRecorder emits one chunk every 1000 ms.
- Codec selection is a capability-gated ladder: WebM/VP9+Opus → WebM/VP8+Opus → WebM/VP9 → WebM/VP8 → WebM → MP4/H.264+AAC → MP4. The first `MediaRecorder.isTypeSupported()` success wins; the result is cached per document.
- No codec support means preflight fails honestly; the UI never constructs an unsupported recorder.
- Video bitrate is scaled from the actual track geometry/frame rate around an 8 Mbps 1080p30 anchor, clamped to 2.5–20 Mbps.

### Recording profiles

- Deterministic profiles: `1080p30`, `1080p-low-fps`, `720p30`, `720p-low-fps`, `480p30`, and `device-default`.
- Selection is capability-gated from `getCapabilities()` when available; otherwise it degrades to `device-default` with `null` targets rather than inventing values.
- The profile recorded with a take is derived from the actual delivered track settings (`profileForActualCapture`), so "what was configured" and "what was captured" remain distinguishable.

### Local persistence

- IndexedDB database `sxs-studio` (v3) with four stores:
  - `recordings` — completed local masters (24 h TTL).
  - `local-exports` — local export artifacts.
  - `recording-chunks` — incremental recovery chunks.
  - `recording-sessions` — recovery session metadata (chunk count, geometry, format, sequence, timestamps).
- Recovery policy: abandoned sessions expire after 24 h, zero-chunk sessions after 1 h. Recovery prefers the most recent session that has at least one chunk and concatenates chunks in sequence order. On adoption, the recovery `sessionId` becomes the master recording id, so reopening the same recovery twice cannot fork the library.

### Review and export

- A completed take becomes an in-memory master (`MasterRecording`) with a Blob URL, then is written to `recordings`.
- Review, platform selection and export operate on the stored master; the export pipeline and R2 flow were not modified.

### Recording state machine

`idle → countdown → recording ⇄ paused → completed`

There is no explicit `stopping` state. Stop is a transition guarded by a per-take identity and a single-finalization contract (see below). This was preserved deliberately; adding a new state would change UI behavior and was not justified by a demonstrated defect.

## Audit Findings

### Confirmed defects (fixed)

1. **Duplicate finalization on error → stop.**
   MediaRecorder fires `error` and then `stop`. Both handlers finalized the take, producing two Blobs, two object URLs, duplicate master creation, duplicate daily-budget accounting, and two recovery finishes. This was the most consequential lifecycle defect found.

2. **`beforeunload` guard leaks.**
   The navigation guard was only dropped on a normal stop. It survived recorder constructor/start failures, no-codec and no-track failures, the script-end auto-stop path, the countdown-cancel/no-codec path, and the recorder `error` path. Users could be prompted to leave a page that no longer held an active take.

3. **Unmount deleted recovery data.**
   The unmount cleanup finalized the take and called the recovery sink's `finish()`, which deleted the chunk/session rows. A reload, navigation, or tab death therefore destroyed the very data recovery exists to restore.

4. **Late callbacks could resurrect an old take.**
   A late `onstop`, a reset, or a new take could finalize into the previous take's state, reviving a discarded recording or overwriting the current one.

5. **Phantom active state at Stop.**
   If the recorder was already inactive while the UI still showed `recording`/`paused`, Stop did nothing and left the UI claiming an active capture.

6. **Recovery sink finish/append race.**
   `finish()` deleted the session while a chunk `put` was still in flight; the late write recreated an orphan session. A late append could also flip the sink's state back to `saved` after the take had ended.

7. **Silent IndexedDB save failures.**
   `saveRecording` swallowed transaction/open errors. A master could appear saved while no row existed; the recovery adoption path then charged the daily budget for a recording that was not persisted.

8. **Recovery adoption could run twice.**
   React effect replay or a second tab could adopt an already-adopted `sessionId`, duplicating recovery work and charging the recording budget twice.

9. **Timer undercounted in throttled/hidden tabs.**
   The tick-increment timer lost time whenever the browser throttled intervals, so displayed duration and the maximum-duration stop diverged from wall-clock.

10. **Stale camera stream after failed re-initialization.**
    On failure, `streamRef`/`stream` could remain populated while `isInitialized` was false, so consumers could still find a dead stream.

11. **Master delete/save race.**
    An in-flight library save could recreate a row after `clearMasterRecording` deleted it, leaving a discarded take in the library.

12. **Dead `TypeError` branch in camera error mapping.**
    The branch was inside a `switch` on `DOMException`, so it could never run. Non-secure-context failures received the wrong message.

13. **Malformed recovery metadata never aged out.**
    A session with a non-finite `updatedAt` was neither offered nor swept, so it could persist indefinitely and poison selection.

14. **Chunk Blob retention after finalize.**
    The per-second chunk array stayed referenced after the final Blob was assembled.

### Audited and left unchanged (no demonstrated defect)

- Codec ladder ordering and capability gating.
- Capture constraint ladder and exact-device preservation.
- Profile selection tables and bitrate scaling math.
- Chunk sequence ordering and recovery concat.
- Export pipeline and R2 integration.
- Daily budget and teleprompter caps (apart from charging only after a confirmed save).
- Review UI and library UI architecture.

## Fixes Implemented

### `src/hooks/useRecorder.ts`

- Added a per-take identity (`takeIdRef`) and a single `finalizeTake` closure:
  - exactly one finalization per take, even when `error` is followed by `stop`;
  - exactly one object URL and one result;
  - recovery `finish()` runs once;
  - chunk array and recorder ref are cleared;
  - zero-chunk finalization returns to `idle` instead of `completed`.
- Added `dropBeforeUnload()` and call it on every terminal path, including failures, script-end auto-stop, countdown cancellation and reset.
- Unmount now invalidates the take and releases resources **without** finishing the recovery sink, so interrupted rows survive for the next visit. Late `ondataavailable`/`onstop` from the previous document are ignored.
- `ondataavailable` ignores chunks from stale/finalized takes.
- Recorder `error` records a diagnostic, finalizes any captured chunks, and only surfaces an error toast when Stop was not already requested. The message is honest: partial take ready to review, or no data captured.
- Stop with an inactive recorder now finalizes or resets instead of leaving the UI active.
- Reset invalidates the take before stopping the recorder, so a late `onstop` cannot resurrect the discarded take.

### `src/lib/recording/recovery.ts`

- Added a session generation counter; completions from stale generations cannot mutate current state.
- Added a `pending` write set. `finish()` waits for in-flight writes to settle before deleting the session, preventing orphan rows.
- Added a `degraded` latch: after any failed chunk write the sink never returns to `saved`.
- `finish()` is idempotent and clears session/meta/sequence state.
- `findRecoverableSession` rejects non-finite timestamps and requires `chunkCount > 0`.
- `sweepAbandonedSessions` treats unreadable timestamps as expired and removes them.

### `src/lib/recording-store.ts`

- `saveRecording` now rejects on database-open failure and transaction error instead of swallowing them, enabling honest caller behavior.

### `src/app/studio/page.tsx`

- Recovery adoption checks `getRecording(session.sessionId)` first; an already-adopted session only has its chunk rows cleaned up.
- Daily budget is charged only after the recovered master was actually saved.
- Save failure keeps the chunk rows, opens the recovered take in review, and shows an honest message that it could not be added to the library, while the in-memory master remains exportable.

### `src/hooks/useRecordingTimer.ts`

- Replaced tick-increment counting with wall-clock active time:
  - accumulates completed segments;
  - excludes paused time;
  - caps at the configured maximum and triggers Stop;
  - fires the one-minute warning once;
  - remains correct across browser interval throttling.

### `src/hooks/useCamera.ts`

- Non-secure-context `TypeError` is checked before `DOMException` and mapped to an accurate message.
- A failed (re)initialization clears the stale stream ref/state.

### `src/hooks/useMasterRecording.ts`

- Tracks the in-flight library save so `clearMasterRecording` deletes immediately and deletes again after a slow save settles, closing the row-recreation race.

## Recording Lifecycle

| State | Entered by | Exit contract |
| --- | --- | --- |
| `idle` | initial, reset, zero-chunk finalize | Start arms countdown/recording |
| `countdown` | Start | Start → `recording`; Stop → `idle`; script end/failure drops the guard |
| `recording` | countdown completion | Stop/end/error → single finalize; Pause → `paused` |
| `paused` | Pause | Resume → `recording`; Stop → single finalize |
| `completed` | successful finalize | Review; Retake/reset invalidates the take |

Invariants enforced:

- One take id per capture session; increasing it invalidates all older callbacks.
- One finalization per take; `finalized` is checked by `error`, `stop`, and manual Stop.
- The `beforeunload` guard exists only while a take is genuinely active.
- Recovery sink lifetime starts at capture and ends exactly once on a clean finalize, or is left intact on unmount for later recovery.
- Object URLs are revoked on reset/retake/unmount, not on normal finalize (Review owns the URL).

## Device Failure Handling

- **Permission denied / not allowed (`NotAllowedError`)** — surfaced with a permission-specific message and Retry.
- **No device (`NotFoundError`) / device busy (`NotReadableError`)** — surfaced with a device-specific message and Retry.
- **Unsatisfiable constraints (`OverconstrainedError`)** — the constraint ladder retries at a lower rung while preserving the selected device; exhausted attempts surface the error.
- **Abort/interruption (`AbortError`)** — surfaced as a capture failure, not a saved recording.
- **Insecure context or unsupported API (`TypeError`)** — now mapped correctly; no misleading permission message.
- **Track ended (camera/mic removed)** — all tracks in the stream are stopped, the stream and initialization flag are cleared, device lists refresh, and a Retry message is shown. A take in progress finalizes through the normal guarded path, so captured chunks are not silently discarded.
- **Recorder `error`** — finalizes once, reports the partial take honestly, and never promises a complete recording.
- **Duplicate `error` → `stop`** — suppressed by the single-finalization contract.

## Recording Profiles

- Selection is deterministic and capability-gated; no browser-name heuristics.
- Requested profile and delivered profile are separate values:
  - requested: best compatible profile before capture;
  - delivered: derived from actual `getSettings()` geometry/frame rate;
  - unknown geometry remains `device-default` with `null` targets, never guessed.
- Bitrate is computed from actual geometry, not requested dimensions.
- Fallback to a lower rung changes quality, not the selected device identity.
- No fake hardware metrics are produced; only browser-reported settings are recorded.

## Metadata Integrity

Provenance is stamped at finalize and carried through storage, review and export:

- master id, creation time, MIME type and extension come from the selected codec and final Blob;
- duration comes from the recorder's measured active time (pause-aware), not wall-clock or a copied estimate;
- source width/height come from the stream's track settings;
- profile id comes from the actual capture profile;
- hasAudio comes from the actual stream tracks;
- recovery adoption uses the recovery `sessionId` as the master id, preventing forks;
- refresh restores the stored row as-is; no field is recomputed from current camera state;
- export reads the stored master metadata, not live capture state.

Regression coverage asserts a positive duration for completed recordings and `0` geometry when the browser reports none (unknown stays `0`/`null`, not fabricated).

## Recovery

- Chunk writes are non-blocking: a failed or slow write does not interrupt recording.
- Any write failure latches the sink to degraded/unavailable; the UI never claims recovery is being saved after that point.
- `finish()` waits for in-flight writes, then deletes the session and chunk rows.
- Unmount/navigation leaves rows intact for the next visit; late callbacks cannot mutate the previous document's sink.
- Candidates must have finite metadata and at least one chunk; malformed/zero-chunk sessions are swept by TTL.
- Adoption is idempotent per `sessionId`; budget is charged only after a successful save.
- A failed save keeps the rows and the in-memory master, so the user can still export.
- Interrupted sessions are recovered in chunk order into a single Blob; chunks are not duplicated in memory after assembly.

## Memory / Cleanup

- Chunk arrays are released once the master Blob is built.
- Object URLs are revoked on reset, retake, discard and unmount; the Review URL lives until then.
- MediaRecorder refs, countdown/recording intervals, and `beforeunload` listeners are cleared on every terminal path.
- Camera tracks are stopped on unmount, re-initialization and track loss.
- Unmount intentionally does not delete recovery rows; they expire by TTL after successful adoption or abandonment.
- No new global caches were introduced.

## Tests Added or Updated

New:

- `src/__tests__/recorder-lifecycle-hardening.test.ts` (10 tests)
  - error → stop finalizes once (one URL, one recovery finish)
  - guard dropped on error
  - runtime error surfaces once
  - no error toast when Stop was requested
  - inactive recorder at Stop finalizes
  - unmount preserves recovery rows and ignores late callbacks
  - reset invalidates a late `onstop`
  - guard dropped on script-end auto-stop
  - guard dropped on countdown/no-codec paths
  - no tracks surfaces an error
- `src/__tests__/master-recording-delete-order.test.ts` (1 test)
  - delete happens immediately and again after a slow save settles
- `src/__tests__/recording-store-save.test.ts` (2 tests)
  - successful save resolves
  - failed transaction rejects (quota error propagated)

Updated:

- `src/__tests__/recording-recovery.test.ts` (+3 tests)
  - `finish()` waits for an in-flight append before deleting
  - state never returns to `saved` after a failed write
  - unreadable metadata is never offered or retained
- `src/__tests__/useRecordingTimer.test.ts` (+2 tests; 11 total)
  - wall-clock duration across a throttled gap
  - cap and Stop under throttling
- `src/__tests__/useCameraStop.test.ts` (+2 tests; 9 total)
  - insecure-context `TypeError` message
  - failed re-initialization clears the stale stream
- `src/__tests__/useMasterRecording.test.ts` (+1 test; 16 total)
  - failed library write calls `onSaveError` while the master URL remains

## Validation

All results below were actually produced in this phase on 2026-10-26.

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit` | Exit 0, no diagnostics |
| Targeted hardening tests | `npx vitest run` on the 7 changed/new test files | 7 files passed, 61 tests passed |
| Full unit suite | `npx vitest run` | 58 files passed / 24 skipped (82); 669 tests passed / 302 skipped (1163); ~24 s |
| Production build | `npm run build` | Success; TypeScript completed in 5.1 s; 27 static pages generated; no errors |
| Recording E2E | `npx playwright test e2e/recording-loop.spec.ts --project=chromium` | 14 passed (2.5 min) |

Recording E2E scenarios covered (Chromium with fake media devices):

- countdown cancel and immediate start
- real geometry status reporting
- review audio present
- script-end auto-stop
- Stop arm window
- player controls auto-hide
- camera-off readiness
- retake with camera on
- review-ready/retake keeps the library intact
- delete of a fresh take

Not run in this phase: real-device sessions, Safari/Firefox E2E, iOS/Android hardware validation, and network/R2 export validation.

## Remaining Known Risks

### Engineering

- **No explicit `stopping` state.** Stop is an immediate guarded transition; there is no UI phase for "finalizing". No defect was demonstrated, so this was not changed.
- **Multi-tab recovery.** Two tabs can both discover the same in-progress session. Adoption is idempotent by `sessionId`, but there is no cross-tab single-writer lock; one tab may adopt chunks the other tab is still writing. Deferred.
- **Track `mute` without `ended`.** Only `ended` is handled. A microphone that mutes without ending (OS mute, some virtual devices) can produce a silent track while recording continues. Stopping on `mute` would be wrong for transient mutes, so this needs real-device behavior data before any change.
- **Clean-stop crash window.** `finalizeTake` finishes the recovery sink once the master is assembled in memory. A tab crash between that finish and the `recordings` row write loses the take (chunks are already deleted). The window is small and retaining duplicate bytes would conflict with the existing no-duplication recovery design; not changed.
- **Best-effort library delete/rename.** A failed IndexedDB delete/rename leaves the row in place (TTL will eventually remove it). No retry UI.
- **Hidden-tab maximum duration.** The cap is now wall-clock accurate, but enforcement depends on a timer tick. A browser that fully suspends timers defers the auto-stop until the tab is active again.
- **Forced tab kill.** A browser process kill can lose the last chunk or an in-flight IndexedDB write. Recovery only sees completed chunk rows.
- **In-memory chunk buffering.** One chunk per second is held until finalize, as in the existing architecture. Memory grows with take length; no new duplication was introduced.
- **Save failure outside recovery.** A normal library save failure now calls `onSaveError`; the master remains in memory/Review and exportable, but no row exists until a retry (there is no automatic retry).

### Hardware validation (deferred to Final Release Validation)

- Real camera/microphone capture quality and whether the browser honors the configured bitrate.
- Actual vs requested frame rate under low light, thermal throttling, and USB capture devices.
- Device removal during recording, permission revocation, OS sleep/resume, and Bluetooth microphone behavior.
- Long-duration recordings against device memory limits.
- Whether persistent microphone mute (without track end) occurs on target devices.

No hardware-quality claim is made in this phase.

### Browser compatibility

- Only Chromium (Playwright, fake media devices) was exercised end-to-end. Safari and Firefox were not run in this phase.
- Safari MP4/H.264+AAC and duration/metadata behavior, Firefox WebM behavior, and iOS recording constraints remain unverified.
- Codec gating is unit-tested, but real `isTypeSupported` matrices differ by browser version.

## Architecture Decision

**Should MediaRecorder be replaced? No.**

- No defect found in this phase required capabilities MediaRecorder lacks.
- Every demonstrated defect was above the recorder: take identity, finalization, guard lifetime, recovery write ordering, persistence error propagation, timer accounting, and cleanup.
- Replacing MediaRecorder with WebCodecs would be an engine redesign, contradict the Phase 8 constraints, and add muxing/timestamp complexity without addressing any observed failure.
- The capability-gated codec ladder and real-track-settings metadata already isolate browser differences.
- Revisit only if Final Release Validation shows a reproducible, unfixable recorder-level limitation (for example, container duration metadata on a specific browser). Even then, a container/remux fix is preferable to replacing the recording engine.

## Final Status

**GREEN — engineering stable.**

- All confirmed engineering defects listed above were fixed and covered by regression tests.
- TypeScript, the full unit suite, the production build, and the Chromium recording E2E suite pass.
- No blocking (RED) defect remains, and no known concrete unaddressed engineering defect remains.
- GREEN describes engineering stability only. It does not mean real-world recording quality, device compatibility, or browser compatibility has been proven; those are pending Final Release Validation.

Next steps:

1. Run the Final Release Validation protocol on real devices and browsers, including Safari/Firefox and mobile.
2. Verify actual bitrate/frame-rate/geometry against browser-reported settings and inspect long-take memory.
3. Exercise permission revocation, device removal, OS interruption, and background-tab behavior.
4. Revisit the multi-tab recovery and persistent-mute risks only if validation reproduces them.
