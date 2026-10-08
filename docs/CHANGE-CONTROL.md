# Change Control — SupersmartX Studio

> Phase 4 deliverable. The engineering rule that governs every future change in
> this repository, plus the open-decision register created during Phase 4
> contract reconciliation.

## The rule

    Contract
        ↓
    Authorization
        ↓
    Implementation
        ↓
    Verification
        ↓
    Certification
        ↓
    Commit
        ↓
    Push

### What each step means

1. **Contract** — The change is written down first, in the authoritative
   contract layer: `docs/FC-1.1.md` for product/behaviour decisions (via its
   §14 Change Request flow), `docs/API-CONTRACTS.md` for route contracts,
   `docs/DATA-OWNERSHIP.md` for state ownership, `docs/ENTITLEMENTS.md` for plan
   capabilities, `docs/EXPORT_PIPELINE.md` for the export artifact contract.
   A change with no contract representation does not start.

2. **Authorization** — The change is explicitly approved by the owner. Frozen
   documents (FC-1.1, and any doc marked FROZEN) may only change through their
   own Change Request flow with explicit approval. **No AI agent may silently
   change a frozen product decision** (FC-1.1 §14). Product decisions are never
   invented by an implementer — documentation or code is not "repaired" to
   match an assumption (FC-1.1 §14 last bullet).

3. **Implementation** — Code/UI/config changes follow the contract and
   authorization exactly. Discrepancies discovered mid-implementation are
   *reported and classified* (see `TRACEABILITY.md` Findings), not papered over
   by editing either side.

4. **Verification** — The change is checked mechanically: `git diff --check`,
   `npx tsc --noEmit`, `npm run lint`, `npm test`, plus route-appropriate
   `npm run test:e2e` / `npm run test:mp4`. Results are recorded, with counts
   (e.g. "Vitest 1067/1067 across 69 files"), in the change record. See
   `TESTING.md` for what each layer does and does not prove.

5. **Certification** — **Certification requires evidence.** A phase or change is
   not "done" because the code works or the tests *should* pass. It is
   certified when: (a) every verification command's actual output is captured,
   (b) the traceability row(s) in `TRACEABILITY.md` for the touched requirements
   point at real test names and real evidence, and (c) the certification report
   is delivered with the required sections. Evidence recorded in Phase 0–3:
   tsc PASS · lint 0 errors / 21 baseline warnings · Vitest 1067/1067 (69
   files) · chromium 138/3/0 · test:mp4 30/30. Unverified claims are not
   evidence; a green run on a *different* HEAD is not evidence for this change.

6. **Commit** — Only after certification. The commit message references the
   contract clause(s) and the verification evidence. Working-tree hygiene:
   `git diff --check` clean, no generated or secret files included.

7. **Push** — The last step, never before certification. Pushes are explicit
   owner actions; agents do not push unless the task authorizes it.

## Rules

- **Contract and code never silently diverge.** If they disagree: classify and
  report (documentation mismatch / code bug / product decision), record it in
  `TRACEABILITY.md` Findings, and route a decision through this flow. Do not
  edit code to fit stale docs, and do not edit frozen docs to fit code.
- **Documentation-only corrections** of unambiguous factual staleness (counts,
  paths, version numbers, retired behaviours) are allowed without a CR — but
  must be called out in the change record. Decision-level content (product
  behaviour, entitlements, journeys) is never changed this way.
- **Certification evidence lives where the claim is made**: baseline counts in
  `TESTING.md`, requirement→test rows in `TRACEABILITY.md`, operational claims
  in `PRODUCTION-RUNBOOK.md`.
- **Secrets**: names only, in every document. Never a value.
- **Scope discipline**: a task that says "docs only" touches docs only; starting
  the next phase without instruction is a scope violation regardless of readiness.

## Open decision register

Created during Phase 4. Entries were acted upon only after the owner's
Phase 5 authorization (2026-10-07); current statuses are shown inline.

