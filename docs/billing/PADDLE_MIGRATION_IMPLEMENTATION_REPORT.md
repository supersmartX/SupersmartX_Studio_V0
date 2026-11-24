# Paddle Migration Implementation — Stabilization Report

Date: 2026-11-19

## Current production-readiness review

This section supersedes any older status below when the same item has changed.
The implementation is **not production-ready**. Checkout and subscription
mutations remain sandbox-only; live payment activation is not authorized.

| Area | Status | Current evidence |
| --- | --- | --- |
| Prisma schema/client | PASS | `prisma format`, `prisma validate`, and `prisma generate` completed successfully. |
| TypeScript and focused lint | PASS | `npx tsc --noEmit` and focused ESLint completed with exit code 0 and no lint warnings. |
| Relevant billing, entitlement, and UI tests | PASS | 11 files, 160 tests passed. Provider and database interactions in unit tests are mocked; this does not replace integration evidence. |
| Raw-body webhook verification | PASS | The route passes the unchanged request body to the official Paddle SDK verifier and rejects invalid `occurredAt`; route tests use mocks. |
| Durable webhook inbox and duplicate event handling | PASS (code) / BLOCKED (PostgreSQL) | Event insert precedes acknowledgement; event IDs are unique. Actual persistence and duplicate concurrency need PostgreSQL verification. |
| Paid-event transaction verification | PASS (mock contract) | Worker re-reads the transaction and subscription, validates paid status, user/reservation/customer/subscription attribution, configured price, cycle, period, zero tax/discount and totals before applying a grant. |
| Grant atomicity, duplicate grant, worker fencing | BLOCKED (PostgreSQL) | Transaction-level idempotency and lease-token/expiry checks are implemented; concurrent replay and crash recovery were not run against PostgreSQL. |
| Out-of-order event handling | PASS (unit logic) / BLOCKED (PostgreSQL) | Webhook timestamps are required; older or missing timestamps cannot overwrite a later account snapshot. Concurrent replay has not been exercised on PostgreSQL. |
| Renewal and paid-period handling | PASS (mock contract) / BLOCKED (sandbox and PostgreSQL) | Renewal grants use Paddle billing periods and next-charge snapshots; no provider event or database lifecycle was executed. |
| Cancellation and paid-through access | PASS (existing contract) / BLOCKED (sandbox and PostgreSQL) | Cancellation remains period-end; access expiry is preserved. No provider cancellation was invoked. |
| Failed-payment behavior | PASS (mock contract) / BLOCKED (PostgreSQL) | Failed renewals change billing state without granting/extending a term; persisted behavior is unverified. |
| Refund/dispute stacking | PASS (unit logic) / BLOCKED (PostgreSQL) | Authoritative adjustment records include amount/currency. Partial adjustments do not revoke a full term; only approved full refunds/chargebacks remove that transaction's term; other paid and legacy coverage is recalculated. |
| Tax/discount handling | PASS (fail-closed) | Any nonzero tax/discount or changed total is held for review; no tax-inclusive/exclusive claim is invented. Production tax/copy configuration remains unresolved. |
| Uncertain checkout recovery | PASS (mock contract) / BLOCKED (sandbox) | Authenticated status route searches a bounded recent Paddle transaction window for exact reservation metadata, links only a unique match, and never grants from a redirect. |
| Active subscription duplication | PASS (unit logic) | A new reservation is rejected when an account has an active Paddle subscription or unexpired Paddle coverage. |
| Disposable PostgreSQL migration rehearsal | BLOCKED | The guarded runner returned `BLOCKED: Docker daemon unavailable; no database operation was attempted.` No local PostgreSQL/Podman option was available; no shared/application database was used. |
| Paddle sandbox | NOT TESTED | Sandbox environment and API key are configured, but webhook secret, sandbox price IDs, amounts and currency are absent. No Paddle API call was made. |
| Production readiness | BLOCKED | Requires disposable PostgreSQL lifecycle tests, complete sandbox setup and end-to-end sandbox evidence, and an approved tax policy. |

## Hardening pass (2026-11-20)

Local code changes, all covered by the test suites below:

- Checkout URL acceptance is an explicit allowlist (`PADDLE_CHECKOUT_URL` /
  `PADDLE_CHECKOUT_URLS`, origin + path, HTTPS, `_ptxn` only), replacing the
  single-URL equality check.
- The worker drains up to 64 leases or a 45 s budget per invocation instead of
  stopping at one batch; `vercel.json` keeps the supported daily recovery
  schedule (`0 3 * * *`) and the webhook triggers the worker on receipt. The
  GitHub Actions and Pro-interval variants below are superseded.
