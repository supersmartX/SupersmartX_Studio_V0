# Production Runbook — SupersmartX Studio

> Phase 4 deliverable. Operational reference for the production environment
> (Vercel + Supabase PostgreSQL + Cloudflare R2 + Paddle + Resend). **Variable names and
> operational semantics only — never secret values.** Duplicate operational
> material in `../operations/DEPLOYMENT.md`, `../operations/ROLLBACK.md`, `../operations/ENVIRONMENT.md`, `../operations/TROUBLESHOOTING.md`,
> and `INCIDENT_RESPONSE.md` is cross-referenced rather than copied; where this
> runbook adds detail it says so.

## 1. Environment variables (names only)

Source of truth: `.env.example`. Full semantics: `../operations/ENVIRONMENT.md`.

| Group | Variables | Production notes |
| ----- | --------- | ---------------- |
| App | `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL` | `https://studio.supersmartx.com` in prod |
| Session | `NEXTAUTH_SECRET` (or `AUTH_SECRET`) | ≥32 chars; auth refuses to start in prod without it |
| OAuth (optional) | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_AUTH` | `.env.example` gate flag is not the code's runtime gate — code checks `GOOGLE_CLIENT_ID` presence (finding F-08) |
| Payments | `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, `PADDLE_ENVIRONMENT`, `PADDLE_LIVE_CHECKOUT_DISABLED`, `PADDLE_CHECKOUT_URL` (optional `PADDLE_CHECKOUT_URLS`), `PADDLE_CLIENT_TOKEN`, `PADDLE_SANDBOX_*` / reserved `PADDLE_LIVE_*` | Paddle **Billing** SDK. `PADDLE_ENVIRONMENT` must be explicitly `sandbox` or `live`; missing/invalid mode disables the client and payment routes answer `503`. Checkout and cancellation are implemented for `sandbox` only, so production checkout stays disabled until a reviewed live change ships. `PADDLE_CLIENT_TOKEN` is the public `test_…` Paddle.js token rendered into `/pay` — never the API key |
| Email | `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional; mail failures are best-effort and never block activation |
| Database | `DATABASE_URL`, `DIRECT_URL` | **Both required.** `DATABASE_URL` = Supavisor transaction pooler (`:6543`) for runtime; `DIRECT_URL` = session/direct connection (`:5432`) for `prisma migrate`. Production fails closed (`DatabaseNotConfiguredError`) without a `postgres://` `DATABASE_URL`; there is no file or in-memory fallback |
| Storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_SIGNED_URL_TTL_SECONDS` | All four required or upload/download routes answer `503`. Server-only — never a `NEXT_PUBLIC_R2_*`. Bucket CORS must allow the studio origin (root `../operations/DEPLOYMENT.md` §1 “Cloudflare R2 bucket CORS (required for Creator export)”) |
| Cron/cleanup | `CLEANUP_SECRET`, `CRON_SECRET` | Vercel sends `Authorization: Bearer $CRON_SECRET` to both cron paths: the Paddle worker compares it directly, the 02:00 UTC export sweep compares it against `CLEANUP_SECRET`. Set `CLEANUP_SECRET` to the same value as `CRON_SECRET` |
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
  indexes `billing_reservations_one_active_per_user` and
  `billing_operations_one_open_cancel_per_subscription` (and the legacy
  `pending_orders_one_live_per_user`) have no Prisma representation, so both
  commands report drift; `db push` would drop the duplicate-checkout mutex. New
  migrations are hand-written additive SQL.
- **Backups**: taken by Supabase (*Dashboard → Database → Backups*), plus an
  optional PITR add-on; retention and PITR availability are project plan
  settings this repo cannot read — confirm them in the dashboard. Portable
  logical dumps via `pg_dump "$DIRECT_URL"`; restore into a **new** project and
  verify before any cutover. Full procedure: `../engineering/DATABASE.md` § *Backup and
  restore*. A restore is unverified until drilled.
- **Rollback caveat**: migrations are additive-only, so an older build still
  understands the newer schema (extra tables/columns are ignored) and an app
  rollback needs no schema rollback — see `../operations/ROLLBACK.md`.
- **Fail-closed**: production without a `postgres://` `DATABASE_URL` does not
  silently fall back to a file or `:memory:`; requests error.

