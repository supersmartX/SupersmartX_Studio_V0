# FC-1.1 — SupersmartX Studio Product Contract (Re-Baseline)

> **FC-1.0 is historical and its complete original text is unavailable.
> FC-1.1 is a new authoritative re-baseline based only on recoverable
> implementation evidence and explicitly stated decisions.**

FC-1.1 MUST NOT be read as, claimed to be, or used as a reconstruction of
FC-1.0. Any historical wording that cannot be proven from the sources listed
in §2 is marked `UNKNOWN / NEEDS EXPLICIT DECISION`. Nothing in this document
is inferred from the historical S0 audit.

---

## 1. Status

| Field | Value |
|---|---|
| Contract | **FC-1.1** (re-baseline) |
| Supersedes | FC-1.0 (historical; complete text unrecoverable — see §9) |
| Status | **FROZEN** — changes only via the Change Request flow in §14 |
| Created | 2026-10-05 |
| Mode | Read-only contract creation: no source, test, configuration, package, or existing documentation files were modified; only this file was created |
| Tree | Working tree preserved uncommitted (Phase 0 + Phase 1 changes); HEAD `0a25fe7` |
| Phases | Phases 0–4 COMPLETE; Phase 5 NOT STARTED (§10; Phase 5 scope per CR-002) |

---

## 2. Purpose

FC-1.1 is the authoritative product contract for SupersmartX Studio. It
freezes the behaviors that are currently implemented, verified, and covered
by the recorded verification baseline (§13), so that future phases proceed
against a written contract rather than inference.

**FC-1.1 is created ONLY from these sources:**

1. Current shipped code/tree
2. Existing tests
3. Existing test comments / source comments
4. Phase 0 verification report
5. Phase 1 verification report
6. Explicitly stated product decisions surviving in the engineering record
7. The explicit invariants, limitations, and exclusions stated in this prompt

**Source-of-truth priority used throughout:**

1. Current implementation and tests
2. Explicit surviving product decisions
3. Phase 0 verification evidence
4. Phase 1 verification evidence
5. Existing repository documentation
6. Explicit instructions given for this re-baseline

The **historical S0 audit is NOT authoritative** and its findings are not
revived here merely because they appeared in that audit.

If a claim cannot be proven from the sources above, it is marked:

    UNKNOWN / NEEDS EXPLICIT DECISION

---

## 3. Product Model

The following model describes the current product only where supported by
the tree. No new capabilities are introduced.

- **Product:** SupersmartX Studio — a browser-based teleprompter / video
  recording product (Next.js client + existing server architecture).
- **Master recording / content object:** one active master recording at a
  time in the studio workflow. A master recording consists of:
  - **Stable recording identity** — a stable ID created at completion and
    reused for open / restore / export / navigation (no duplicates, §4.2).
  - **Media bytes** — the recorded take stored as a blob/URL under that ID.
  - **Script snapshot** — the script as captured at completion time,
    stored with the master (§6, Item 7).
  - **Presentation context** — platform/target presentation settings and
    review state associated with the master.
- **Review:** in-studio playback of the completed take, including the
  review audio path (§6, Item 4).
- **Platform preview:** preview of the take under the selected platform
  target; platform changes must not fork the master (§4.6).
- **Export:** derived from the master recording through the current export
  pipeline (audio conversion and export engine as they exist today are
  authoritative — §4.9, §6, Item 5).
- **Library:** persistent store of completed master recordings; opening a
  Library item must never create or delete a master (§4.2, §4.3).
- **Entitlement model:** Free / Creator entitlement enforcement remains
  authoritative per the existing architecture (`src/lib/entitlements.ts`
  and related flows are unchanged by Phase 0/1).

---

## 4. Core Recording Invariants

These invariants are FROZEN. Any violation is a contract regression.

1. **One master recording has one stable identity.**
2. **Opening an existing Library recording must not create a duplicate
   master.**
3. **Opening, previewing, exporting, or navigating must not delete the
   Library master.** Exactly one production call site may clear the master
   (`clearMasterRecording()` — `src/app/studio/page.tsx`, inside the
   explicit "Practice Again" flow at freeze time).
4. **"New Video" is the explicit action for starting a new recording
   workflow.** It is the labeled destructive-reset action on both desktop
   and compact rails; it clears the session and starts empty (§6, Items 6–7).
