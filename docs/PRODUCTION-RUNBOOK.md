# Production Runbook — SupersmartX Studio

> Phase 4 deliverable. Operational reference for the production environment
> (Vercel + Supabase PostgreSQL + Cloudflare R2 + Cashfree + Resend). **Variable names and
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
| Database | `DATABASE_URL`, `DIRECT_URL` | **Both required.** `DATABASE_URL` = Supavisor transaction pooler (`:6543`) for runtime; `DIRECT_URL` = session/direct connection (`:5432`) for `prisma migrate`. Production fails closed (`DatabaseNotConfiguredError`) without a `postgres://` `DATABASE_URL`; there is no file or in-memory fallback |
| Storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_SIGNED_URL_TTL_SECONDS` | All four required or upload/download routes answer `503`. Server-only — never a `NEXT_PUBLIC_R2_*`. Bucket CORS must allow the studio origin (root `DEPLOYMENT.md` §1 “Cloudflare R2 bucket CORS (required for Creator export)”) |
| Cron/cleanup | `CLEANUP_SECRET`, `CRON_SECRET` | Set `CRON_SECRET` = `CLEANUP_SECRET` or the 02:00 UTC sweep gets `401` |
| Billing ops | `BILLING_OPS_SECRET` | Guards `/api/internal/billing/orders`. Set it to a value **different** from `CLEANUP_SECRET`; unset → route answers `503` (fail closed) |
| Admin/monitoring | `ADMIN_EMAIL`, `DISCORD_WEBHOOK_URL` | `DISCORD_WEBHOOK_URL` is used **only** by `/api/feedback` (finding F-07) |
| Observability | `OBSERVE_SALT` (fallback `AUTH_SALT` → `NEXTAUTH_SECRET` → built-in) | Hashes user ids in logs; set `OBSERVE_SALT` explicitly in prod so log correlation survives secret rotation |
| Host-provided | `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV` | Commit SHA surfaces in `GET /api/health` (short, non-sensitive) |

## 2. Database (Supabase PostgreSQL / Prisma)

- **Schema**: `prisma/schema.prisma` + `prisma/migrations` + `_prisma_migrations`
  are the single authority (13 tables). The runtime applies **no** DDL;
  `ensureMigrated()` only proves connectivity and seeds the legacy
  `schema_meta.schema_version` marker (`ON CONFLICT DO NOTHING`).
- **Connections**: `DATABASE_URL` = Supavisor transaction pooler (`:6543`) for
  runtime; `DIRECT_URL` = session/direct (`:5432`) for DDL, `pg_dump` and
  `prisma migrate`. Never swap them.
- **Deploy**: schema changes are applied with `npx prisma migrate deploy`
  (reads `DIRECT_URL`) **before** the new build serves traffic. There is no
  longer an automatic on-first-request migration. Run
  `npx prisma migrate status` first: it is read-only and shows what is pending.
- **Forbidden**: `prisma migrate dev` and `prisma db push`. The partial unique
  index `pending_orders_one_live_per_user` has no Prisma representation, so both
  report drift; `db push` drops the duplicate-checkout mutex. New migrations are
  hand-written additive SQL.
- **Backups**: taken by Supabase (*Dashboard → Database → Backups*), plus an
  optional PITR add-on; retention and PITR availability are project plan
  settings this repo cannot read — confirm them in the dashboard. Portable
  logical dumps via `pg_dump "$DIRECT_URL"`; restore into a **new** project and
  verify before any cutover. Full procedure: `DATABASE.md` § *Backup and
  restore*. A restore is unverified until drilled.
- **Rollback caveat**: migrations are additive-only, so an older build still
  understands the newer schema (extra tables/columns are ignored) and an app
  rollback needs no schema rollback — see `ROLLBACK.md`.
- **Fail-closed**: production without a `postgres://` `DATABASE_URL` does not
  silently fall back to a file or `:memory:`; requests error.

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
  vs Cashfree dashboard by `order_id`; the fulfilment path is idempotent — claim,
  grant and the order's `fulfilled_at` marker commit in one transaction — so
  re-triggering verify is safe.
- **Pending-order lifecycle (W2)**: every checkout reserves the order in
  `pending_orders` (`creating`) before calling Cashfree, then flips it to
  `open`. `creating → open → termination_requested` are the live states and
  exactly one may exist per user (partial unique index
  `pending_orders_one_live_per_user`). `held_review` = money received, not
  applied; `unverified` = historical row the migration deliberately did not
  classify (no historical row is fulfilled, granted or closed by it);
  `fulfilled` / `closed` are settled. Reconciliation runs on every checkout
  attempt under the per-user `checkout_locks` row; it never releases an order
  for being old — only the gateway's answer moves it, and an unreadable answer
  refuses the checkout (`503`).
- **Operator surface**: `GET|POST /api/internal/billing/orders` (secret:
  `BILLING_OPS_SECRET`, never `CLEANUP_SECRET`). Read the report first
  (`GET ...?status=held_review,unverified&probe=1`), then
  `POST {action:'reconcile',orderId,dryRun:false}` to drive one order through the
  state machine, or `POST {action:'release',orderId,resolution,confirm:'RELEASE'}`
  to exit a hold. The route re-reads Cashfree before any write, so it cannot
  close a paid order by accident. A refund is *recorded*, never issued.
