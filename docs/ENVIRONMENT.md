# Environment Variables

Source of truth for names: `.env.example`. Required in production:

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT/session signing | ≥32 chars, random. Auth refuses to start in prod without it (`src/auth.ts`) |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | Absolute URLs (OAuth, Cashfree return URL) | Must be `https://studio.supersmartx.com` in prod |
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL (Supabase) | **Both required** — `DATABASE_URL` is the Supavisor transaction pooler (`:6543`) used at runtime; `DIRECT_URL` is the session/direct connection (`:5432`) Prisma Migrate needs. Production fails closed with `DATABASE_NOT_CONFIGURED` when `DATABASE_URL` is missing or is not a `postgres://` DSN. There is no file/in-memory fallback in any environment. See DATABASE.md |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | Payments | Production build fails if missing; payment APIs fail closed. `CASHFREE_SECRET_KEY` is also the webhook-signing key — Cashfree publishes no separate webhook secret |
| `CASHFREE_ENV` / `NEXT_PUBLIC_CASHFREE_ENV` | Production-only on Vercel Production | Must match Cashfree dashboard mode AND each other — see below |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 | All four required; else 503. Bucket must be PRIVATE |
| `R2_SIGNED_URL_TTL_SECONDS` | Download URL TTL | Default 3600 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth | Optional; enables Google provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email receipts | Optional; payment mail is best-effort (`Promise.allSettled`) |
| `CLEANUP_SECRET` | Nightly export-job cleanup auth | Constant-time compared; endpoint 401s without it |
| `BILLING_OPS_SECRET` | `/api/internal/billing/orders` operator auth | Separate from `CLEANUP_SECRET` by design. SHA-256 digests compared in constant time; unset → `503`, wrong → `401`. Never printed or logged |
| `ADMIN_EMAIL` | Admin payment notifications | Optional |
| `DISCORD_WEBHOOK_URL` | Feedback submissions (`POST /api/feedback` only — not an alert channel) | Optional; unset → feedback returns 503 |

`next.config.ts` enforces Cashfree requirements on Vercel Production builds. Other services retain their existing validation.

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

## Billing operations secret

`BILLING_OPS_SECRET` guards `GET|POST /api/internal/billing/orders`, the only
route that can release a PAID-but-unapplied order or force a pending order
through the reconciliation state machine. It is intentionally **not**
`CLEANUP_SECRET`: the two rotate independently, and compromising the export
cleanup job must not grant the ability to move entitlement-bearing orders.

- Set it per environment in the hosting dashboard; this repository never holds
  a value and never prints one.
- Unset → every call answers `503 Billing operations endpoint is not configured`
  (fail closed — there is no unauthenticated mode).
- Wrong or missing credential → `401`. Comparison is over SHA-256 digests with
  `crypto.timingSafeEqual`, so length and prefix leak nothing.
- Send it as `Authorization: Bearer <secret>` or `x-billing-ops-secret: <secret>`.
- Responses are `Cache-Control: no-store`.

Rotating it is a plain env change plus redeploy; no code or data migration is
involved. An in-flight operator session just starts getting `401`.
