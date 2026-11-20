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
   `DATABASE_URL` + `DIRECT_URL`, Paddle pair + mode, R2 quartet.
2. CI must be green: lint → typecheck → test → e2e → build
   (`.github/workflows/ci.yml`; e2e/build wait for the first three).
3. `npm run build` must pass with no missing-env warnings except knowingly
   optional ones.
4. Apply schema changes first: `npx prisma migrate status` (read-only), then
   `npx prisma migrate deploy` — the runtime does not migrate on request.
   Migrations are additive-only, so rolling forward is safe and a rollback
   needs no schema change. Never `prisma db push`. See DATABASE.md.
5. Vercel crons: `GET /api/internal/paddle/worker` (`0 3 * * *`, daily — Hobby
   does not allow sub-daily schedules; webhook receipts trigger it in between)
   uses `CRON_SECRET`; `GET /api/export-jobs/cleanup` (`0 2 * * *`) compares the
   same bearer against `CLEANUP_SECRET`. Vercel sends one bearer value to both,
   so set `CLEANUP_SECRET` to the same value as `CRON_SECRET`.
6. Domain: apex + www redirect to `studio.` (see `next.config.ts`
   redirects); HSTS preload is enabled — only serve HTTPS.

## Post-deploy smoke

- `GET /api/health` → ok.
- Signup → login → logout; wrong-password ×6 → lockout message.
- Free: 720p YouTube export succeeds locally; Instagram format rejected 403.
- Creator (mocked order + webhook in isolated validation; no Sandbox on Production): 1080p presigned upload → complete →
  download URL works, then expires.
- Password reset invalidates old sessions.

## Paddle environment enforcement

The current release is **sandbox-only**. `isPaddleCheckoutEnabled()` returns true
only for `PADDLE_ENVIRONMENT=sandbox`, so quote, checkout, and cancel answer
`503` in `live` regardless of credentials. Live checkout requires a reviewed code
change plus the evidence in `PADDLE_MIGRATION_IMPLEMENTATION_REPORT.md`.

- `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, and an explicit `PADDLE_ENVIRONMENT`
  (`sandbox` or `live`) are required. Missing/invalid mode disables the SDK client
  and every payment route fails closed.
- `PADDLE_CHECKOUT_URL` (plus optional `PADDLE_CHECKOUT_URLS`) must be an approved
  HTTPS page; the returned `checkoutUrl` is rejected unless its origin and path
  match one of them. `/pay` additionally requires a `test_…` `PADDLE_CLIENT_TOKEN`.
- `next.config.ts` warns (does not reject the build) about missing payment
  credentials; CSP allows Paddle.js and `*.paddle.com` frames only on `/pay`.
- `PADDLE_LIVE_CHECKOUT_DISABLED` is reserved for the future live change and is
  not consulted by current code; keep it `true`.
- Before cutover, confirm the production database contains only
  production-origin payment records. The deployment contains no record migration,
  deletion, or reset.

For isolated local development use sandbox credentials and a disposable
database. Never copy production credentials or the production database into
local payment tests. No live payment is required for automated tests: use
mocked network and dummy credentials.