- A delayed adjustment recomputes paid-through coverage but cannot overwrite a
  newer account lifecycle status (`lastEventAt` guard).
- `/api/paddle/quote`, `/api/paddle/checkout`, and `/api/paddle/cancel` have
  per-user in-memory rate limits (`429` + `Retry-After`) and an 8 KiB bounded
  JSON body reader (`/api/paddle/checkout` also requires a 64-hex consent hash
  and caps the quote token at 4096 chars). The webhook reuses the same bounded
  reader with its 1 MiB limit.
- Runbook, environment, deployment, database, rollback, architecture and
  troubleshooting docs now describe Paddle Billing only; retired gateway
  variables (`PADDLE_ENVIRONMENT`, `PADDLE_API_KEY`, `PADDLE_APP_ID`,
  `PADDLE_API_VERSION`, `BILLING_OPS_SECRET`) and the deleted
  `/api/internal/billing/orders` route were removed.

Verification (2026-11-20):

```powershell
npx vitest run <13 billing/security suites>
npx tsc --noEmit
npx eslint src/app/api/paddle/{quote,checkout,cancel,webhook}/route.ts \
  src/lib/request-body.ts src/lib/billing/operations.ts <5 touched tests>
```

Result: **13 test files passed, 93 tests passed**; `security.test.ts` skipped
because `DATABASE_URL` is unset (its cases need PostgreSQL); TypeScript and
focused ESLint exited 0. This remains mock/local evidence: no sandbox payment,
signed webhook delivery, or PostgreSQL concurrency run was performed.

## Paddle webhook production reachability fix (2026-11-19)

Status: **LOCAL FIX PASS; DEPLOYMENT REQUIRED; SANDBOX NOT VERIFIED**

The production probe showed that `POST` and `GET` on
`/api/paddle/webhook` returned session-auth `401` JSON and the production CSP
still contained Cashfree SDK/resources. This was deployment/source drift:
the deployed build did not contain the current public webhook middleware
configuration or current Paddle route implementation. The local source now
exposes only the exact `/api/paddle/webhook` pathname without a Studio session.
Webhook subpaths and every unrelated API route remain protected.

The middleware change is intentionally narrow: exact pathname matching is used
instead of a prefix-based Paddle grant. The webhook route continues to require
a `Paddle-signature`-verified body and the existing raw-body SDK verification,
event validation, durable inbox persistence, duplicate idempotency and worker
processing. No browser redirect or valid Studio session grants entitlement.

Obsolete Cashfree source references are absent from `next.config.ts` and source
TypeScript/TSX files, so no stale Cashfree CSP entries were reintroduced in the
local configuration. Removing deployed CSP entries requires the new build to be
deployed; no Cashfree runtime dependency is otherwise needed by the application
path in scope.

Changed for this fix:

- `src/middleware.ts`: exact public webhook pathname; other APIs remain session protected.
- `src/__tests__/paddle-webhook-reachability.test.ts`: middleware public-route and protected-route coverage.
- `src/__tests__/paddle-webhook-route.test.ts`: unsigned request, valid signed event and invalid signature coverage.

Focused verification:

```powershell
npx vitest run src/__tests__/paddle-webhook-reachability.test.ts src/__tests__/paddle-webhook-route.test.ts
npx eslint src/middleware.ts src/__tests__/paddle-webhook-reachability.test.ts src/__tests__/paddle-webhook-route.test.ts src/app/api/paddle/webhook/route.ts
npx tsc --noEmit
```

Result: **9 tests passed across 2 files**; TypeScript passed; focused ESLint
passed with no warnings.

## Vercel Hobby worker compatibility (2026-11-19)

Status: **LOCAL PASS; DEPLOYMENT COMPATIBLE WITH DAILY CRON; SANDBOX NOT VERIFIED**

The Paddle worker performs authoritative provider rereads, lease-fenced event
processing, transaction/subscription grant application, failed-payment snapshots,
cancellation reconciliation and refund/dispute adjustment processing. Webhook
delivery persists each event first, but before this change it did not actively
trigger worker processing: on the existing 5-minute cron, events usually waited
for the next cron invocation, with the daily cron fallback handling recovery
instead.

The existing architecture can safely satisfy Vercel Hobby requirements.
The signed webhook route now triggers the secret-authenticated worker route
after every durably received event, first receipt or duplicate. The trigger is a
bounded, best-effort immediate sweep; it does not grant access or bypass the
worker, signature verification, lease, replay protection or transaction checks.

