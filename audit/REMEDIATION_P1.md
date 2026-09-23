# P1 REMEDIATION REPORT — SEC-001 + BUS-001

Date: 2026-09-23. Scope strictly limited to the two P1s; no other
application code touched (diff: 5 source files + 2 test files; no
dependency, UX, or unrelated changes).

## SEC-001 — Presigned size cap bypass

- Root cause: `POST /api/exports/complete` checked the 200MB cap against
  client-claimed `fileSize` (old line 38) while the HeadObject-verified
  size was stored without any cap check. A client could PUT a multi-GB
  object via its signed URL, declare `fileSize: 1`, and get it persisted —
  and creator plans have no storage ceiling, so cost was unbounded.
- Files changed: `src/app/api/exports/complete/route.ts` only.
- Design chosen: enforce `MAX_EXPORT_SIZE_BYTES` against `verifiedSize`
  from HeadObject; on violation delete the object, return 413, create no
  record. Client `fileSize` retained in the contract but reduced to a
  mismatch signal (server-side warn log, server wins). Empty objects now
  rejected outright (consistent with the multipart path). No new
  abstraction — the existing HeadObject call is now authoritative.
- Security model: Upload → R2 object → HeadObject authoritative bytes →
  cap check → entitlement/quota checks → persist. Every failure after
  upload deletes the object and creates no successful record.

Before → Vulnerability → Implementation → Regression test → Why bypass is
no longer possible: before, the cap read attacker input; the vulnerability
was claim-trusting at the only gate; implementation moved the comparison
to R2-attested bytes with object deletion on violation; tests 2/3/4 below
send lying claims against mocked R2 sizes and assert stored/rejected
outcomes; bypass is no longer possible because no code path persists or
counts bytes except `verifiedSize` (grep: `sizeToStore = verifiedSize`).

- Tests added (`src/__tests__/export-complete-security.test.ts`, real DB,
  only session + R2 mocked — production enforcement code executes):
  1. honest size → 200 + verified metadata; 2. smaller claim → stored
  actual; 3. larger claim → stored actual; 4. actual 250MB → 413 + object
  deleted + zero rows + job not completed; 5/6. quota-exhausted (4th
  upload on free 3-cap) → 403 + deleted + row count stays 3; 7. cleanup
  assertions inside 4–6; 8. success persists verified size/mime/status;
  9. retry returns same exportId, one row, ledger untouched; 10. zero
  rows after every rejection.
- Test results: 12/12 pass in-file; full suite 434/434.
- Remaining limitations: content-type still verified-not-enforced
  (STO-001, P3, untouched); per-request `duration` max remains
  claim-based on this path (now bounded by BUS-001 ledger below).

## BUS-001 — Client-attested duration budget

- Root cause: the free 600s/day budget lived in localStorage
  (`src/lib/daily-recording.ts`) and the server checked a client-sent
  `duration` string (`export-upload`) or nothing at all (`complete`).
  Clearing site data + lying about duration defeated the budget entirely.
- Root-cause architecture: exact media duration cannot be established in a
  serverless function (no media parser; parsing user video server-side
  would add a heavy dependency + CPU cost). The server CAN establish
  verified bytes (HeadObject / multipart file.size), which imply a
  minimum plausible duration at any sane ceiling bitrate.
- Design chosen (no parallel quota system — mirrors the existing monthly
  atomic-counter pattern): new `daily_recording_seconds(user_id, day,
  seconds)` table (migration v11, UTC-day rows, CASCADE on user delete);
  `atomicTryConsumeRecordingSeconds` (single conditional UPDATE —
  concurrency-safe) + `atomicRevertRecordingSeconds`; allowance +
  charge math centralized in `entitlements.ts`
  (`getDailyRecordingAllowanceSeconds`: free→600, creator→null/unlimited,
  unknown→600 fail-closed; `computeRecordingChargeSeconds` =
  max(sanitized claim, bytes ÷ 12Mbps ceiling)). Charge sites: `complete`
  (claim = body.duration ?? job-config duration) and `export-upload`
  (claim = duration field, verified bytes = file.size). localStorage stays
  as UX hint only — the server never reads it. Every post-charge failure
  reverts (monthly-denied, quota-denied, upload/create-throw paths in
  both routes); replay early-returns before charging (no double debit).
- Server-side enforcement model: User → daily ledger row → charge =
  max(claim, byte floor) → atomic consume-or-403 → downstream failures
  revert. Claiming 0/negative/short/missing can only raise the charge to
  the floor; over-claiming debits the liar; wiping localStorage changes
  nothing server-side.

Before → Vulnerability → Implementation → Regression test → Why bypass is
no longer possible: before, budget lived in attacker-controlled storage;
the vulnerability was total absence of server state; implementation added
an atomic server ledger charged with a claim-independent floor on both
export-creation paths; tests below forge localStorage, zero/negative/
missing claims, concurrent bursts, and replays against real DB rows and
assert ledger truths; bypass is no longer possible for naive
under-reporting because the floor derives from R2-attested bytes the
attacker cannot shrink without shrinking the actual upload (which the
200MB verified cap now bounds — combined smuggling ceiling documented
below).

- Tests added: `src/__tests__/recording-budget.test.ts` (12: allowance
  mapping incl. fail-closed unknown; charge math incl. hostile inputs;
  within/exact/over semantics; sequential + revert; 10-way concurrent →
  exactly 6×100s allowed, total 600; UTC rollover; existing-usage
  arithmetic) + route-level in `export-complete-security.test.ts` (floor
  charged on short/zero/negative/missing claims; over-budget 403 with
  cleanup + ledger intact; forged localStorage still 403; unauthenticated
  401 writes no ledger; replay reuses exportId without re-debit).
  Required-number mapping: 1 normal ✓, 2 exact ✓, 3 beyond ✓, 4 short
  claim ✓, 5 zero ✓, 6 negative ✓, 7 localStorage ✓, 8 multiple ✓,
  9 concurrent ✓, 10 replay ✓, 11 rollover ✓, 12 existing+new ✓,
  13 unauthorized ✓, 14 server enforcement (allowance+charge units) ✓.
- Test results: 12/12 + route BUS cases pass; full suite 434/434.
- Remaining limitations: EXACT media duration is still not measurable
  server-side — a low-bitrate long video within 200MB is charged the
  floor (≈80s per 200MB at the 12Mbps ceiling), not its true length.
  Verdict: **REMEDIATED for allowance integrity (localStorage and claim
  tampering defeated, atomic under concurrency); PARTIALLY REMEDIATED for
  exact-duration fidelity** — closing that residual requires server-side
  media parsing (new dependency + CPU, roadmap Phase 3 candidate), which
  was deliberately not introduced in this sprint. The 200MB verified cap
  bounds the residual smuggling window.

## Regression verification

```text
TypeScript: PASS (npx tsc --noEmit, incl. after test additions —
  one mock-typing error caught by build typecheck and fixed)
Lint: PASS (0 errors, 25 warnings — unchanged count)
Targeted tests: PASS (24/24 across the 2 new suites)
Full tests: PASS (26 files, 434/434 — was 410, +24, zero regressions)
Build: PASS (production build, 29/29 pages)
```

Diff review: source changes confined to `complete/route.ts`,
`export-upload/route.ts`, `entitlements.ts`, `db/index.ts`, `schema.ts`
(v11 additive); no dependency changes (package-lock diff predates this
sprint); no API contract breaks (new `duration` field optional; error
shapes unchanged); no security logic moved client-side; no P2/P3 work
undertaken.
