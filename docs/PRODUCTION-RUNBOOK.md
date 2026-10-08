# Production Runbook — SupersmartX Studio

> Phase 4 deliverable. Operational reference for the production environment
> (Vercel + Turso + Cloudflare R2 + Cashfree + Resend). **Variable names and
> operational semantics only — never secret values.** Duplicate operational
> material in `DEPLOYMENT.md`, `ROLLBACK.md`, `ENVIRONMENT.md`, `TROUBLESHOOTING.md`,
> and `INCIDENT_RESPONSE.md` is cross-referenced rather than copied; where this
> runbook adds detail it says so.

## 1. Environment variables (names only)

Source of truth: `.env.example`. Full semantics: `ENVIRONMENT.md`.

| Group | Variables | Production notes |
| ----- | --------- | ---------------- |
| App | `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` | `https://studio.supersmartx.com` in prod |
| Session | `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | ≥32 chars; auth refuses to start in prod without it |
| OAuth (optional) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH` | `.env.example` gate flag is not the code's runtime gate — code checks `GOOGLE_CLIENT_ID` presence (finding F-08) |
| Payments | `CASHFREE_APP_ID`, `CASHFREE_SECRET_KEY`, `CASHFREE_API_VERSION`, `CASHFREE_ENV`, `NEXT_PUBLIC_CASHFREE_ENV` | `CASHFREE_SECRET_KEY` doubles as the webhook HMAC key. `CASHFREE_ENV` is a literal `sandbox`/`production`, fails closed otherwise; `NEXT_PUBLIC_CASHFREE_ENV` must match **exactly** (build-time bake → switching envs requires redeploy) |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional; mail failures are best-effort and never block activation |
| Database | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | **Both required in production** — driver fails closed (`DatabaseNotConfiguredError`) without them; local dev falls back to `data/supersmartx.db` |
| Storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_SIGNED_URL_TTL_SECONDS` | All four required or upload/download routes answer `503`. Server-only — never a `NEXT_PUBLIC_R2_*`. Bucket CORS must allow the studio origin (root `DEPLOYMENT.md` §1 “Cloudflare R2 bucket CORS (required for Creator export)”) |
| Cron/cleanup | `CLEANUP_SECRET`, `CRON_SECRET` | Set `CRON_SECRET` = `CLEANUP_SECRET` or the 02:00 UTC sweep gets `401` |
| Admin/monitoring | `ADMIN_EMAIL`, `DISCORD_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` is used **only** by `/api/feedback` (finding F-07) |
| Observability | `OBSERVE_SALT` (fallback `AUTH_SALT` → `NEXTAUTH_SECRET` → built-in) | Hashes user ids in logs; set `OBSERVE_SALT` explicitly in prod so log correlation survives secret rotation |
| Host-provided | `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV` | Commit SHA surfaces in `GET /api/health` (short, non-sensitive) |

## 2. Database (Turso / libSQL)

- **Schema**: `src/lib/db/schema.ts`, ledger versions **1–14**, `SCHEMA_VERSION = 14`,
  12 tables. Migrations are **additive-only** and run via `ensureMigrated()` —
  invoked on first DB touch per process (including every `/api/health` probe).
- **Deploy**: no manual migration step — deploy the code and the ledger advances
  idempotently. Never edit `schema_meta` by hand.
- **Backups**: rely on Turso's point-in-time/branch features (configure in the
  Turso dashboard, not in code). Verify a restore drill before relying on it.
- **Rollback caveat**: additive migrations mean an older build still understands
  the newer schema (extra tables/columns are ignored) — see `ROLLBACK.md`.
- **Fail-closed**: production without Turso config does **not** silently use
  `:memory:`; requests error. (`ENVIRONMENT.md`/`TROUBLESHOOTING.md` were corrected
  in Phase 4 from an older `:memory:` fallback claim — finding F-05.)

## 3. Cloudflare R2

- **Buckets/prefixes**: final exports `exports/{userId}/{jobId}.mp4`; staging
  `staging/{userId}/{jobId}.mp4`; legacy cloud recordings `recordings/{userId}/…`.
- **Browser never holds R2 credentials** — uploads go through 900 s presigned PUT
  URLs (video/mp4 only, single key) or the server-mediated multipart route;
  downloads/preview are 3600 s signed GET URLs.
- **CORS**: bucket must allow `PUT`/`POST`/`GET` from the studio origin — required
  for the presigned flow (root `DEPLOYMENT.md` §1 “Cloudflare R2 bucket CORS
  (required for Creator export)”).
- **Lifecycle hygiene**: nightly cron `GET /api/export-jobs/cleanup` (`0 2 * * *`)
  deletes staging objects + `export_jobs` rows older than 30 days, excluding keys
  still referenced by `exports` rows. If the cron secret is misconfigured the
  sweep silently stops — check Vercel cron logs.
- **Diagnostics (safe)**: `head` a key to confirm size/content-type/eTag; never
  delete objects outside the cleanup contract without recording it.

## 4. Cashfree (payments)

- **Configuration**: `CASHFREE_ENV` + `NEXT_PUBLIC_CASHFREE_ENV` must match each
  other and the Cashfree dashboard mode. Mismatch → order creation fails closed
  (`503`), never silently routes to the wrong environment.
- **Webhook**: `POST /api/cashfree/webhook`, HMAC over `timestamp + raw body`
  with `CASHFREE_SECRET_KEY`, timing-safe compare. Ensure the Cashfree dashboard
  webhook URL points at production and retries are enabled — webhook is the
  activation path; `?payment=success` never activates anything.
- **Verify loop**: clients poll `/api/cashfree/verify` (30/min limit). Terminal
  failure returns `{ status: 'failed' }` and the client stops polling.
- **Reconciliation**: if a paid order shows no plan in DB, query `pending_orders`
  vs Cashfree dashboard by `order_id`; the fulfilment path is idempotent
  (`processed_webhooks` + atomic claim), so re-triggering verify is safe.
- **One-payable-order rule**: a stuck *payable* pending order blocks new order
  creation (`409`) until Cashfree reports it terminal — resolve in the Cashfree
  dashboard.

## 5. Resend (email)

- Reset-password and receipt emails are **best-effort** (`Promise.allSettled`) —
  a Resend outage never blocks activation or login.
- **Diagnostics**: check `RESEND_API_KEY` validity and the from-domain
  verification; check spam before escalating. `ADMIN_EMAIL` receives admin alerts.
- Never log message bodies containing tokens.

## 6. Vercel (host)

- **Build**: `next build` is the production artifact; CI (`ci.yml`) gates lint,
  `tsc`, Vitest, and the Playwright job. Vercel build failure = deploy refused.
- **Cron**: `vercel.json` → `/api/export-jobs/cleanup` daily 02:00 UTC.
- **Env vars**: set per environment (Production/Preview) in the Vercel dashboard;
  changing `NEXT_PUBLIC_*` requires a **redeploy** (build-time bake).
- **Logs**: Vercel function logs + structured app logs (`src/lib/observe/logger.ts`)
  with `x-request-id` correlation and salted/hashed user ids. Never log secrets,
  raw tokens, or signed URLs.

## 7. Deploy procedure

1. `CHANGE-CONTROL.md` chain satisfied: Contract → Authorization → Implementation
   → Verification → Certification (evidence recorded) → Commit → Push.
2. CI green on the commit (lint 0 errors, tsc PASS, Vitest PASS, e2e PASS).
3. Promote via Vercel; health check after deploy:
   `GET https://studio.supersmartx.com/api/health` → `200 { status: "healthy" }`
   (503 `degraded` means the DB check failed).