Provider operation failures, event failures and worker crashes are covered by
the durable inbox and lease/retry logic. Exponential retry remains active;
events exhaust to manual review after 10 attempts. The worker route can also
process out-of-order events only after timestamp and provider ownership checks.
No billing state can safely wait for as much as 24 hours, so daily execution
alone is not sufficient for normal live event processing. Event-driven trigger
processing is the selected solution, with a daily sweep as crash/recovery
fallback.

`vercel.json` now schedules both project jobs once per day:

- Paddle worker: `0 3 * * *`
- Export cleanup: `0 2 * * *`

No other scheduled job uses an interval shorter than daily.

Worker compatibility files changed:

- `vercel.json`: changed Paddle worker from 5-minute to daily fallback cron.
- `src/app/api/paddle/webhook/route.ts`: triggers the lease-fenced worker after
  durable webhook persistence with a 50-second deadline, one connection-failure
  retry and no retry on a non-2xx answer; duplicates retrigger a sweep. Route
  `maxDuration` is 60 s so `after()` covers the worker's 45 s drain.
- `src/__tests__/paddle-webhook-route.test.ts`: verifies first receipts and
  duplicates trigger the worker, a connection failure retries once, and an
  answered error is not retried.

Validation completed:

```powershell
npx vitest run src/__tests__/paddle-webhook-route.test.ts src/__tests__/paddle-worker-route.test.ts src/__tests__/paddle-billing-operations.test.ts
npx tsc --noEmit
npx eslint src/app/api/paddle/webhook/route.ts src/app/api/internal/paddle/worker/route.ts src/lib/billing/operations.ts src/__tests__/paddle-webhook-route.test.ts src/__tests__/paddle-worker-route.test.ts src/__tests__/paddle-billing-operations.test.ts
```

Result: **18 tests passed across 3 files**; TypeScript and focused ESLint passed.
This evidence validates local route, worker, idempotency and operation behavior
only. It does not prove real Paddle events, PostgreSQL concurrency or a deployed
Vercel function. Deployment remains pending, and sandbox verification remains
not tested.

## Production Paddle schema migration (2026-11-19)

Status: **PASS**

After explicit production authorization, Prisma applied only the two pending
Paddle migrations to the confirmed Supabase production database:

- `20261118000000_paddle_billing`
- `20261119000000_paddle_adjustment_amount`

Database identity used for the run:

- Project: `supersmart-x-studio-v0`
- Host: `aws-0-ap-northeast-2.pooler.supabase.com:5432`
- Database: `postgres`
- Schema: `public`
- Environment: production

Command:

```powershell
npx prisma migrate deploy
```

Result: both migration SQL files were applied successfully. A subsequent
`npx prisma migrate status` reported `Database schema is up to date!` with four
migrations found.

Verified endpoint behavior after migration:

- `GET /api/paddle/billing` returned HTTP 401 for an unauthenticated request.
- `POST /api/paddle/quote` returned HTTP 401 for an unauthenticated request.

Those 401 responses confirm the routes remain protected by Studio authentication;
they do not prove authenticated billing queries succeed. A P2021 missing-table
error was not returned by these probes.

Production safety remained unchanged:

- `PADDLE_LIVE_CHECKOUT_DISABLED=true`
- No Vercel environment variables changed.
- No deployment was made.
- No live Paddle operation was performed.
- No data or legacy entitlement migration was included in the applied SQL.

### Verification run for this review

```powershell
npx prisma format
npx prisma validate
npx prisma generate
npx tsc --noEmit
npx eslint src/lib/billing src/app/api/paddle src/app/api/internal/paddle src/components/dialogs/PricingModal.tsx src/__tests__/paddle-billing-contract.test.ts src/__tests__/paddle-billing-operations.test.ts src/__tests__/paddle-webhook-route.test.ts src/__tests__/paddle-worker-route.test.ts src/__tests__/paddle-checkout-status-route.test.ts src/__tests__/pricing-modal-checkout-recovery.test.tsx
npx vitest run src/__tests__/paddle-billing-contract.test.ts src/__tests__/paddle-billing-operations.test.ts src/__tests__/paddle-webhook-route.test.ts src/__tests__/paddle-worker-route.test.ts src/__tests__/paddle-checkout-status-route.test.ts src/__tests__/billing-accounts.test.ts src/__tests__/pricing-modal-checkout-recovery.test.tsx src/__tests__/header-billing-status.test.tsx src/__tests__/pricing.test.ts src/__tests__/entitlements.test.ts src/__tests__/recordings-access.test.ts
powershell -ExecutionPolicy Bypass -File scripts/rehearse-paddle-migrations.ps1
```