### CR-001 (APPROVED 2026-10-07 — APPLIED): FC-1.1 status-metadata refresh

- **Reason**: FC-1.1 is frozen and its status metadata predates Phases 2–3.
- **Affected clauses**: §1 "Phases" row, §10 phase table (Phase 2/3/4 rows
  now COMPLETE), §12 item 7 (Vitest baseline "980/980" → 1067/1067 across
  69 files, `test:mp4` 30/30 added), §13 tree note (HEAD `0a25fe7` →
  `9e42c18` at application; external commits moved the branch).
- **Impact assessment**: metadata-only; no product behaviour, invariant, or
  exclusion changes.
- **Approval**: owner, Phase 5 authorization, 2026-10-07 ("Approve
  CR-001"). Applied to `docs/FC-1.1.md` same day; diff verified to contain
  only the four approved spots.
- **Residual (not covered by CR-001, deliberately untouched):** §1 "Tree"
  row still reads "HEAD `0a25fe7`" (freeze-time value). Fold into the
  planned CR-003 post-Phase-5 baseline refresh unless the owner directs
  otherwise.
- **Verification (Phase 5 certification, 2026-10-09): PASS.** Post-edit
  gates on the final tree: `npx tsc --noEmit` exit 0; `npm run lint`
  0 errors / 21 warnings (exact baseline); `git diff --check` exit 0;
  Vitest 1125/1125 across 71 files. The four approved FC-1.1 spots remain
  the only contract diffs (residual §1 "Tree" row deliberately untouched —
  see CR-003 below). Commit/push remain explicit owner actions.

### CR-002 (APPROVED 2026-10-07 — APPLIED): voice speech-follow teleprompter + Phase 5 scope

- **Change Request**: add the voice speech-follow teleprompter as a Creator
  capability and re-scope Phase 5 per the owner's Phase 5 authorization.
- **Reason**: owner decisions 1–11, Phase 5 authorization 2026-10-07
  (decision 2: "Voice Teleprompter must be implemented now"; decision 1:
  Free local/device-only; B-01 Option C for auth closure).
- **Affected contract clauses**: §8 (new limitation 7 — SpeechRecognition
  browser dependence, client-side-only matching), §10 (Phase 5 scope row),
  §11 ("New pricing / entitlement changes" — carve-out for the Creator
  voice capability; Free/Guest excluded; no pricing changes).
  §3 Product Model needs no change: the teleprompter is not a §3 object
  and no §3 master/review/export/library semantics move.
- **Impact assessment**: client-side only — no server route, no audio
  upload, no dependency, no pricing change; `useRecorder` callback contract
  unchanged (timed scroll remains the fallback driver). Matching is local
  token alignment (no LLM, no third-party speech service).
- **Explicit approval**: owner, Phase 5 authorization 2026-10-07 ("Approve
  CR-002"; full behaviour spec in the authorization: conservative
  forward-only matching, pause/hold, Creator Monthly/Annual YES, Free/Guest
  NO, native SpeechRecognition only, existing recording pipeline
  preserved).
- **Implementation (Phase 5 WS-B, executed 2026-10-07/08)**: pure matcher +
  entitlement-gated state machine in `src/lib/voice-follow.ts` (forward-only
  contiguous lookahead, pause/hold on mismatch, deterministic restart budget
  with 500/1000/2000 ms backoff and cap 10 — `REC_STARTED` does **not**
  reset the budget, only transcript evidence does); browser adapter
  `src/lib/speech-recognition.ts` (ambient `SpeechRecognition` types
  local to the module — no dependency) + `src/hooks/useVoiceFollow.ts`;
  integration in `src/app/studio/page.tsx` (voice-gated scroll sites while
  engaged, voice cursor RESET on recording start, blocked-state on-canvas
  "Voice follow unavailable — use timed scroll" button); `InspectorPanel.tsx`
  Voice follow toggle + `describeVoiceFollow()`; entitlement gate
  `canVoiceFollow()` in `src/lib/entitlements.ts` (Creator Monthly/Annual
  only; Guest + Free no voice).
- **Tests**: `voice-follow.test.ts` (38 unit — matcher, state machine,
  restart budget), `useVoiceFollow.test.tsx` (12 hook-integration tests with
  a fake `SpeechRecognition`), `entitlements.test.ts` (+3 `canVoiceFollow`
  matrix), `e2e/voice-follow.spec.ts` (4 real-browser tests: creator
  follow/hold/disable, recording pause-hold + FC-1.1 §6 Item 8 DC-2
  auto-stop with the frozen exact toast, guest/free absent, unsupported
  browser absent; runs on chromium + mobile-chrome, skipped on firefox by
  the suite-wide fake-media gate).
- **Verification (Phase 5 certification, 2026-10-09): PASS.** Unit:
  `voice-follow.test.ts` 38/38, `useVoiceFollow.test.tsx` 12/12,
  `entitlements.test.ts` +3 `canVoiceFollow` matrix green; full Vitest
  1125/1125 (71 files). E2E: `e2e/voice-follow.spec.ts` 4/4 passed on
  chromium **and** mobile-chrome (skipped on firefox by the suite-wide
  fake-media gate), inside the full-suite run: **392 passed / 43 skipped /
  0 failed (435 total, exit 0)**. tsc 0, lint 0/21, `git diff --check` 0.
  Commit/push remain explicit owner actions.

### CR-003 (PROPOSED — NOT APPLIED, pending explicit owner approval): post-Phase-5 FC-1.1 baseline refresh

- **Reason**: FC-1.1 §1/§10/§12 status metadata now lags the completed
  Phase 5 (certified 2026-10-09) exactly as §1 "Tree" lagged Phases 2–4
  before CR-001. The contract file is frozen; only CR-001/CR-002 edits are
  approved so far.
- **Affected clauses (exact spots, verified 2026-10-09)**:
  1. §1 L23 "Tree" row — "HEAD `0a25fe7`" → current HEAD (working tree
     still uncommitted; value is the freeze-time external commit).
  2. §1 L24 "Phases" row — "Phases 0–4 COMPLETE; Phase 5 NOT STARTED"
     → "Phases 0–5 COMPLETE".
  3. §10 L418 Phase 5 row — `**NOT STARTED**` → `**COMPLETE**`.
  4. §12 L464–470 item 7 baseline — refresh counts to the Phase 5
     certified values: tsc PASS; lint 0 errors / 21 warnings; Vitest
     1125/1125 across 71 files; e2e full-suite 392 passed / 43 skipped /
     0 failed (435 total, 3 projects); `test:mp4` 30/30.
- **Impact assessment**: metadata-only; no product behaviour, invariant,
  or exclusion changes (same class as CR-001).
- **Status**: PROPOSED only. Not applied — FC-1.1 stays byte-identical
  until the owner explicitly approves this CR.

### Open findings requiring owner decisions

Recorded in `TRACEABILITY.md` (F-01 … F-16). **All dispositions below were
ruled by the owner in the Phase 5 authorization (2026-10-07); execution
status updates as Phase 5 proceeds:**

| Finding | Owner decision (2026-10-07) | Execution |
|---------|------------------------------|-----------|
| F-01 | Free = local/device-only: no Free cloud uploads, library, or quota; remove/reconcile misleading Free cloud claims (config nulled to `null`, 403 behaviour unchanged) | **DONE — WS-C (2026-10-09)** |
| F-02 / F-15 | Voice teleprompter implemented now (CR-002); claims become verified by implementation | **DONE — WS-B (2026-10-09)** |
| F-03 | Dual export-size reality accepted: 200 MB legacy multipart path + 2048 MiB primary presigned path; do not unify — document as intentional | **DONE — WS-C (2026-10-09)** |
| F-04 / CR-001 | Approved and applied (see CR-001 above) | done |
| F-06 | Journey/UX documentation corrected before any future UI implementation (docs only) | **DONE — WS-C (2026-10-09)** |
| F-08 | `.env.example` documentation corrected only (dead gate noted, `AUTH_SECRET` alias documented); no wiring change | **DONE — WS-C (2026-10-09)** |
| F-09 | Deferred (local observer rate limiter stays out) | deferred |
| F-10 / F-11 | Health probe warm-path cost; payments FK-pragma note | Informational code notes — no Phase 5 action (not decision items) |
| F-12 | Bucket-policy inventory first; no bucket changes in Phase 5 | Phase 5 WS-D executed read-only (code refs verified; bucket listing blocked by recorded ops-access gap in `DATA-OWNERSHIP.md`) — policy changes stay deferred to Phase 6 |
| F-13 | Account deletion completeness → **Phase 6 (privacy hardening)**, includes server-side password re-verification; prerequisite = F-12 recordings/ inventory | Phase 6 |
| F-14 + `PRODUCTION-RUNBOOK.md` §A2 citation error | Deployment documentation corrected (root canonical per D-07 recommended option); §A2 reference fixed to the real section | **DONE — WS-C (2026-10-09)** |
| F-05 / F-07 | Factual staleness corrections (already applied in Phase 4) | done |
| F-16 | No distributed rate limiting ever — per-process in-memory limits stay the documented limitation (FC-1.1 §11) | permanent exclusion |

### Phase 5 authorization record (owner, 2026-10-07)

- **Auth closure = Option C (minimum contract compliance)**: run and extend
  `auth-guard-intent`, `auth-identity`, `security.test`, `e2e/auth.spec`
  against current HEAD; fix only actual regressions; **no new
  authentication features**; SEC-005, SEC-006, SEC-007, SEC-009 explicitly
  deferred to a future security-hardening phase.
- Approved as written: Free local/device-only; Creator Monthly + Annual =
  voice speech-follow (Guest + Free = no voice); conservative forward-only
  matching with pause/hold; CR-001; CR-002; account deletion = Phase 6;
  UI/UX P1 remediation deferred (note: an external Phase 4B executed the 8
  P1s and certified GREEN before Phase 5 started — disclosed in the Phase 5
  report; no Phase 5 work adds UX fixes); `recordings/` read-only inventory
  only; no distributed rate limiting; no dependency/config changes; no
  commit or push.

### Phase 5 certification entry (2026-10-09)

Certified per §6/§7 of this file: every verification command's actual
output below was captured from the final working tree (HEAD `9e42c18`,
all changes uncommitted).

**Scope certified** — WS-A auth regression closure (Option C, suites only,
no new auth features; SEC-005/006/007/009 deferred), WS-B voice
speech-follow teleprompter (CR-002), WS-C Free local-only reconciliation +
documentation corrections, WS-D `recordings/` read-only inventory.

**Verification results (final gates):**

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | PASS (exit 0) |
| `npm run lint` | 0 errors / 21 warnings — exact baseline |
| `git diff --check` | exit 0 (CRLF warnings only, no whitespace errors) |
| Full Vitest | **1125/1125 passed, 71 files**, exit 0 |
| `test:mp4` | 30/30 |
| Full e2e (chromium + firefox + mobile-chrome) | **392 passed / 43 skipped / 0 failed — 435 total, exit 0** (36.2 min) |
| WS-A suites | `auth-guard-intent` 6/6, `auth-identity` 5/5, `security.test` 60/60, `e2e/auth.spec` 5/5 green in every run |
| WS-B suites | `voice-follow` 38, `useVoiceFollow` 12, entitlements +3, `e2e/voice-follow.spec` 4/4 (chromium + mobile-chrome; firefox skipped by fake-media gate) |
| WS-C suites | `export-complete-security` 23/23 (F-01 contract codified) |

**Skip accounting (43):** suite-wide environmental/project gating only —
chromium-only specs skipped on firefox (incl. the 4 new voice e2e), plus
mobile-chrome project skips; `TURSO_DATABASE_URL` unset here, so no DB
skips. Zero skips are suppression of failing behaviour.

**Two test-only e2e fixes made during certification (production code
untouched):**
1. **`e2e/helpers.ts` — synthetic per-registration `x-forwarded-for`.**
   The production login limiter (10 POST/15 min per last `x-forwarded-for`
   on the NextAuth catch-all) correctly throttles; all localhost
   registrants share `127.0.0.1`, so the suite tripped 429 on its own
   fixture accounts. Fix: `apiRegister` sends a unique RFC-5737
   documentation IP (`198.51.100.x`) per call. Limiter and app code
   unchanged; no limit was weakened.
2. **`e2e/smoke.spec.ts` — mobile backdrop center-click position.**
   Latent pre-existing race (passed run 1, failed run 2; Phase 5 did not
   touch drawer markup): on mobile the backdrop's center point sits under
   the open drawer. Fix: click the uncovered left strip
   (`{ position: { x: 8, y: 400 } }`) — the path a real user can reach.
   3/3 green after.

**WS-D ops-access gap:** the read-only `recordings/` bucket listing could
not be performed from this machine (TLS alert 40 to
`*.r2.cloudflarestorage.com`; control plane reachable; `R2_ACCOUNT_ID`
value not usable here). Recorded in `DATA-OWNERSHIP.md` § "`recordings/`
prefix inventory — Phase 5 WS-D". Zero bucket writes or policy changes
were attempted; bucket-policy inventory remains deferred to Phase 6
per the owner's F-12 ruling.

**Explicitly out of scope / deferred:** SEC-005, SEC-006, SEC-007,
SEC-009 (future security-hardening phase); F-09 observer rate limit;
F-12 bucket policy changes + account deletion (Phase 6); F-13 account
deletion; F-16 distributed rate limiting (permanent exclusion); all
UI/UX P1 remediation (external Phase 4B baseline disclosed, not
reverted); no dependency/config changes; no commit; no push.

**Contract state:** FC-1.1 edited only by approved CR-001 + CR-002.
CR-003 (post-Phase-5 baseline refresh) is **PROPOSED, not applied**.

### Decisions recorded during Phase 4 (no action needed, listed for trace)

- FC-1.1 left byte-identical; staleness handled as CR-001 instead of an edit.
- Factual-only corrections applied to: `ARCHITECTURE.md`, `DATABASE.md`,
  `ENVIRONMENT.md`, `TROUBLESHOOTING.md`, `INCIDENT_RESPONSE.md`,
  `DEPLOYMENT.md`, `ROLLBACK.md`, `LOCAL_DEVELOPMENT.md`, `STORAGE.md`,
  `EXPORT_PIPELINE.md`, `ENTITLEMENTS.md` (reconciliation section appended,
  table untouched), `AUTHORIZATION.md` (public-route list line only).
- `user-journey.md` / `user-flows.md` left untouched (product-journey content →
  F-06 report only).
- No commit, no push during Phase 4; all changes remain in the working tree
  pending the owner's review.

## How a future change flows (example)

To change an export limit:
1. Contract: CR against `ENTITLEMENTS.md` + `API-CONTRACTS.md` (and FC-1.1 §14
   if it touches a frozen clause).
2. Authorization: owner approves the CR in-repo.
3. Implementation: `entitlements.ts` + the enforcing route(s).
4. Verification: `entitlements.test.ts` + route tests updated to the new limit;
   tsc/lint/vitest green with recorded counts.
5. Certification: `TRACEABILITY.md` row 5/6/17 evidence refreshed; report.
6. Commit, then 7. Push.