4. Smoke: load landing, log in, `GET /api/user/stats`, list library.
5. Note the short commit SHA from `/api/health` against the release record.

## 8. Rollback

- **App**: redeploy the previous known-good commit in Vercel (instant) — see
  `ROLLBACK.md`.
- **Schema**: no down-migrations exist; additive v10–v14 history means the prior
  build runs against the current schema safely. Never hand-revert `schema_meta`.
- **Env**: rolling back env vars requires redeploy for `NEXT_PUBLIC_*`.
- **Post-rollback**: re-run `/api/health` + smoke; record the rollback reason.

## 9. Logs, health checks, monitoring

| Signal | Where | Notes |
| ------ | ----- | ----- |
| Health | `GET /api/health` | Public: `healthy`/`degraded` + version + short commit. Authenticated adds `checks.database`, `checks.r2` detail |
| Structured logs | `logger.*` via `src/lib/observe/logger.ts` | Event name + `requestId` + hashed user id; `OBSERVE_SALT` rotates hashing |
| Client errors | `POST /api/observe/client-error` | Kinds whitelist: `recording_failed`, `video_playback_failed`, `export_encoder_failed`, `export_failed`. No rate limit (finding F-09) — treat raw volume spikes with care |
| Vercel | Functions/logs/cron pages | Cold-start and 5xx views |
| Discord | `DISCORD_WEBHOOK_URL` | **Feedback submissions only** — not an alert channel (finding F-07) |

## 10. Failure modes & safe diagnostics

| Symptom | Likely cause | Safe action |
| ------- | ------------ | ----------- |
| `/api/health` 503 `degraded` | Turso unreachable / config missing | Check `TURSO_*` vars and Turso status; driver fails closed by design |
| Payment orders 503 | `CASHFREE_ENV` unset/invalid or mismatch with mirror var | Fix env literals; redeploy (bake) |
| Webhook 400 `Invalid signature` | Wrong/stale `CASHFREE_SECRET_KEY` vs dashboard | Rotate to matching value in **both** (dashboard + Vercel); never print either value |
| Uploads 503 `Storage not configured` | Any of the four `R2_*` missing | Restore vars; verify CORS if browser PUT fails pre-flight |
| Downloads 404 for a known export | `local/` key (Free local export) or non-completed row | Expected for local exports; otherwise inspect `exports.status` |
| Exports stuck `uploading` | Client died before `/complete` | Safe: cleanup removes stale jobs after 30 days; user may re-export |
| `/complete` 400 artifact failure | Encoder produced invalid MP4 | Staging auto-deleted, job stays retryable; capture `requestId` + failure description; do **not** hand-edit job rows |
| `/complete` 500 (IO) | R2 transient | Staging retained — retry is safe (idempotent replay echo once completed) |
| Cron sweep 401 | `CRON_SECRET` ≠ `CLEANUP_SECRET` | Align the two values |
| 429s in prod | Per-process in-memory limiter resets per instance | Expected semantics; not a distributed guarantee (documented limitation) |
| Suspected account/session issue | JWT vs DB plan divergence | Plan is always re-read from DB; inspect `users.plan`/`planExpiresAt`, not the cookie |

**Diagnostics rules**

- Read-only first: `SELECT` on `users`/`exports`/`export_jobs`/`pending_orders`
  keyed by id; `head` on R2 keys; Vercel logs by `requestId`.
- Never: print secrets/signed URLs/tokens, hand-edit `schema_meta`, delete
  referenced R2 keys, re-run activation SQL by hand (verify is idempotent — use it).
- Anything security-sensitive you change (secret rotation, CORS, webhook URL)
  is a CHANGE-CONTROL decision, recorded in-repo with evidence.