Result: schema formatted and valid; Prisma Client generated; TypeScript and
focused ESLint exited successfully; **11 test files passed, 160 tests passed**.
No tests failed in the final run. The tests cover unit/contract behavior only;
they do not prove PostgreSQL concurrency or real Paddle behavior. The
migration runner was executed and exited blocked before creating a container or
accessing any database.

The local configuration-presence check did not display credential values. It
found `PADDLE_ENVIRONMENT=sandbox`, an API key, and
`PADDLE_LIVE_CHECKOUT_DISABLED=true`; it did not find the webhook secret,
monthly/yearly sandbox price IDs, sandbox amounts, or sandbox currency.

## Historical stabilization baseline

The following captures the earlier regression stabilization run. For current
Paddle production-readiness findings, use the review at the top of this report.

| Area | Status | Evidence |
| --- | --- | --- |
| Recording/export fixture isolation | PASS | Root cause was suite gating: database suites could activate on `DATABASE_URL` truthiness even when `HAS_TEST_DB` refused a production-looking URL. Added production URL detection from shell, `.env.local`, and `.env`; setup removes deployed URLs from the test process; added billing tables to TRUNCATE cleanup; creator fixtures now use unique emails; matrix/limit suites clean before and after each test. |
| Five affected suites | PASS/NOT EXECUTED DB | Serial command passed 36 unit tests and skipped 38 database-backed cases. The three DB suites were not executed because no throwaway PostgreSQL is available. |
| Full recording/export batch | PASS with skipped DB cases | 26 files passed, 279 tests passed, 10 files/63 database-backed tests skipped. No assertion was weakened or skipped in application code. |
| Exact migration SQL integration | BLOCKED | Docker daemon unavailable; native PostgreSQL absent; WSL has only `docker-desktop`; no shared database was used. |
| Raw-body webhook signature | PASS | `/api/paddle/webhook/route.ts` reads `request.text()` and passes the raw body to `paddle.webhooks.unmarshal(raw, secret, signature)`. |
| Durable event persistence | PASS | Event inbox upsert occurs before paid/failure/cancellation/ignore acknowledgement. Event payload, status, retries, lease owner and lease expiry are persisted. |
| Duplicate event idempotency | PASS | Event ID is primary keyed; processed events return duplicate and do not reapply grants. Unit route test passed. |
| Out-of-order events | PARTIAL | Duplicate and state guards exist, but a timestamped Paddle event ordering field is not yet persisted. This prevents a complete out-of-order certification. |
| Ownership validation | PASS | Paid events validate user custom data, plan custom data, subscription IDs, and existing account subscription ID. |
| Authoritative paid verification | PASS | Paid event handling calls `paddle.transactions.get()` and rejects ready/draft/canceled/past-due states before grant creation. |
| Renewal calculation | PARTIAL | The transaction grant path retains active expiry and adds one monthly/yearly term. Provider renewal event normalization, next-charge persistence and database-backed lifecycle verification remain incomplete. |
| Cancellation period end | PASS | `/api/paddle/cancel` calls SDK cancellation at `next_billing_period`; subscription canceled events preserve the stored paid-through date. |
| Failed payment | PASS | Failed/past-due events set payment-failed status and do not alter paid-through/extend expiry. |
| Refund/dispute isolation | PARTIAL | Adjustment events update only the attributed provider transaction's refunded/disputed timestamp; stacked-term and entitlement isolation is not implemented. |
| Worker lease/fencing | PARTIAL | Event lease owner and expiry plus acquire/release helpers exist. A separate scheduled worker route is not present; lease fencing was not database-verified. |
| Crash recovery | NOT TESTED | Reservation and event states persist, but no disposable PostgreSQL crash/restart run is available. |
| Uncertain provider operations | PARTIAL | Reservation is now persisted before remote checkout creation, then updated from provider success or marked provider-create-failed. Provider mutation uncertainty after an unknown network result still requires reconciliation and SQL integration. |
| Browser redirect grants | PASS | No route grants on redirect; only signed webhook/provider-paid state can create a grant. |
| Enrollment overlap | PASS | Migration has a partial unique index for reserved/pending reservations per user and `/api/paddle/checkout` returns conflict on overlap. |
| Studio plan names/prices | PASS | Existing Paddle pricing UI remains unchanged: India creator monthly ₹349 and yearly ₹2,899; no trial text was added. |
| Cancellation UI | PASS | Header shows cancellation scheduled and next charge; cancel route preserves paid-through date. |
| Failed payment UI | PASS | Billing account status is server-side and payment-failed status is not rendered as active in the Paddle summary. |
| Paddle portal | PASS | No unrestricted Paddle customer portal session or portal link is exposed. |
| Paddle support/history | PARTIAL | The success page and contact/refund pages now identify Paddle. Historical provider-specific support was removed with the provider, and no provider transaction lookup is implemented there. |
| Paddle sandbox verification | NOT TESTED | No sandbox API key, webhook secret or sandbox price IDs were provided; no live/sandbox Paddle call was made. |

