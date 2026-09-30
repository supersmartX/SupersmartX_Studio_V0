# Acceptance Changelog

## 2026-10-01 - Final pre-launch certification (1 critical defect fixed)

One more critical defect, found by audit rather than by a failing test. The
payment-idempotency fix of 2026-09-30 was only as durable as the database
behind it, and that was not guaranteed.

### Fixed

1. **Critical - production database silently fell back to `:memory:`**
   (`src/lib/db/driver.ts`): with no `TURSO_DATABASE_URL` the driver used
   a local file, and if the filesystem was unwritable it used `:memory:`.
   On a serverless host that is a fresh, empty, per-instance database, so
   `processed_webhooks` (the dedupe ledger that makes the 2026-09-30
   payment fix work), subscription state and library metadata were all
   non-durable while the app reported healthy. Production now fails closed
   via `DatabaseNotConfiguredError` unless a remote `libsql://` or
   `https://` URL and an auth token are both present. Dev/test fallbacks,
   including explicit `file::memory:`, are unchanged. 28 new tests in
   `src/__tests__/db-durability.test.ts`, including a mutation check
   against the old driver.

### Audited, clean, no code change

- Payment webhook idempotency: atomic claim, notification failure cannot
  release fulfilment, pending/failed never claims, exact retries are no-ops.
- Master recording survives navigation, auth, OAuth, upgrade, reload, and
  successful/failed/retried/cancelled/unsupported exports. 6 new tests.
- Export capability gate runs before the server job is created, so an
  unsupported browser spends no row, quota or concurrency slot.
- Free/Creator entitlements and server-authoritative route protection.
- Real MP4 re-verified 28/28 across 7 destinations x 4 source aspects.

### Harness issue (not a product defect)

Nine `mobile-chrome` specs fail. Proven pre-existing by reverting every
change of this pass and reproducing them identically. All nine share one
root cause: the landing header CTA is `display: none` below the mobile
breakpoint, and `auth.spec.ts` / `landing.spec.ts` / `edge-cases.spec.ts`
click it without opening the burger menu. The mobile path itself is correct
- a temporary probe opened the burger, clicked the menu "Log in" and the
auth dialog opened. The specs need to be viewport-aware; the mobile suite is
no longer reported as PASS. Tracked as blocker 12 in
`RELEASE_CERTIFICATION.md`.

## 2026-09-30 — State-machine certification pass (defects found and fixed)

Prior entries recorded "no genuine defect was found". This pass found six,
two of them real money/data-loss bugs. Suite 783→800; the 410/406 figures in
`RELEASE_CERTIFICATION.md` / `ACCEPTANCE_MATRIX.md` are stale and were already
behind the tree before this pass.

### Fixed

1. **Critical — duplicate payment events could re-extend a subscription**
   (`src/lib/cashfree-fulfillment.ts`): `sendOrderReceiptOnce()` called
   `tryClaimOrderNotification()` *outside* its `try`. A notification-ledger
   failure (table missing/unmigrated) propagated to the webhook route's
   catch, which called `releaseWebhookClaim()`, so the next retry re-entered
   `fulfillPaidOrder()` and recomputed `plan_expires_at` from `now` — granting
   extra subscription time on every duplicate event. The claim is now taken
   inside the `try`, so a ledger error cannot release the fulfilment claim.
   Proven by fault injection: drop `order_notifications`, deliver the real
   signed webhook twice, assert HTTP 200 both times and an unchanged expiry.
2. **Critical — "Open My Library" destroyed the master recording**
   (`src/app/studio/page.tsx`): `handleOpenLibrary` called `resetRecording()`
   and `clearMasterRecording()`, so the most common post-review navigation
   deleted the banked take — breaking restore-after-reload, sign-in, and
   upgrade. It now only navigates. Explicit "Practice Again" still clears.
3. **Landscape was never actually verified** (`scripts/state8-e2e/driver.ts`):
   `findEdges()` used the profiled-axis extent as the perpendicular
   coordinate, producing `NaN` profiles. Every 16:9 export was unmeasured, so
   the largest platform could not fail the gate. Now 28/28 with a hard bound.