5. **Export is derived from the master recording.**
6. **Platform changes must not fork the master recording.** They never
   create another master or another script snapshot.
7. **Free and Creator entitlement enforcement remains authoritative
   according to the existing architecture.** Phase 0/1 changed no
   entitlement, daily-allowance, or resolution rules.
8. **Do not reintroduce byte-slicing trim.**
9. **Do not reintroduce the legacy export engine.**
10. **Do not weaken server ownership/security checks.**
11. **Phase 0 and Phase 1 behavior must not regress** (the behaviors frozen
    in §5 and §6, verified against the baseline in §13).

---

## 5. Phase 0 Contract

Phase 0 (recording/workflow ownership correctness) — **COMPLETE**.
All three decisions: **IMPLEMENTED / VERIFIED**.

### P0-1 — New-session restore intent latch

New-session restore intent (`sxs-new-session-intent`) is correctly consumed
and cleared when a new authoritative master is created; a stale latch must
not survive into a later reload.

- Evidence: `src/hooks/useMasterRecording.ts` (latch key defined, cleared
  when a new authoritative master is created); assertions in
  `src/__tests__/master-recording-restore.test.ts`; Phase 0 gate green.

### P0-2 — Library ownership / Record Again protects the Library original

Library ownership / Record Again behavior protects the Library original:

- The Library original is explicitly identified
  (`isLibraryOriginal` / `sxs-master-origin`).
- **Record Again from Workflow B starts a fresh recording workflow.**
- It does **not** delete the Library original.

**Historical wording disclaimer:** the historical contract reportedly used
wording equivalent to *"navigate to Library"* for Workflow B. That exact
original wording is unavailable. **FC-1.1 does NOT claim FC-1.0 wording.**
The current behavior below is the authoritative FC-1.1 behavior:

    Library recording
        ↓
    Record Again
        ↓
    Fresh recording workflow
        ↓
    Original Library recording remains intact

- Evidence: single production `clearMasterRecording()` call site (§4.3);
  Workflow B routes through `handleNewVideo()`;
  `src/__tests__/recording-workflow-ownership.test.tsx`;
  `e2e/workflow-ownership.spec.ts`; Phase 0 gate green.

### P0-3 — Microphone mute synchronization single writer

`MediaStreamTrack.enabled` has a **single writer** that survives
stream/device lifecycle changes (re-applies mute state to new tracks when
the stream changes).

- Evidence: `src/hooks/useMicMuteSync.ts` (sole `track.enabled` write at
  freeze time); `src/__tests__/mic-mute-sync.test.ts`; Phase 0 gate green.

---

## 6. Phase 1 Contract

Phase 1 (core recording loop correctness) — **COMPLETE**.
All items: **IMPLEMENTED + VERIFIED**.

### Item 1 — Pause-aware duration

- Recording duration measures **active capture time**.
- Paused wall-clock time is excluded.
- Pause freezes active duration; resume continues active duration.
- Stop while paused does not charge paused time.
- **Free daily recording accounting uses pause-aware duration.**
- **Teleprompter consumption does not burn during pause.**
- Creator behavior remains unchanged.

Evidence: active-clock implementation in `src/hooks/useRecorder.ts`
(pause banking + segment clock; completion probe prefers a finite
`videoEl.duration`, else the active clock); `src/__tests__/recorder-duration.test.ts`;
pause/charge assertions in `e2e/state1-anonymous-free.spec.ts`;
`src/lib/teleprompter-session.ts` (teleprompter time only advances while
capture is actively rolling); Phase 1 gate green.

### Item 2 — Countdown

- Countdown obeys the setting; **countdown disabled means recording starts
  immediately** (no artificial wait when disabled).
- Countdown **can be cancelled**; cancellation leaves a clean idle state.
- **Countdown consumes zero recording quota and zero teleprompter
  allowance** (no capture session exists yet).
- A **navigation guard exists during countdown** where implemented
  (`beforeunload` registration, dropped on cancel/stream change).
- **Stopping during countdown must not leave the application stuck.**

Evidence: `startRecording(..., { countdown, onScriptEnd })` wiring in
`src/app/studio/page.tsx` (`countdown: settings.countdownEnabled`);
`cancelCountdown()` + Cancel button in `src/components/studio/CountdownOverlay.tsx`
(idle comment: no quota/teleprompter consumed);
`src/hooks/useRecorder.ts` (`registerBeforeUnload`, cancel-from-countdown
stop path); `src/__tests__/recorder-countdown.test.ts`;
`e2e/recording-loop.spec.ts` (countdown describe block); Phase 1 gate green.