## Historical test commands and counts

```powershell
npx tsc --noEmit
npx prisma validate
npm test -- --run src/__tests__/entitlements.test.ts src/__tests__/recordings-access.test.ts
npm test -- --run src/__tests__/paddle-billing-contract.test.ts src/__tests__/paddle-webhook-route.test.ts
npm test -- --run src/__tests__/billing-accounts.test.ts src/__tests__/paddle-billing-contract.test.ts src/__tests__/paddle-webhook-route.test.ts src/__tests__/header-billing-status.test.tsx src/__tests__/pricing.test.ts
npm test -- --run src/__tests__/creator-download.test.ts src/__tests__/entitlements.test.ts src/__tests__/recordings-access.test.ts src/__tests__/export-limits.test.ts src/__tests__/export-platform-matrix.test.ts
$files = Get-ChildItem src\__tests__ -File | Where-Object { $_.Name -match '(export|recording|creator-download|entitlements|recordings-access)' -and $_.Name -match '\.test\.tsx?$' } | Sort-Object FullName | ForEach-Object { $_.FullName }; npx vitest run --run $files
powershell -ExecutionPolicy Bypass -File scripts/rehearse-paddle-migrations.ps1
```

Counts:

- TypeScript: PASS.
- Prisma schema: PASS, `The schema at prisma\schema.prisma is valid`.
- Entitlements/recordings: 36 passed.
- Paddle lifecycle contracts/webhook: 9 passed.
- Final Paddle/billing/pricing verification: 98 passed.
- Five affected suites: 36 passed, 38 database-backed skipped.
- Broad recording/export batch: 279 passed, 63 database-backed skipped, 26 files passed, 10 files skipped.

## SQL migration evidence

The guarded rehearsal command was run:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/rehearse-paddle-migrations.ps1
```

It returned `BLOCKED: Docker daemon unavailable; no database operation was
attempted.` The runner did not create a container or connect to any database.

The installed Docker client cannot reach `npipe:////./pipe/dockerDesktopLinuxEngine`.
`psql`, `pg_ctl`, and Podman are unavailable, and no PostgreSQL service is
installed. No migration SQL, constraints, FKs, indexes, or triggers were
executed against PostgreSQL. Prisma schema validation is not SQL integration
evidence.

Unit tests are not substituted for SQL integration evidence.

## Unresolved test failures

The previously observed standalone `creator-download.test.ts` failure was:

- Table: `users`
- Constraint: unique index `users_email_key`
- Conflict: fixed fixture `creator@example.com` remained in the application/database because the suite's no-op cleanup ran when the production URL was refused.

The fixture gate is fixed, and production-looking URLs are now stripped from the test process. The database-backed suite rerun is skipped until a disposable database exists; there is no unresolved assertion failure in the 279-test broad unit run.

## Earlier stabilization files

- `src/__tests__/helpers/test-database.ts`
- `src/__tests__/helpers/db.ts`
- `src/__tests__/setup.ts`
- `vitest.config.ts`
- `src/__tests__/creator-download.test.ts`
- `src/__tests__/export-limits.test.ts`
- `src/__tests__/export-platform-matrix.test.ts`
- `src/__tests__/paddle-billing-contract.test.ts`
- `src/__tests__/paddle-webhook-route.test.ts`
- `src/app/api/paddle/checkout/route.ts`
- `src/app/api/paddle/webhook/route.ts`
- `src/lib/billing/operations.ts`
- `src/lib/billing/paddle.ts`
- `prisma/schema.prisma`
- `prisma/migrations/20261118000000_paddle_billing/migration.sql`
- `scripts/rehearse-paddle-migrations.ps1`
- `docs/billing/MIGRATION-REHEARSAL.md`

## Files changed in the current execution