## 3. Cloudflare R2

- **Buckets/prefixes**: final exports `exports/{userId}/{jobId}.mp4`; staging
  `staging/{userId}/{jobId}.mp4`; legacy cloud recordings `recordings/{userId}/…`.
- **Browser never holds R2 credentials** — uploads go through 900 s presigned PUT
  URLs (video/mp4 only, single key) or the server-mediated multipart route;
  downloads/preview are 3600 s signed GET URLs.
- **CORS**: bucket must allow `PUT`/`POST`/`GET` from the studio origin — required
  for the presigned flow (root `../operations/DEPLOYMENT.md` §1 “Cloudflare R2 bucket CORS
  (required for Creator export)”).
- **Lifecycle hygiene**: nightly cron `GET /api/export-jobs/cleanup` (`0 2 * * *`)
  deletes staging objects + `export_jobs` rows older than 30 days, excluding keys
  still referenced by `exports` rows. If the cron secret is misconfigured the
  sweep silently stops — check Vercel cron logs.
- **Diagnostics (safe)**: `head` a key to confirm size/content-type/eTag; never
  delete objects outside the cleanup contract without recording it.

## 4. Paddle (payments)

> Paddle **Billing** through `@paddle/paddle-node-sdk`. The previous gateway flow
> (`pending_orders`, `/api/paddle/verify`, `PADDLE_ENVIRONMENT`, order termination) is
> retired; those tables and helpers remain only for historical rows.

- **Configuration**: `PADDLE_API_KEY`, `PADDLE_WEBHOOK_SECRET`, and an explicit
  `PADDLE_ENVIRONMENT` (`sandbox` or `live`). The mode is never inferred from
  `NODE_ENV`. Missing/invalid mode or API key makes `getPaddleClient()` return
  null, and every payment route answers `503`. Checkout and cancellation
  mutations are implemented for `sandbox` only (`isPaddleCheckoutEnabled()`), so
  production cannot create or cancel a subscription yet.
- **Catalog mapping**: `PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY|YEARLY`,
  `PADDLE_SANDBOX_AMOUNT_MONTHLY|YEARLY`, `PADDLE_SANDBOX_CURRENCY`. Each price
  must be an active recurring price with no trial, exactly the reviewed regional
  override set (INR override for India), and totals matching the quote.
  `PADDLE_LIVE_*` variables are reserved and unused while live mutations remain
  disabled.
- **Checkout flow**: `POST /api/paddle/quote` returns a signed quote
  (15-minute TTL, USD base, INR for `IN`). The client hashes the displayed
  consent and calls `POST /api/paddle/checkout`, which verifies the quote,
  price metadata, and trusted country, reserves `billing_reservations` (partial
  unique index: one active reservation per user), creates the Paddle
  transaction, and returns the transaction ID plus the approved merchant payment
  page URL (`PADDLE_CHECKOUT_URL` / `PADDLE_CHECKOUT_URLS`, `_ptxn` allowed).
  `/pay` loads Paddle.js in sandbox mode and opens that transaction. An
  uncertain create answers `503` **with the reservation ID** and blocks a second
  enrollment; the client polls
  `GET /api/paddle/checkout/status?reservationId=…` for recovery.
- **Webhook**: public `POST /api/paddle/webhook`, verified with the official SDK
  (`paddle-signature` header, `PADDLE_WEBHOOK_SECRET`), 1 MiB body limit.
  Verified events are inserted into `billing_events` and acknowledged before any
  projection work. Entitlement is never changed in the request handler; the
  Paddle dashboard webhook target must be the production URL with retries
  enabled.