### Item 3 — Capture dimensions

- **Before capture**, target dimensions may be shown as configuration
  (`Target W × H`).
- **During/after capture, actual capture dimensions must be represented**
  (probed take dimensions in review; live track settings when camera is
  up). Actual dimensions must not be claimed solely from configured output
  settings.
- **Free/Creator resolution entitlements remain unchanged.**

Evidence: capture badge logic in `src/components/layout/Canvas.tsx`;
`formatQualityLabel` (export labels) untouched; entitlement files untouched
by the Phase 0/1 diff; `e2e/recording-loop.spec.ts` (dimension describe
block); Phase 1 gate green.

### Item 4 — Review audio

- Review playback has an **audible path when recorded audio exists**
  (attempt unmuted autoplay first).
- **Review mute state is independent from microphone mute state.**
- **Browser autoplay restrictions may require a muted fallback.**
- A **visible review audio control remains available when audio exists.**

Evidence: `src/components/layout/Canvas.tsx` (autoplay attempt → muted
fallback + toggle); `src/__tests__/canvas-review-media.test.tsx`;
`e2e/recording-loop.spec.ts` (review sound toggle test); Phase 1 gate green.

### Item 5 — Dead audio-extra removal

The obsolete second audio recording surface was removed. FROZEN:

- **No separate dead audio-extra recorder** (`audioUrl` / `audioRecorderRef`
  / `stopAudioRecorder` removed from `src/hooks/useRecorder.ts`; no
  remaining references in `src/` outside historical test comments).
- **Export's real audio pipeline remains untouched.**
- **Do not remove or alter production audio conversion used by export**
  (the Phase 0/1 diff contains no export-engine or audio-conversion files).

Evidence: `src/__tests__/recorder-completion.test.ts` (documents the
removal); Phase 1 gate green.

### Item 6 — Compact navigation / DC-3

Current authoritative behavior:

- **Compact/mobile "Studio" navigation is a pure panel switch.**
- It **does not silently create a New Video** and **does not clear the
  current recording.**
- **Explicit "New Video" is the reset/new-workflow action**, implemented as
  an explicit BottomNav action.

Do not change this behavior while FC-1.1 is frozen.

Evidence: `src/app/studio/page.tsx` (desktop rail → `handlePanelChange`
full reset; compact rail → `handleCompactNav` pure switch; BottomNav
`onNewVideo={handleNewVideo}`); `src/components/layout/BottomNav.tsx`
(explicit New Video entry); `src/__tests__/recording-workflow-ownership.test.tsx`;
TEST 9 in `e2e/workflow-ownership.spec.ts` (1100×800); Phase 1 gate green.

### Item 7 — Script snapshot / DC-1

FROZEN MODEL:

    ONE MASTER RECORDING
    =
    MEDIA
    + STABLE ID
    + SCRIPT SNAPSHOT
    + PRESENTATION CONTEXT

- A **script snapshot is captured when the master recording is created**
  (completion-time value stored with the master; optional `script` field —
  no IndexedDB version bump).
- **Library/open/restore uses the saved script snapshot** (loading a master
  applies its snapshot to the editor).
- **New Video starts with an empty script.**
- **Draft edits after recording do not mutate the existing master snapshot.**
- **Platform/export changes do not create another master or script
  snapshot.**

**Known limitation (accepted):** legacy recordings without a stored
snapshot remain a known limitation (§8.1) unless a future migration is
explicitly approved.

Evidence: `script?` on `StoredRecording` / `MasterRecording`
(`src/types/index.ts`), persistence (`src/lib/recording-store.ts`,
`DB_VERSION = 2` unchanged), snapshot passed at both completion probe paths
(`src/app/studio/page.tsx`), `clearScript()` in `handleNewVideo`,
snapshot-apply page effect; restore/ownership tests; Phase 1 gate green.

### Item 8 — Script-end auto-stop / DC-2

FROZEN:

- **Script-end auto-stop remains enabled according to existing behavior**
  (armed once, fires only on the teleprompter-end path).
- The script-end path produces the **exact toast**:

      Script ended — recording stopped

- The toast occurs **only for the script-end auto-stop path**; manual stop
  does not show it.