- `prisma/schema.prisma`
- `prisma/migrations/20261119000000_paddle_adjustment_amount/migration.sql`
- `src/lib/billing/operations.ts`
- `src/app/api/internal/paddle/worker/route.ts`
- `src/app/api/paddle/webhook/route.ts`
- `src/app/api/paddle/checkout/route.ts`
- `src/app/api/paddle/checkout/status/route.ts`
- `src/components/dialogs/PricingModal.tsx`
- `src/__tests__/paddle-billing-contract.test.ts`
- `src/__tests__/paddle-billing-operations.test.ts`
- `src/__tests__/paddle-worker-route.test.ts`
- `src/__tests__/paddle-webhook-route.test.ts`
- `src/__tests__/paddle-checkout-status-route.test.ts`
- `src/__tests__/pricing-modal-checkout-recovery.test.tsx`
- `scripts/rehearse-paddle-migrations.ps1`
- `docs/engineering/API-CONTRACTS.md`
- `docs/billing/PADDLE_MIGRATION_IMPLEMENTATION_REPORT.md`

## Sandbox prerequisites

- `PADDLE_ENVIRONMENT=sandbox` and an API key are configured.
- The webhook signing secret, monthly/yearly sandbox price IDs, sandbox
  amounts, and sandbox currency are not configured.
- `PADDLE_LIVE_CHECKOUT_DISABLED=true` remains set.
- No sandbox webhook endpoint was invoked.

No live checkout was activated.

## Safety confirmation

- No production or shared database was queried or migrated.
- No live Paddle API call or transaction was created.
- No deployment or Vercel environment change occurred.
- No commit, push or merge occurred.
- Adaptive recording files were not modified.

## TypeScript diagnostic resolution

The editor reported 14 stale `billingAccount`, `billingReservation`,
`billingEvent`, and `billingTransaction` Prisma delegate diagnostics. The
schema contains those models and `npx prisma generate` was re-run. `npx tsc
--noEmit` passes with no diagnostics after generation. The migration SQL was
also aligned so `billing_events.user_id` maps to `billing_accounts.user_id`
and the lease columns exist in both the schema and migration.

## Historical provider replacement verification (2026-11-18; superseded above)

| Verification item | Status | Finding |
| --- | --- | --- |
| Cashfree code deletion | PASS | Full repository and source scan found no remaining Cashfree identifiers or files. |
| Historical purchase entitlement preservation | PASS (source/schema) | The `users.plan` and `users.plan_expires_at` columns and the legacy entitlement tables remain in the schema/migrations. Existing paid terms continue to be evaluated through `isPlanActive`, and legacy Pro plans remain Creator entitlements. Historical purchase rows are not rewritten or re-granted. |
| Historical purchase support verification | PARTIAL | General Paddle-oriented contact, refund and success pages remain. Provider-specific historical order lookup, verify, receipt and reversal workflows are not available after complete provider removal. Existing bank/provider receipts or support records must be handled outside the app until a provider-neutral migration-support workflow is defined. |
| Paddle checkout route | PASS (contract) / NOT TESTED (sandbox) | Session auth, live-disable guard, quote consent hash, reservation persistence, and SDK transaction creation are implemented. No sandbox API call was run. |
| Paddle webhook route | PARTIAL | Raw body and SDK signature verification, event inbox, paid transaction re-read, and duplicate ID handling are implemented. `subscription.activated` currently cannot be safely correlated unless the event payload also carries and identifies a valid transaction; a subscription ID is not a transaction ID. |
| Subscription lifecycle | PARTIAL | Paid, failed/past-due, cancellation and subscription-updated event branches exist. Renewal next-charge and period-end fields depend on actual notification shape, provider correlation and database-backed verification. A webhook worker/scheduler route is absent. |
| Entitlement integration | PARTIAL | Paid events update `users.plan` and `planExpiresAt`; failed payments do not extend access. The server currently can create a grant from a paid event only after the transaction re-read and custom-data/ownership checks. |
| Refund/dispute integration | PARTIAL | Adjustment events mark transaction refund/dispute timestamps only. They do not revoke or isolate a stacked entitlement grant. Historical provider reversals are not recoverable through a provider-specific route. |
| Live checkout safety | PASS | Checkout, quote and cancellation gate on `isPaddleCheckoutEnabled()` (sandbox only), and the Paddle provider rejects non-sandbox environments. `PADDLE_LIVE_CHECKOUT_DISABLED` is reserved and no longer read by the routes. |