4. **No browser capability gate existed** (`src/lib/export/browser-support.ts`,
   new): a browser without a usable H.264 encoder entered `encoding` and
   stalled at "Exporting... 0%" forever, because the failure is a hang, not a
   throw — nothing to surface and no Retry. Export now refuses *before* the
   job is announced, before a server job row is created, and before quota is
   spent, and says "Your browser can't complete this export. Please try Chrome
   or Edge." A capability probe that cannot answer is treated as unsupported
   rather than as a pass.
5. **A spec could not reach the failure it was written to test**
   (`e2e/export-lifecycle.spec.ts`): it held a stale duplicate
   `ensureStudioReady` that only knew the Welcome dialog's "Get Started". A
   fresh document has no camera, so after `apiRegister` + `reload()` the
   InitOverlay was the only control that could re-acquire one. Two tests
   burned the full 240s deadline and failed with "record button stayed
   disabled" while the product was correct. Now delegates to the shared
   `studioReady`; 3/3 pass in 1.2m instead of timing out.
6. **The R2 gate read placeholders as credentials** (`e2e/helpers.ts`):
   `.env.local` ships `R2_ACCOUNT_ID=your_account_id` and friends already
   filled in, so a `length > 0` check reported the cloud ready and the suite
   blocked for the full request timeout on a presigned PUT that could never be
   issued — a four-minute hang presented as a product failure.
   `hasRealCredentials()` rejects empty, placeholder, angle-bracket, mask and
   `{{template}}` values; the suite now skips cleanly in 1.6m.

### Tests added (17; suite 783→800, all green)

- `src/__tests__/state-machine-certification.test.ts` (4) — duplicate-payment
  claim retention under injected ledger failure; master recording not
  destroyed by navigation.
- `src/__tests__/state8-detector-blind-spot.test.ts` (4) — the landscape
  blind spot above, proven to fail against the old detector.
- `src/__tests__/state20-browser-support.test.ts` (9) — refusal when
  WebCodecs is absent, when the encoder rejects the config, and when the
  probe throws; proceeds when it can encode; the message is a plain sentence
  and survives `toExportErrorMessage`; and the gate precedes both the server
  job POST and the `encoding` transition.

### Verification evidence (2026-09-30)

- `tsc --noEmit` 0 errors; `eslint` 0 errors / 19 warnings; `next build` success.
- 800/800 unit, 229 suites.
- Real MP4: 28/28 (7 destinations × 4 source aspects), max position error
  0.0034. Wired as `npm run test:mp4`.
- E2E chromium 125 passed / 3 skipped; mobile-chrome 115 passed / 3 skipped /
  1 flaky; firefox 60 passed / 7 skipped / 59 failed — see
  `ACCEPTANCE_MATRIX.md` for the failure breakdown, which is overwhelmingly
  harness rather than product.

### Open, not fixed

- Two Firefox-only candidates need triage: `Escape` does not dismiss a modal
  (`e2e/studio.spec.ts:78`), and `.lsx-hero-photo.is-in` intercepts pointer
  events over the footer legal links (`e2e/support.spec.ts:79`). Both pass on
  chromium, so both are WebKit/Gecko-specific. Left open rather than changed
  blind.
- Firefox cannot run the camera specs at all: Playwright rejects
  `permissions: ['camera']` ("Unknown permission: camera"). 57 of 59 Firefox
  failures are this, and it hides the real Firefox signal.
- `src/lib/db/driver.ts` can fall back to `:memory:` when persistence is
  unavailable, which would break durable payment idempotency and library
  metadata. Flagged, not yet dispositioned.

## 2026-09-22 — Final certification preparation (no refactor)

- Health endpoint exposes non-sensitive deploy identifier: `commit` =
  first 7 of `VERCEL_GIT_COMMIT_SHA` (or `unknown`); no secrets, no
  infra detail (`src/app/api/health/route.ts`). Smallest possible change
  per program §5.