- **One-payable-order rule**: a live checkout answers new order creation with
  `409 pending_order_open` (resumable) or `pending_order_terminating` /
  `pending_order_creating` while it is being resolved. Do **not** delete
  `pending_orders` rows or "clear" a block by hand — that is how a buyer gets
  charged twice. If an order is stuck, use the operator surface.
- **Alerts**: `payment.order_held_review`, `payment.order_termination_stuck`
  (≥15 min in `TERMINATION_REQUESTED`), `payment.order_termination_refused` and
  `payment.order_orphaned_closed` are logged every time; the first, stuck and
  refused cases also email `ADMIN_EMAIL` once per order (deduped through
  `order_notifications`).

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
3. Apply pending schema changes **before** promoting:
   `npx prisma migrate status` (read-only) then `npx prisma migrate deploy`,
   both resolving `DIRECT_URL`. Never `db push` / `migrate dev`.
4. Promote via Vercel; health check after deploy:
   `GET https://studio.supersmartx.com/api/health` → `200 { status: "healthy" }`
   (503 `degraded` means the DB check failed).
5. Smoke: load landing, log in, `GET /api/user/stats`, list library.
6. Note the short commit SHA from `/api/health` against the release record.

## 8. Rollback

- **App**: redeploy the previous known-good commit in Vercel (instant) — see
  `ROLLBACK.md`.
- **Schema**: no down-migrations exist; additive-only Prisma migrations mean the
  prior build runs against the current schema safely. Never hand-revert
  `_prisma_migrations` or `schema_meta`; correct the schema forward or restore a
  backup (`DATABASE.md`).
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
| `/api/health` 503 `degraded` | database unreachable / `DATABASE_URL` missing or non-Postgres | Check Supabase status and the `DATABASE_URL` value (pooler, `:6543`); the app fails closed by design. Confirm the binding via authenticated `checks.db_host` |
| Payment orders 503 | `CASHFREE_ENV` unset/invalid or mismatch with mirror var | Fix env literals; redeploy (bake) |
| Webhook 400 `Invalid signature` | Wrong/stale `CASHFREE_SECRET_KEY` vs dashboard | Rotate to matching value in **both** (dashboard + Vercel); never print either value |
| Uploads 503 `Storage not configured` | Any of the four `R2_*` missing | Restore vars; verify CORS if browser PUT fails pre-flight |
| Downloads 404 for a known export | `local/` key (Free local export) or non-completed row | Expected for local exports; otherwise inspect `exports.status` |
| Exports stuck `uploading` | Client died before `/complete` | Safe: cleanup removes stale jobs after 30 days; user may re-export |
| `/complete` 400 artifact failure | Encoder produced invalid MP4 | Staging auto-deleted, job stays retryable; capture `requestId` + failure description; do **not** hand-edit job rows |
| `/complete` 500 (IO) | R2 transient | Staging retained — retry is safe (idempotent replay echo once completed) |
| Cron sweep 401 | `CRON_SECRET` ≠ `CLEANUP_SECRET` | Align the two values |
| Checkout `409 paid_order_pending_review` | Payment settled at Cashfree but fulfilment was rejected/threw | Do **not** ask the buyer to pay again. Read the report, then `POST /api/internal/billing/orders {action:'release',orderId,resolution:'fulfilled_manually',confirm:'RELEASE'}` once Cashfree confirms `PAID`. If the release answers `409 claim_unentitled`, the order holds a fulfilment claim with no per-order `fulfilled_at` marker (a crash between the claim and the plan write, or a pre-upgrade row) — investigate before granting, because a blind re-grant pays the term twice |
| Checkout `409 pending_order_terminating` for >15 min | Cashfree accepted the kill but never confirmed | Expect `payment.order_termination_stuck`. Verify the configured `CASHFREE_API_VERSION` supports `PATCH {order_status:'TERMINATED'}`; do not delete the row. Checkout stays blocked by design |
| Checkout `409 pending_order_creating` repeatedly | Create outcome unknown (timeout/5xx) and the orphan probe has not proven absence | Three spaced `404`s over ≥30 s after the 2-minute grace close it automatically. `POST action:'reconcile',dryRun:false` forces a pass; only a gateway-confirmed 404 may close |
| Checkout `503 pending_order_unconfirmed` | Gateway unreadable during reconciliation | Check Cashfree status/credentials; retry later. Fail closed is deliberate |
| Billing ops route `503` | `BILLING_OPS_SECRET` unset | Set it (never `CLEANUP_SECRET`) and redeploy |
| 429s in prod | Per-process in-memory limiter resets per instance | Expected semantics; not a distributed guarantee (documented limitation) |
| Suspected account/session issue | JWT vs DB plan divergence | Plan is always re-read from DB; inspect `users.plan`/`planExpiresAt`, not the cookie |

**Diagnostics rules**

- Read-only first: `SELECT` on `users`/`exports`/`export_jobs`/`pending_orders`
  keyed by id; `head` on R2 keys; Vercel logs by `requestId`.
- Never: print secrets/signed URLs/tokens, hand-edit `schema_meta`, delete
  referenced R2 keys, re-run activation SQL by hand (verify is idempotent — use it).
- Anything security-sensitive you change (secret rotation, CORS, webhook URL)
  is a CHANGE-CONTROL decision, recorded in-repo with evidence.