### Earlier missing readiness items (superseded by current implementation)

1. Revalidate checkout quote amount, currency and plan server-side before transaction
   creation. The checkout route currently verifies the consent hash but does not
   prove the submitted values match the server-generated quote.
2. Use actual Paddle transaction vs subscription event fields. `subscription.activated`
   must not be treated as a transaction ID lookup; add an authoritative
   transaction ID from the event or retrieve it from the subscription.
3. Normalize renewal period fields from Paddle transaction/subscription
   notifications and persist `nextChargeAt`.
4. Implement or schedule the durable event worker using the existing lease fields;
   the helpers exist but no worker route/scheduler invokes them.
5. Implement refund and dispute stacking isolation against the exact transaction
   and paid-through terms, rather than only snapshotting adjustment timestamps.
6. Complete database-backed migration and replay/rollback/worker tests before
   sandbox readiness.

### No provider activation

Required Paddle sandbox settings are incomplete. No sandbox or live checkout,
webhook, transaction, cancellation, or refund call was made.

## Pre-deployment review (2026-11-20, later pass)

Status: **LOCAL PASS for the reviewed code; PRODUCTION BLOCKED; SANDBOX NOT VERIFIED**

No deployment, commit, push, Vercel setting change or payment was performed.

### 1. Cron compatibility and webhook-triggered processing

- `vercel.json` has only daily schedules: worker `0 3 * * *`, export cleanup
  `0 2 * * *`. Nothing uses `*/5`.
- The webhook route keeps `after(triggerBillingWorker)` so the acknowledgement is
  not delayed, raises `maxDuration` to 60 s, gives the trigger a 50 s deadline,
  retries once on a connection-level failure, and does not retry a non-2xx
  answer. Duplicate receipts also retrigger a sweep; the worker's lease fences
  make that safe.
- Tests: `paddle-webhook-route.test.ts` (9) covers first receipt, duplicate
  receipt, connection-failure retry and answered-error no-retry.
- **Production blocker:** `GET /api/internal/paddle/worker` returns
  `503 {"error":"Billing worker is not configured"}`. That branch requires
  `CRON_SECRET`; therefore neither the webhook trigger nor the daily cron can
  authenticate in production today. The deployed commit (`b5437a5`, reported by
  `/api/health`) still awaits the trigger synchronously with a 5 s abort, so the
  reviewed trigger/drain changes are also not deployed.

### 2. Sandbox checkout URL allowlist and `/pay` handoff

- `isSafePaddleCheckoutUrl` accepts HTTPS URLs whose origin and normalized path
  match `PADDLE_CHECKOUT_URL`/`PADDLE_CHECKOUT_URLS`; the query (including
  `_ptxn`) is ignored, so a Paddle-returned `_ptxn` link passes.
- `toPaddleHandoffUrl` adds `_ptxn` when Paddle omits it and rejects a
  conflicting value; the checkout route returns 503 instead of handing over an
  unsafe URL.
- Tests: contract test covers append, idempotent append, conflict, wrong path,
  HTTP and empty transaction id; the page test covers sandbox + `test_` token +
  `txn_[a-z0-9]{26}` gating.
- **Production blocker:** `GET /pay` returns 404. `src/app/pay/` is untracked and
  is not part of `b5437a5`, so the handoff target does not exist in production.
  The `next.config.ts` `/pay` CSP additions are likewise undeployed.

### 3. Entitlement locking consistency

- Payment, refund/dispute, failed-payment and subscription projections already
  take `lockBillingUser` (`SELECT ... FOR UPDATE`).
- The cancel route previously wrote `billingAccount.cancelAtPeriodEnd` in an
  unlocked array `$transaction`; it now calls `recordCancellationRequest`, which
  locks the user, re-checks the operation is `pending`, verifies subscription
  ownership, completes the operation and stamps `lastEventAt` from the same
  locked read.
- Worker reconciliation previously wrote the account unlocked; it now calls
  `completeReconciledCancellation`, fenced on `pending|uncertain` and under the
  same lock.
- A provider snapshot that precedes a locally confirmed cancellation can no
  longer clear it: `applySubscriptionSnapshot` checks for a completed
  `cancel_at_period_end` operation with `completedAt >= occurredAt`.
- Tests: three new operations tests (lock-before-read, ownership rejection,
  stale-snapshot guard) and two new worker tests (reconciled completion,
  provider-confirms-not-scheduled failure).

### 4. Original production HTTP 503

Not attributed, and not claimed fixed. Read-only probe evidence (no credentials,
no state change) against `https://studio.supersmartx.com`:

