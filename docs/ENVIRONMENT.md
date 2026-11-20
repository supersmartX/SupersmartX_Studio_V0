# Environment Variables

Source of truth for names: `.env.example`. Required in production:

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT/session signing | ≥32 chars, random. Auth refuses to start in prod without it (`src/auth.ts`) |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | Absolute URLs (OAuth, Paddle return URL) | Must be `https://studio.supersmartx.com` in prod |
| `DATABASE_URL`, `DIRECT_URL` | PostgreSQL (Supabase) | **Both required** — `DATABASE_URL` is the Supavisor transaction pooler (`:6543`) used at runtime; `DIRECT_URL` is the session/direct connection (`:5432`) Prisma Migrate needs. Production fails closed with `DATABASE_NOT_CONFIGURED` when `DATABASE_URL` is missing or is not a `postgres://` DSN. There is no file/in-memory fallback in any environment. See DATABASE.md |
| `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET` | Paddle SDK and signed webhook inbox | Server-only; `PADDLE_ENVIRONMENT` must be explicitly `sandbox` or `live`. Missing/invalid mode disables the SDK client. |
| `PADDLE_ENVIRONMENT` | Paddle SDK environment | Explicit `sandbox` or `live`; never inferred from `NODE_ENV`. Current checkout and cancellation mutations are sandbox-only. |
| `PADDLE_LIVE_CHECKOUT_DISABLED` | Reserved checkout safety gate | Current code permits checkout and cancellation only in `sandbox`, so live mutations stay disabled regardless of this value. It stays `true` until a reviewed change adds live support; enabling live requires sandbox evidence, DB rehearsal, and production-readiness approval first. |
| `PADDLE_CHECKOUT_URL` | Approved merchant payment page | Primary HTTPS page (origin + path) that `checkoutUrl` must match. Paddle builds the returned link from this page; set the Paddle default payment link (sandbox) to the same URL so the returned path matches. The server supplies `_ptxn` when Paddle omits it and rejects a conflicting value. Other hosts, paths, credentials, or fragments are rejected. Unset → checkout answers `503`. |
| `PADDLE_CHECKOUT_URLS` | Additional approved payment pages | Optional comma-separated extras matched by origin + path (for example a preview domain). Same safety rules as the primary page. |
| `PADDLE_CLIENT_TOKEN` | Paddle.js sandbox client token | Server-rendered into `/pay`; must be a public `test_…` token, never the API key. The page refuses to render without a sandbox environment and a matching token. |
| `PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY`, `PADDLE_SANDBOX_PRICE_CREATOR_YEARLY` | Sandbox catalog mapping | Must identify active recurring Paddle prices with no trial, price override, or unreviewed tax total. |
| `PADDLE_SANDBOX_AMOUNT_MONTHLY`, `PADDLE_SANDBOX_AMOUNT_YEARLY`, `PADDLE_SANDBOX_CURRENCY` | Sandbox quote mapping | Checked against the Paddle price and paid transaction before checkout/grant. |
| `PADDLE_LIVE_PRICE_CREATOR_MONTHLY`, `PADDLE_LIVE_PRICE_CREATOR_YEARLY`, `PADDLE_LIVE_AMOUNT_MONTHLY`, `PADDLE_LIVE_AMOUNT_YEARLY`, `PADDLE_LIVE_CURRENCY` | Reserved live mapping | Not used for checkout; live mutations remain disabled. |
| `CRON_SECRET` | Project cron bearer secret | Vercel sends `Authorization: Bearer $CRON_SECRET` to every cron path. The Paddle worker compares it directly; the cleanup route compares it against `CLEANUP_SECRET`, so `CLEANUP_SECRET` must hold the same value. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 | All four required; else 503. Bucket must be PRIVATE |
| `R2_SIGNED_URL_TTL_SECONDS` | Download URL TTL | Default 3600 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth | Optional; enables Google provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Password reset and Studio payment confirmations | Optional; Paddle confirmation is sent after `transaction.completed`, best-effort, to Paddle's verified customer email. Paddle sends the official invoice separately. |
| `CLEANUP_SECRET` | Nightly export-job cleanup auth | Constant-time compared; endpoint 401s without it. Must equal `CRON_SECRET`, because Vercel sends one bearer value to both cron paths. |
| `ADMIN_EMAIL` | Admin payment notifications | Optional |
| `DISCORD_WEBHOOK_URL` | Feedback submissions (`POST /api/feedback` only — not an alert channel) | Optional; unset → feedback returns 503 |

## Paddle Billing release gates

Checkout and cancellation mutations are implemented for `PADDLE_ENVIRONMENT=sandbox`
only (`isPaddleCheckoutEnabled()`), and every payment route fails closed with
`503` when the environment, SDK client, catalog mapping, or approved payment page
is missing. Live checkout requires a reviewed code change plus the evidence in
`PADDLE_MIGRATION_IMPLEMENTATION_REPORT.md`. No live payment is required for
automated tests: use mocked network and dummy credentials.

Verified webhook events are applied by `GET /api/internal/paddle/worker`, which
is triggered after each first-time webhook receipt and re-run by Vercel Cron once
daily (`0 3 * * *`) as a recovery sweep. It authenticates with `CRON_SECRET`.
Failed events remain in `billing_events` with `status='review'` and `last_error`;
there is no operator endpoint that releases entitlement for Paddle Billing.