- **Existing teleprompter consumption behavior remains unchanged.**

Evidence: exact toast in `src/app/studio/page.tsx` (`onScriptEnd` option);
sole `onScriptEnd` invocation inside the shared end-check interval in
`src/hooks/useRecorder.ts`; `src/__tests__/recorder-script-end.test.ts`;
`e2e/recording-loop.spec.ts` (script-end describe block); Phase 1 gate green.

---

## 7. C2.7 Clarification

    C2.7 — RE-BASELINED IN FC-1.1

The exact historical FC-1.0 wording for C2.7 is unavailable and is **not**
reproduced here.

**FC-1.1 duration rule (authoritative):**

> **MASTER RECORDING DURATION IS AUTHORITATIVE.**

- Use a **valid, finite media-derived duration** when available.
- Otherwise use the **recorder's active-clock duration**.
- **Never surface `Infinity` or another invalid media duration** as the
  authoritative user-facing recording duration.

No production code was changed to establish this rule; it documents the
current behavior (media-derived duration when finite, active-clock
otherwise; `src/components/studio/VideoPlayer.tsx` and
`src/hooks/useRecorder.ts` at freeze time).

---

## 8. Known Limitations

Recorded as **ACCEPTED / DOCUMENTED** — not implementation tasks.

1. **Legacy Library recordings may not contain a script snapshot**
   (no migration exists; a migration requires explicit approval).
2. **Chromium MediaRecorder WebM may report `Infinity` through
   `HTMLMediaElement.duration`** — handled by the C2.7 rule (§7).
3. **Countdown cancellation currently uses the explicit Cancel path /
   stream-change path.** No additional cancellation UX exists or is
   implied; do not invent more.
4. **Compact New Video is an explicit BottomNav action** (not a Header
   action).
5. **Long-script auto-stop has unit coverage; the current e2e proves the
   complete short-script browser path.**
6. **Countdown beep / audio-device behavior was not changed in Phase 1.**
7. **Voice speech-follow depends on browser SpeechRecognition support**
   (CR-002, Phase 5). Where `SpeechRecognition` /
   `webkitSpeechRecognition` is unavailable (e.g. Firefox, unsupported
   browsers), the voice control is not offered and timed scroll remains
   the sole teleprompter driver. No Safari/WebKit work beyond the
   existing unsupported gate (§11). Speech-follow is client-side only:
   it performs no server call, no audio upload, and no third-party or
   LLM-based matching — matching is local token alignment against the
   displayed script.

Do not turn these limitations into implementation tasks.

---

## 9. Lost / Unknown Historical Decisions

    HISTORICAL FC-1.0 DECISIONS THAT ARE NO LONGER RECOVERABLE

| ID | Status |
|---|---|
| DC-4 | **UNKNOWN — ORIGINAL WORDING LOST** |
| DC-5 | **UNKNOWN — ORIGINAL WORDING LOST** |
| DC-6 | **UNKNOWN — ORIGINAL WORDING LOST** |
| DC-7 | **UNKNOWN — ORIGINAL WORDING LOST** |
| DC-8 | **UNKNOWN — ORIGINAL WORDING LOST** |
| DC-9 | **UNKNOWN — ORIGINAL WORDING LOST** |
| DC-10 | **UNKNOWN — ORIGINAL WORDING LOST** |

CRITICAL:

- Do **NOT** infer their wording.
- Do **NOT** assign meanings based on filenames, comments, or likely intent.
- Do **NOT** silently map them to current code.
- They must be replaced by **explicit FC-1.1 decisions** (via §14) when
  their scope becomes relevant.

A full-workspace search, git-history search (`git log --all -S`), OpenCode
session-store search, and MCP-resource search recovered no trace of their
text; only FC-1.0 item/decision references in test and source comments
survive.

---

## 10. Phase Boundaries

| Phase | Scope | Status |
|---|---|---|
| Phase 0 | Recording/workflow ownership correctness | **COMPLETE** |
| Phase 1 | Core recording loop correctness | **COMPLETE** |
| Phase 2 | Server hardening | **COMPLETE** |
| Phase 3 | Export/artifact verification | **COMPLETE** |
| Phase 4 | Documentation / remaining product-contract cleanup | **COMPLETE** |
| Phase 5 | Auth regression closure (Option C — narrow regression sweep of existing auth suites against HEAD; fix only actual regressions; no new authentication features; SEC-005/006/007/009 explicitly deferred to a future security-hardening phase) + voice speech-follow teleprompter (CR-002) + documentation reconciliation + `recordings/` read-only inventory | **NOT STARTED** |

