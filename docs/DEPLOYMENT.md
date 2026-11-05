# Deployment

> **Canonical copy: repository root [`DEPLOYMENT.md`](../DEPLOYMENT.md)**
> (Phase 5 / F-14 — root made canonical). The root file carries the full
> strategy: environment reference, R2 CORS procedure, migrations, rollback,
> health checks. This short-form promote/smoke checklist is a convenience
> summary — if the two ever disagree, the root file wins.

Target: Vercel (`vercel.json` cron included). Any Next.js 16-capable host
works if cron and env are provided equivalently.

## Promote checklist

1. Set ALL production env vars (ENVIRONMENT.md), especially `NEXTAUTH_SECRET`,
   `NEXT_PUBLIC_APP_URL` (= canonical `https://studio.supersmartx.com`),
   `DATABASE_URL` + `DIRECT_URL`, Cashfree pair + mode, R2 quartet.
2. CI must be green: lint → typecheck → test → e2e → build
   (`.github/workflows/ci.yml`; e2e/build wait for the first three).
3. `npm run build` must pass with no missing-env warnings except knowingly
   optional ones.
4. Apply schema changes first: `npx prisma migrate status` (read-only), then
   `npx prisma migrate deploy` — the runtime does not migrate on request.
   Migrations are additive-only, so rolling forward is safe and a rollback
   needs no schema change. Never `prisma db push`. See DATABASE.md.
5. Vercel cron `GET /api/export-jobs/cleanup` (`0 2 * * *`) requires
   `CRON_SECRET` = `CLEANUP_SECRET` (see ENVIRONMENT.md).
6. Domain: apex + www redirect to `studio.` (see `next.config.ts`
   redirects); HSTS preload is enabled — only serve HTTPS.

## Post-deploy smoke

- `GET /api/health` → ok.
- Signup → login → logout; wrong-password ×6 → lockout message.
- Free: 720p YouTube export succeeds locally; Instagram format rejected 403.
- Creator (mocked order + webhook in isolated validation; no Sandbox on Production): 1080p presigned upload → complete →
  download URL works, then expires.
- Password reset invalidates old sessions.

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