| Request | Status | Body |
| --- | --- | --- |
| `GET /api/health` | 200 | commit `b5437a5` |
| `GET /pay` | 404 | HTML 404 |
| `GET /api/internal/paddle/worker` | 503 | `Billing worker is not configured` |
| `GET /api/export-jobs/cleanup` | 401 | `Unauthorized` |
| `POST /api/paddle/webhook` (unsigned) | 401 | `Invalid webhook signature` |
| `GET /api/paddle/{billing,quote,checkout/status}` | 401 | `Unauthorized` |

The only 503 reproducible without a Studio session is the worker's missing
`CRON_SECRET`. Checkout/quote/cancel 503 branches sit behind session auth and
cannot be attributed from outside. Attributing the originally reported 503
requires the Vercel function log for that request (path, timestamp, response
body) or the `x-vercel-id`; the route 503 reasons are: live environment,
checkout disabled, Paddle client not configured, price lookup/mismatch,
checkout URL not configured, and provider outcome uncertain.

### 5. Live checkout disabled

- `isPaddleCheckoutEnabled()` returns true only for `PADDLE_ENVIRONMENT=sandbox`;
  quote, checkout and cancel all gate on it (503 otherwise).
- Provider methods `assertSandboxPriceMatches`, `createSandboxCheckout`,
  `cancelSandboxSubscription` (and the billing-provider create path) throw unless
  the environment is sandbox.
- `/pay` requires sandbox plus a `test_` client token plus a 26-char `txn_` id.
- `PADDLE_LIVE_CHECKOUT_DISABLED` is now documentation-only: live stays disabled
  structurally, so the flag's value cannot enable live. Source check completed;
  the production environment value was not readable without Vercel access.

### 6. No data, pricing, entitlement or environment changes

- Repository: no `prisma/` schema or migration changes, no pricing or
  entitlement module changes, and no tracked `.env`/`.env.local` changes.
  `.env.example` is the only env-surface file touched (template comments and new
  variable names, no values).
- No database statement was executed and no production environment variable was
  written. Vercel environment state was not readable from this workstation.

### 7. Verification

```powershell
npx vitest run <25 billing/security suites>
npx tsc --noEmit
npx eslint <18 touched source/test files>
```

Result: **19 files passed / 6 skipped; 260 tests passed, 106 skipped** (skips
need `DATABASE_URL`, e.g. `security.test.ts`); TypeScript and focused ESLint
exited 0. This is local evidence only.


## Post-deployment evidence (2026-11-20, 09:04–09:07 UTC)

Read-only production observations after deployment `dpl_5t4iLcWvctGCefWQ7MNNPGsBaAH7`:

- `GET /api/health` → 200, `commit: 808c100`; working tree clean against HEAD, so
  production runs exactly the reviewed code (the earlier "production still runs
  `b5437a5`" status is superseded).
- `GET /pay` → 200 (handoff page deployed).
- `GET /api/internal/paddle/worker` → **503** `{"error":"Billing worker is not configured"}`,
  i.e. `CRON_SECRET` is still unset. The webhook trigger returns silently when
  `CRON_SECRET` is missing, and the daily cron receives the same 503, so no
  queued event can be processed and no entitlement can be granted.
- `POST /api/paddle/webhook` without a signature → 401 `Invalid webhook signature`
  (not 503), so `PADDLE_WEBHOOK_SECRET` and the Paddle client are configured.
- `POST /api/paddle/checkout` → 409 after one outbound `GET`, 4.45 s. The route
  can only reach this 409 after session auth, the sandbox gate, quote/consent
  verification and `paddle.prices.get`. That proves production sandbox env,
  API key, price IDs and quote signing are valid and the quote matches the
  provider price. The reachable 409 branch is then `reserveCheckout`: an
  existing reservation in `reserved`/`pending` (`UnresolvedCheckoutReservationError`,
  `src/lib/billing/operations.ts:129`, or its P2002 twin). Quote/consent 409s
  precede the Paddle call; `ActiveBillingSubscriptionError` is unreachable while
  the worker is 503 because no account can carry a provider subscription.
- Recovery gap: when the stale reservation has no `providerTransactionId` and
  Paddle holds no matching transaction, `/api/paddle/checkout/status` returns
  `pending` with `retryAllowed: false` indefinitely (no reservation expiry in
  `reserveCheckout`). Progress then requires a one-off reservation-state fix.
- The original 503 remains unattributed: this log is a checkout 409, not a 503.
