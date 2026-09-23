# Environment Variables

Source of truth for names: `.env.example`. Required in production:

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT/session signing | ≥32 chars, random. Auth refuses to start in prod without it (`src/auth.ts`) |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | Absolute URLs (OAuth, Cashfree return URL) | Must be `https://studio.supersmartx.com` in prod |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Production database | Without them the app falls back to local file, or `:memory:` on serverless (DATA LOSS — see DATABASE.md) |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | Payments | Build warns if missing; order API 503s |
| `CASHFREE_ENV` / `NEXT_PUBLIC_CASHFREE_ENV` | `sandbox` vs `production` | Must match Cashfree dashboard mode |
| `CASHFREE_WEBHOOK_SECRET` | Webhook HMAC verification | Falls back to `CASHFREE_SECRET_KEY` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 | All four required; else 503. Bucket must be PRIVATE |
| `R2_SIGNED_URL_TTL_SECONDS` | Download URL TTL | Default 3600 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth | Optional; enables Google provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email receipts | Optional; payment mail is best-effort (`Promise.allSettled`) |
| `CLEANUP_SECRET` | Nightly export-job cleanup auth | Constant-time compared; endpoint 401s without it |
| `ADMIN_EMAIL` | Admin payment notifications | Optional |
| `DISCORD_WEBHOOK_URL` | Monitoring alerts | Optional |

`next.config.ts` only warns (does not throw) on missing vars at build time —
validate env in the deployment pipeline before promoting.
