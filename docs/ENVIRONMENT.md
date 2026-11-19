# Environment Variables

Source of truth for names: `.env.example`. Required in production:

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT/session signing | ≥32 chars, random. Auth refuses to start in prod without it (`src/auth.ts`) |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | Absolute URLs (OAuth, Paddle return URL) | Must be `https://studio.supersmartx.com` in prod |
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL (Supabase) | **Both required** — `DATABASE_URL` is the Supavisor transaction pooler (`:6543`) used at runtime; `DIRECT_URL` is the session/direct connection (`:5432`) Prisma Migrate needs. Production fails closed with `DATABASE_NOT_CONFIGURED` when `DATABASE_URL` is missing or is not a `postgres://` DSN. There is no file/in-memory fallback in any environment. See DATABASE.md |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | Paddle SDK and signed webhook inbox | Server-only; `PADDLE_ENVIRONMENT` must be explicitly `sandbox` or `live`. Missing/invalid mode disables the SDK client. |
| `PADDLE_ENVIRONMENT` | Paddle SDK environment | Explicit `sandbox` or `live`; never inferred from `NODE_ENV`. Current checkout and cancellation mutations are sandbox-only. |
| `PADDLE_LIVE_CHECKOUT_DISABLED` | Checkout safety gate | Must remain `true` until sandbox evidence, DB rehearsal, and production-readiness approval are complete. |
| `PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY`, `PADDLE_SANDBOX_PRICE_CREATOR_YEARLY` | Sandbox catalog mapping | Must identify active recurring Paddle prices with no trial, price override, or unreviewed tax total. |
| `PADDLE_SANDBOX_AMOUNT_MONTHLY`, `PADDLE_SANDBOX_AMOUNT_YEARLY`, `PADDLE_SANDBOX_CURRENCY` | Sandbox quote mapping | Checked against the Paddle price and paid transaction before checkout/grant. |
| `PADDLE_LIVE_PRICE_CREATOR_MONTHLY`, `PADDLE_LIVE_PRICE_CREATOR_YEARLY`, `PADDLE_LIVE_AMOUNT_MONTHLY`, `PADDLE_LIVE_AMOUNT_YEARLY`, `PADDLE_LIVE_CURRENCY` | Reserved live mapping | Not used for checkout; live mutations remain disabled. |
| `CRON_SECRET` | Scheduled Paddle inbox worker | Vercel Cron bearer secret; keep separate from the export cleanup secret. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 | All four required; else 503. Bucket must be PRIVATE |
| `R2_SIGNED_URL_TTL_SECONDS` | Download URL TTL | Default 3600 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth | Optional; enables Google provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email receipts | Optional; payment mail is best-effort (`Promise.allSettled`) |
| `CLEANUP_SECRET` | Nightly export-job cleanup auth | Constant-time compared; endpoint 401s without it |
| `BILLING_OPS_SECRET` | `/api/internal/billing/orders` operator auth | Separate from `CLEANUP_SECRET` by design. SHA-256 digests compared in constant time; unset → `503`, wrong → `401`. Never printed or logged |
| `ADMIN_EMAIL` | Admin payment notifications | Optional |
| `DISCORD_WEBHOOK_URL` | Feedback submissions (`POST /api/feedback` only — not an alert channel) | Optional; unset → feedback returns 503 |

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
