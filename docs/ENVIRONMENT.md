# Environment Variables

Source of truth for names: `.env.example`. Required in production:

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | JWT/session signing | ≥32 chars, random. Auth refuses to start in prod without it (`src/auth.ts`) |
| `NEXTAUTH_URL` / `NEXT_PUBLIC_APP_URL` | Absolute URLs (OAuth, Cashfree return URL) | Must be `https://studio.supersmartx.com` in prod |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Production database | **Required in production** — the driver fails closed with `DATABASE_NOT_CONFIGURED` when they are missing (no `:memory:` fallback in production; see DATABASE.md). Local dev falls back to `data/supersmartx.db` |
| `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY` | Payments | Build warns if missing; order API 503s. `CASHFREE_SECRET_KEY` is also the webhook-signing key — Cashfree publishes no separate webhook secret |
| `CASHFREE_ENV` / `NEXT_PUBLIC_CASHFREE_ENV` | `sandbox` vs `production` | Must match Cashfree dashboard mode AND each other — see below |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` | Cloudflare R2 | All four required; else 503. Bucket must be PRIVATE |
| `R2_SIGNED_URL_TTL_SECONDS` | Download URL TTL | Default 3600 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth | Optional; enables Google provider |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Email receipts | Optional; payment mail is best-effort (`Promise.allSettled`) |
| `CLEANUP_SECRET` | Nightly export-job cleanup auth | Constant-time compared; endpoint 401s without it |
| `ADMIN_EMAIL` | Admin payment notifications | Optional |
| `DISCORD_WEBHOOK_URL` | Feedback submissions (`POST /api/feedback` only — not an alert channel) | Optional; unset → feedback returns 503 |

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

Only the two exact values `sandbox` and `production` are accepted, on both sides.
Anything else — unset, empty, misspelt, wrong case — fails closed with
`cashfree_env_invalid`; no value is ever substituted, and an unknown value never
quietly becomes `sandbox`. `sandbox` is a legitimate choice in a production
deployment, so the guard does not consult `NODE_ENV`: `CASHFREE_ENV` alone
selects the Cashfree environment, which keeps "how the app is deployed" and
"which gateway it talks to" independent.

Because the public value is baked in at build time, changing environments
requires a rebuild, not just a redeploy.

### Switching between Sandbox and Production

Both variables plus the matching Cashfree App ID / Secret Key, then redeploy.
No code change is involved.

| Goal | `CASHFREE_ENV` | `NEXT_PUBLIC_CASHFREE_ENV` | Credentials |
| ---- | -------------- | ------------------------- | ----------- |
| Test against Sandbox | `sandbox` | `sandbox` | Sandbox keys |
| Take live payments | `production` | `production` | Production keys |