- Added `src/__tests__/health.test.ts` (4 tests): commit field present /
  fallback clean / anon `checks` hidden / auth-only `checks` without
  secrets. Suite now 410/410 PASS; tsc, lint (0 errors), build re-verified.
- Created `audit/OWNER_PRODUCTION_CERTIFICATION_RUNBOOK.md`: executable
  owner session (Tests 0–9) mapping 1:1 to the 9 certification blockers,
  with evidence standard, secrets policy, and certification-closing rule.
- No changes to auth, payments, storage, DB architecture, or business logic.

## 2026-09-22 — Production Acceptance Program

### Fixed

1. **P1 — SQLite FK enforcement enabled** (`src/lib/db/index.ts`):
   `ensureMigrated()` now runs `PRAGMA foreign_keys = ON` on every call.
   Previously `ON DELETE CASCADE` in the schema was unenforced (SQLite
   defaults OFF per connection), so deletes could orphan rows and FK
   violations were silently possible.
2. **P1 — Missing referential actions added via migration v10**
   (`src/lib/db/schema.ts`, `SCHEMA_VERSION` 9→10): rebuilt `exports`
   (`job_id … REFERENCES export_jobs(id) ON DELETE SET NULL` — completed
   exports survive nightly job cleanup) and `user_stats`
   (`FOREIGN KEY … ON DELETE CASCADE`). Copy filters historical orphans
   (unreachable rows dropped, dangling `job_id` nulled) so the migration
   cannot fail on legacy data. This fix was *discovered by* the new
   regression test: enabling the pragma made `DELETE FROM users` fail on
   the old schema, proving the gap was live.
3. **P2 — `PATCH /api/export-jobs/[id]` key validation**
   (`src/app/api/export-jobs/[id]/route.ts`): client-supplied
   `resultR2Key` must start with `exports/{userId}/` (400 otherwise);
   `resultExportId` type/length-checked. Authoritative key binding remains
   in `/api/exports/complete`.
4. **Critical — Next.js 16.3.0 → 16.3.6** (`package.json`/`package-lock.json`
   via `npm audit fix`): resolves critical RCE advisories
   (GHSA-p293-qw3h-jr36, GHSA-2xp9-vwfh-vxw4) + transitive sharp high.
   Prod `npm audit --omit=dev`: 0 vulnerabilities.
5. **Debt**: removed 3 dead unused imports/consts in presigned-put/complete
   routes (lint warnings 28→25, still 0 errors).

### Tests added (17; suite 389→406, all green)

- `src/__tests__/db-constraints.test.ts` (5): pragma ON, FK rejection of
  orphan child rows, user-delete cascade, cross-user ownership scoping,
  job-cleanup SET NULL semantics.
- `src/__tests__/server-authoritative.test.ts` (12): forged-plan fallback,
  expired/missing-expiry fails closed, 1080p clamp for free, platform lock,
  duration ceilings, concurrent quota increments capped, storage-cap
  rejection, monthly consume/revert.

### Docs added

- `docs/`: ARCHITECTURE, LOCAL_DEVELOPMENT, ENVIRONMENT, DATABASE,
  AUTHENTICATION, AUTHORIZATION, ENTITLEMENTS, EXPORT_PIPELINE, STORAGE,
  DEPLOYMENT, ROLLBACK, INCIDENT_RESPONSE, TROUBLESHOOTING.
- `audit/`: BASELINE, ACCEPTANCE_MATRIX, PRODUCTION_VALIDATION,
  REMAINING_RISKS, CHANGELOG, ACCEPTANCE_REPORT.

### Validation after every change

`npx tsc --noEmit` PASS · `npm run lint` 0 errors · `npm test` 406 PASS ·
`npm run build` PASS (29/29 pages).

### Deliberately NOT changed

- No product rewrite; export/auth/payment flows preserved.
- esbuild dev-only moderate advisory left (fix = breaking vitest major).
- In-memory rate limiter kept (documented threshold + Redis recommendation).
- cashfree `PRAGMA OFF` last-resort fallback kept (self-restoring; logged
  as P2 to monitor).
