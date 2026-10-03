# Environment Variables

Source of truth for names: `.env.example`. Required in production:

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT/session signing | ≥32 chars, random. Auth refuses to start in prod without it (`src/auth.ts`) |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | Absolute URLs (OAuth, Cashfree return URL) | Must be `https://studio.supersmartx.com` in prod |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Production database | Without them the app falls back to local file, or `:memory:` on serverless (DATA LOSS — see DATABASE.md) |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | Payments | Build warns if missing; order API 503s. `CASHFREE_SECRET_KEY` is also the webhook-signing key — Cashfree publishes no separate webhook secret |
| `CASHFREE_ENV` / `NEXT_PUBLIC_CASHFREE_ENV` | `sandbox` vs `production` | Must match Cashfree dashboard mode AND each other — see below |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 | All four required; else 503. Bucket must be PRIVATE |
| `R2_SIGNED_URL_TTL_SECONDS` | Download URL TTL | Default 3600 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth | Optional; enables Google provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email receipts | Optional; payment mail is best-effort (`Promise.allSettled`) |
| `CLEANUP_SECRET` | Nightly export-job cleanup auth | Constant-time compared; endpoint 401s without it |
| `ADMIN_EMAIL` | Admin payment notifications | Optional |
| `DISCORD_WEBHOOK_URL` | Monitoring alerts | Optional |

`next.config.ts` only warns (does not throw) on missing vars at build time —
validate env in the deployment pipeline before promoting.

## Cashfree environment split (fail closed)

The two variables are read by different runtimes and are easy to desynchronize:

- `CASHFREE_ENV` is read at request time on the server (`getCashfreeEnv()`) and
  selects the API host used to create and verify orders.
- `NEXT_PUBLIC_CASHFREE_ENV` is inlined at build time and fixes the Cashfree
  checkout SDK's mode in the browser.

If they disagree, checkout renders in one Cashfree environment while the order
and its webhook live in the other, so the payment can never settle into an
activation. Both failure modes are therefore blocked:

- `isCashfreeEnvConsistent()` logs `payment.env_mismatch` and
  `/api/cashfree/order` returns 503 instead of creating an order.
- The order response carries the authoritative `env`; the client compares it to
  its loaded SDK mode and aborts with a retry message on mismatch.

Only the exact value `production` selects live. Any other value is treated as
`sandbox`, so a typo can never route production traffic at live credentials.
Because the public value is baked in at build time, changing environments
requires a rebuild, not just a redeploy.