The exact historical DC-to-phase mapping is **UNKNOWN** where it cannot be
proven; it is not inferred (§9).

---

## 11. Exclusions

Preserved from the surviving scope record unless explicitly changed later
via §14. Do not implement any of them:

- Smart Crop / Smart Reframe
- AI auto-reframe
- 4K
- Batch export
- Safari/WebKit support beyond the existing unsupported gate
- Distributed rate limiting
- Multi-tab guards
- Job resume UI
- Auto-renewal
- New pricing / entitlement changes — *CR-002 exception (approved
  2026-10-07): the voice speech-follow teleprompter is a new Creator
  capability (Monthly, Annual, and legacy `pro_*`); Free and Guest have
  no voice access; no pricing changes and no other entitlement changes*
- Unrelated UI redesign
- Onboarding tour

---

## 12. Phase 2 Entry Requirements

Before Phase 2 implementation begins:

1. **FC-1.1 must exist as the new authoritative contract** (this document).
2. **Known Phase 0/1 behavior must remain frozen** (§5, §6) — regression
   against the baseline in §13 is a gate failure.
3. **C2.7 must use the FC-1.1 duration rule** (§7).
4. **The P0-2 current Record Again behavior must be explicitly accepted**
   (§5) — the flow diagram there is the authoritative behavior; no claim
   is made about lost FC-1.0 wording.
5. **Unknown DC-4…DC-10 must NOT block unrelated Phase 2 work** unless a
   Phase 2 task actually depends on one of those unknown decisions.
6. **Any Phase 2 requirement that depends on lost DC wording must receive
   an explicit new FC-1.1 decision before implementation** (via the §14
   Change Request flow).
7. **Existing test baseline remains:** (refreshed by CR-001 to the
   Phase 4/4B certified counts)
   - `tsc`: PASS
   - lint: 0 errors / 21 baseline warnings
   - Vitest: 1067/1067 across 69 test files
   - Chromium: 138 passed / 3 skipped / 0 failed
   - `test:mp4`: 30/30

---

## 13. Verification Baseline

**Phase 0:**

| Check | Result |
|---|---|
| TypeScript | PASS (exit 0) |
| ESLint | PASS — 0 errors / 21 baseline warnings |
| Vitest | 951/951 |
| Chromium (Playwright) | 132 passed / 3 skipped / 0 failed |

**Phase 1 (current authoritative baseline):**

| Check | Result |
|---|---|
| TypeScript | PASS (exit 0) |
| ESLint | PASS — 0 errors / 21 baseline warnings |
| Vitest | 980/980 across 67 test files |
| Chromium (Playwright) | 138 passed / 3 skipped / 0 failed |

**Tree:** no commits or pushes by the Phase 0–5 work; external repository
commits moved HEAD from `0a25fe7` (FC-1.1 freeze) to `9e42c18` at CR-001
application. The working tree is preserved as the implementation reference
(Phase 4 documentation, Phase 4B UI/UX remediation, and Phase 5 work all
uncommitted). Implementation is not altered by contract work.

---

## 14. Change-Control Rules

**A frozen contract may not be changed implicitly through code.**

Any future change to FC-1.1 must be represented as an explicit Change
Request following this sequence:

    Change Request
        ↓
    Reason
        ↓
    Affected contract clauses
        ↓
    Impact assessment
        ↓
    Explicit approval
        ↓
    Implementation
        ↓
    Tests
        ↓
    Verification

Rules:

- **No AI agent may silently change a frozen product decision.**
- Code, comments, filenames, and test names do not amend this contract;
  only an approved Change Request does.
- New decisions replacing lost historical ones (§9) enter through this
  same flow as explicit FC-1.1 decisions.
- Scope exclusions (§11) and accepted limitations (§8) change only through
  an approved Change Request.
- When contract and implementation disagree, the discrepancy is reported
  and resolved through this flow — the implementation is not "repaired"
  ad hoc, and the contract is not edited to match code ad hoc.

---

*End of FC-1.1. FC-1.0 remains historical; its complete original text is
unavailable. This document is the authoritative re-baseline.*