- **Worker**: `GET /api/internal/paddle/worker`, bearer `CRON_SECRET` compared
  in constant time. It runs after every first-time webhook receipt (the response
  is sent first, then the trigger runs with one connection-failure retry) and
  Vercel Cron re-runs it daily at 03:00 UTC as a recovery sweep. Hobby does not
  support sub-daily cron. Each
  invocation drains up to 64 leases or 45 s, re-reads the authoritative Paddle
  transaction/subscription/adjustment, and only then writes. Projections for one
  user are serialized by `SELECT … FOR UPDATE`; lease tokens fence stale
  workers; ten failed attempts move the event to `review`.
- **Entitlement rules**: paid terms come from authoritative Paddle period
  fields. `paid`/`completed` grant; `billed`, `ready`, `past_due`, `canceled`
  and failed payments never grant, and subscription activation alone never
  grants. Duplicate grants for one provider transaction are prevented by a
  unique ID plus an atomic `entitlementGrantedAt` claim. Approved full
  refunds/chargebacks recompute coverage from remaining paid periods (legacy
  paid-through is preserved); partial refunds are recorded without revoking the
  term. A delayed adjustment cannot overwrite a newer account lifecycle event.
- **Stuck or failed events**: there is no operator release endpoint for Paddle
  Billing. Inspect `billing_events` (`status='review'`, `last_error`,
  `attempt_count`) and `billing_operations` (`pending`/`uncertain`), confirm the
  provider state in Paddle, then let the worker retry after fixing the cause.
  Never hand-edit `billing_transactions`, `billing_accounts`, or `users.plan` to
  bypass the worker — that is how a term is granted twice.
- **One-live-reservation rule**: a second checkout while one is unresolved
  answers `409` with the existing reservation ID; do not delete reservation rows
  to "clear" the block. Release happens only through an authoritative terminal
  provider state processed by the status route or worker.

## 5. Resend (email)

- Reset-password and receipt emails are **best-effort** (`Promise.allSettled`) —
  a Resend outage never blocks activation or login.
- **Diagnostics**: check `RESEND_API_KEY` validity and the from-domain
  verification; check spam before escalating. `ADMIN_EMAIL` receives admin alerts.
- Never log message bodies containing tokens.

## 6. Vercel (host)

- **Build**: `next build` is the production artifact; CI (`ci.yml`) gates lint,
  `tsc`, Vitest, and the Playwright job. Vercel build failure = deploy refused.
- **Cron**: `vercel.json` → `/api/internal/paddle/worker` daily at 03:00 UTC
  (`CRON_SECRET`; normal processing is webhook-triggered) and
  `/api/export-jobs/cleanup` daily 02:00 UTC
  (`CLEANUP_SECRET`). A missing/incorrect secret shows up as `401` in the cron
  log; the sweep then silently stops.
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
  `../operations/ROLLBACK.md`.
