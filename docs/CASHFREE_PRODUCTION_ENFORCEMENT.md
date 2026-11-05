# Cashfree Production enforcement - 2026-11-06

Scope: approved implementation only; no commit, deployment, Vercel changes,
production data access, migrations, credential changes or real transactions.

## Cashfree Production enforcement

Vercel Production must have `CASHFREE_ENV=production`,
`NEXT_PUBLIC_CASHFREE_ENV=production`, `CASHFREE_API_VERSION=2022-09-01`, and
matching Production `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` supplied by the
operator. Credentials are server-only and must never be printed or committed.
The key is also used to verify webhook signatures.

`next.config.ts` rejects a Production build when any payment requirement is
missing or invalid. `VERCEL_ENV` / `VERCEL_TARGET_ENV` identify the deployment;
`NODE_ENV=production` alone also describes local builds and is not sufficient.
Vercel must expose system environment variables. Missing/contradictory hosted
context fails closed. Build-derived mode and Production-lock constants prevent
changing gateway environments within an artifact. Never override these constants.
Every payment path validates the same configuration before gateway access or
reconciliation. Production gateway requests use `https://api.cashfree.com/pg`,
`x-api-version: 2022-09-01`, and reject redirects. There is no API-version fallback.
Production CSP excludes Sandbox API and payment-frame hosts. The browser refuses
Sandbox mode in Production builds and checks the environment on both new and
resumed checkout sessions.

For isolated local development use the Sandbox selectors in `.env.example`,
Sandbox credentials and a disposable database. Never copy Production credentials
or the Production database into local payment tests. Explicit local Production
configuration still means real payments: it is never selected as a fallback.
Changing mode requires a fresh build. Production environment changes require a
new Production build; do not promote a Sandbox/Preview artifact.

Before cutover, the operator must confirm the Production database contains only
Production-origin payment records. Historical pending orders have no environment
column. An order missing from Production may exist in Sandbox; do not let a mode
switch reinterpret its absence or automatically release it. Unknown provenance is
a rollout blocker requiring operator investigation, not cleanup. This change
contains no record migration, deletion or reset. Existing W2/W8 locking, uncertain
order handling, signature validation and transactional fulfillment are retained.

Code validates credential presence/format, not merchant ownership or authenticity.
Operator verification of the Production credential pair remains required. Confirm
that API version `2022-09-01` supports termination for this merchant before live
rollout; refused/uncertain termination must keep checkout blocked. No live payment
is required for automated tests: use mocked network and dummy credentials.

## Implementation

- src/lib/cashfree-config.ts is the shared server/build configuration validator.
- next.config.ts enforces build requirements and embeds only non-secret mode locks.
- Order creation, verification, webhook payment/reversal handling, lifecycle
  probes/termination and operator reconciliation share the same configuration.
- Reconciliation entry points validate before touching orders. W2/W8 transition
  decisions, locking, signatures and settlement transactions remain unchanged.
- Browser SDK initialization rejects invalid mode before script loading; async
  initialization failures reject the promise. New/resumed checkout must match
  server environment, including remembered price acceptance.
- .env.example retains explicit local Sandbox. CI build uses dummy payment values;
  unit tests mock gateway access. Production credentials remain operator-managed.

## Acceptance criteria

Given Vercel Production, when any required variable is missing, mismatched or
invalid, then the build fails and runtime payment paths refuse before payment
records are touched or Cashfree is contacted.

Given valid Production configuration, when create/read/probe/terminate executes,
then the host is api.cashfree.com and x-api-version is 2022-09-01, with redirects
rejected. Browser SDK mode is production and CSP excludes Sandbox hosts.

Given a Production artifact, when runtime gateway selection changes, then payment
operations fail closed. Given isolated local Sandbox, explicit matching settings
continue to work, including local production-mode builds.

Given an uncertain pending order, when configuration or a gateway request fails,
then no automatic release is introduced by this change.

## Verification results

- Final targeted run: 10 test files, 167 tests passed. Gateway and database access
  were mocked; DATABASE_URL and DIRECT_URL were empty for test runs.
- Earlier targeted run also loaded the database-gated payment integrity,
  fulfillment and Phase 2 suites: 72 database-dependent tests were skipped.
  Those integration tests were not run against any live database.
- TypeScript check passed. Final Production build passed, including its TypeScript
  check, with dummy Cashfree values and an unreachable loopback database URL.
- Negative Production build with both selectors set to Sandbox failed as expected
  with cashfree_production_required (exit 1).
- Twenty generated client JavaScript bundles contained neither dummy credential.
  Generated Production CSP contained neither Sandbox nor payment-test hosts.
- Changed TypeScript lint: zero errors, five warnings (ignored next.config.ts,
  existing unused bindings/directives). Build reports the existing middleware
  convention deprecation. git diff --check passed.

These checks do not verify live merchant credentials, historical order provenance,
API termination support, or the operator's deployed Vercel settings. Those remain
rollout gates. No payment records or Vercel configuration were changed.

## Changed files

Unrelated recording validation work already present in the working tree is excluded.

- `.env.example`
- `.github/workflows/ci.yml`
- `DEPLOYMENT.md`
- `docs/API-CONTRACTS.md`
- `docs/CASHFREE_PRODUCTION_ENFORCEMENT.md`
- `docs/DEPLOYMENT.md`
- `docs/ENVIRONMENT.md`
- `docs/LOCAL_DEVELOPMENT.md`
- `docs/PRODUCTION-RUNBOOK.md`
- `docs/ROLLBACK.md`
- `next.config.ts`
- `src/__tests__/activation-verdict.test.ts`
- `src/__tests__/billing-ops-route.test.ts`
- `src/__tests__/cashfree-order-lifecycle.test.ts`
- `src/__tests__/cashfree-production-config.test.ts`
- `src/__tests__/order-open-checkout.test.ts`
- `src/__tests__/order-price-response.test.ts`
- `src/__tests__/payment-fulfillment.test.ts`
- `src/__tests__/payment-integrity.test.ts`
- `src/__tests__/pending-order-reconcile.test.ts`
- `src/__tests__/phase2-server-hardening.test.ts`
- `src/__tests__/pricing-modal-open-checkout.test.tsx`
- `src/__tests__/state-machine-certification.test.ts`
- `src/app/api/cashfree/order/route.ts`
- `src/app/api/cashfree/verify/route.ts`
- `src/app/api/cashfree/webhook/route.ts`
- `src/app/api/internal/billing/orders/route.ts`
- `src/components/dialogs/PricingModal.tsx`
- `src/lib/cashfree-config.ts`
- `src/lib/cashfree-fulfillment.ts`
- `src/lib/cashfree-order-lifecycle.ts`
- `src/lib/cashfree.ts`
- `src/lib/pending-order-reconcile.ts`