- **Schema**: no down-migrations exist; additive-only Prisma migrations mean the
  prior build runs against the current schema safely. Never hand-revert
  `_prisma_migrations` or `schema_meta`; correct the schema forward or restore a
  backup (`../engineering/DATABASE.md`).
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
| Payment routes 503 | `PADDLE_ENVIRONMENT` or `PADDLE_API_KEY` missing/invalid, environment is `live`, sandbox price mapping missing, or `PADDLE_CHECKOUT_URL` unset/unsafe | Fix the named variable and redeploy. Checkout/cancellation are sandbox-only by design until live support ships |
| Webhook 400 `Invalid signature` | Wrong/stale `PADDLE_WEBHOOK_SECRET` vs dashboard, or environment mismatch | Rotate to the matching value in **both** (dashboard + Vercel); never print either value |
| Uploads 503 `Storage not configured` | Any of the four `R2_*` missing | Restore vars; verify CORS if browser PUT fails pre-flight |
| Downloads 404 for a known export | `local/` key (Free local export) or non-completed row | Expected for local exports; otherwise inspect `exports.status` |
| Exports stuck `uploading` | Client died before `/complete` | Safe: cleanup removes stale jobs after 30 days; user may re-export |
| `/complete` 400 artifact failure | Encoder produced invalid MP4 | Staging auto-deleted, job stays retryable; capture `requestId` + failure description; do **not** hand-edit job rows |
| `/complete` 500 (IO) | R2 transient | Staging retained — retry is safe (idempotent replay echo once completed) |
| Cron sweep 401 | The cron's bearer value does not match `CLEANUP_SECRET` (cleanup) or `CRON_SECRET` (Paddle worker) | Vercel sends one bearer value to both paths, so `CLEANUP_SECRET` must equal `CRON_SECRET`; rotate them together |
| Checkout `409 An unresolved checkout already exists` | A `billing_reservations` row is `reserved` or `pending` for this user | Response carries `reservationId`; poll `GET /api/paddle/checkout/status?reservationId=…`. Do **not** delete the row — only an authoritative terminal Paddle state releases it |
| Checkout `503 … outcome is uncertain` | Paddle create timed out or errored after the reservation committed | Use the returned `reservationId` with the status route; the client must not create a second transaction |
| Checkout `503 Paddle payment page is not configured` | `PADDLE_CHECKOUT_URL` unset, non-HTTPS, or not on the approved list | Set an approved payment page and redeploy |
| Paid in Paddle but plan not active | Webhook not delivered, or worker event failed | Check the dashboard webhook target/deliveries, then `billing_events` (`status`, `last_error`, `attempt_count`). The worker is triggered by webhook receipt and re-swept daily; a redelivered webhook also retriggers it. Never grant access by hand |
| `billing_events` stuck in `review` | Ten failed attempts or invalid attribution/provider data | Inspect `last_error`, reconcile the provider state in Paddle, fix the cause, then let the worker replay |
| Subscription canceled but still paid-through | Expected | Cancellation at period end preserves paid-through coverage by design (`billing_accounts.paid_through_at`) |
| 429s in prod | Per-process in-memory limiter resets per instance | Expected semantics; not a distributed guarantee (documented limitation) |
| Suspected account/session issue | JWT vs DB plan divergence | Plan is always re-read from DB; inspect `users.plan`/`planExpiresAt`, not the cookie |

**Diagnostics rules**

- Read-only first: `SELECT` on `users`/`exports`/`export_jobs`/
  `billing_reservations`/`billing_events` keyed by id; `head` on R2 keys; Vercel
  logs by `requestId`.
- Never: print secrets/signed URLs/tokens, hand-edit `schema_meta`, delete
  referenced R2 keys, or write `users.plan`/`billing_transactions` by hand —
  entitlement is applied only by the signed-webhook worker.
- Anything security-sensitive you change (secret rotation, CORS, webhook URL)
  is a CHANGE-CONTROL decision, recorded in-repo with evidence.

## Paddle environment enforcement

The current release is **sandbox-only**. `isPaddleCheckoutEnabled()` returns true
only for `PADDLE_ENVIRONMENT=sandbox`, so `/api/paddle/quote`, `/checkout`, and
`/cancel` answer `503` in `live` no matter what credentials are present. Live
checkout requires a reviewed code change and the evidence listed in
`../billing/PADDLE_MIGRATION_IMPLEMENTATION_REPORT.md`; do not enable it by editing env vars
alone.

- `PADDLE_ENVIRONMENT` is explicit — never inferred from `NODE_ENV`. Missing or
  invalid values disable the SDK client and every payment route fails closed.
- `next.config.ts` warns (does not fail the build) when `PADDLE_API_KEY` or
  `PADDLE_WEBHOOK_SECRET` is absent, because Storybook evaluates the config
  outside the Next env pipeline. Runtime gating lives in `src/lib/billing/paddle.ts`.
- CSP denies frames and third-party scripts globally. Only `/pay` adds
  `https://cdn.paddle.com` (script), `https://*.paddle.com` (connect/frame) so
  Paddle.js can open the sandbox checkout.
- `/pay` refuses to render unless the environment is `sandbox`, the transaction
  ID matches `txn_…`, and `PADDLE_CLIENT_TOKEN` is a `test_…` token.
- `PADDLE_LIVE_CHECKOUT_DISABLED` is reserved for the future live change; current
  code does not consult it, and it must stay `true` until that change ships.

For isolated local development use sandbox credentials and a disposable
database. Never copy production credentials or the production database into
local payment tests. No live payment is required for automated tests: use
mocked network and dummy credentials.

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
