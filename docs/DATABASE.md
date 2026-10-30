# Database

Provider: **Supabase** (managed PostgreSQL; the production project runs in
`ap-northeast-2`). ORM and schema authority: **Prisma 6** — `prisma/schema.prisma`
plus `prisma/migrations`.

There is no local SQLite file, no libSQL driver, and no in-memory branch in the
application. Production **fails closed**: `src/lib/db/prisma.ts` throws
`DatabaseNotConfiguredError` when `DATABASE_URL` is missing or is not a
`postgres://`/`postgresql://` DSN, and no fallback database is ever invented.

> The libSQL/Turso driver, `src/lib/db/schema.ts` and its v1–v14 statement
> ledger were retired in `e4e69bf` ("remove Turso/libSQL; Supabase PostgreSQL +
> Prisma is sole database"). `prisma/migrations/0_init` is the baseline that
> replaced them; the old ledger survives only in git history. Historical
> migration records inside `prisma/migrations` are never rewritten.

## Connection strings

| Variable | Used by | Endpoint | Notes |
| -------- | ------- | -------- | ----- |
| `DATABASE_URL` | the application at runtime | Supavisor **transaction** pooler, port `6543` | One Prisma client per process (`getPrisma()`), cached on `globalThis` outside production so dev hot-reload cannot leak a pool |
| `DIRECT_URL` | `prisma migrate`, DDL, `pg_dump` | **session / direct** connection, port `5432` | Declared as `directUrl` in `prisma/schema.prisma` |

Both are `postgresql://…?sslmode=require` (see `.env.example`). Two rules:

- **Never** point runtime traffic at `5432`. Serverless functions would hold
  direct connections and exhaust the project's direct-connection quota.
- **Never** point schema commands at `6543`. Transaction pooling does not
  guarantee the session state DDL needs, which is exactly why
  `prisma/schema.prisma` carries a second URL.

Never print, paste or commit either value. `GET /api/health` exposes only
`db_provider` (`postgres`), `db_durable` and `db_host` (host, no user or
password) — and only to a signed-in operator.

**Local dev and tests** use a disposable PostgreSQL database, not a file. The
DB-backed suites `TRUNCATE` every application table, so they refuse any URL that
looks deployed (`prod`, the product name, or a Supabase host) unless
`ALLOW_TEST_DB=1` is set deliberately — see
`src/__tests__/helpers/test-database.ts`. If a local `.env.local` carries a
deployed project URL, override `DATABASE_URL`/`DIRECT_URL` explicitly for any
test or migration command, and do not set `ALLOW_TEST_DB`.

## Runtime behaviour

- Singleton client only: `src/lib/db/prisma.ts` (`getPrisma`, `resetPrisma` for
  tests). Nothing there touches the network at import time, so `next build` on
  a host without `DATABASE_URL` still succeeds; the error surfaces at the first
  query.
- `ensureMigrated()` (`src/lib/db/index.ts`) applies **no DDL**. On the first
  database call per process it runs `SELECT 1` to prove connectivity, then
  inserts the legacy marker `schema_meta.schema_version = 14` with
  `ON CONFLICT … DO NOTHING`. `SCHEMA_VERSION` is therefore a *reported* value
  for `/api/health`, not a migration ledger, and an existing (possibly newer)
  marker is never overwritten. That insert is the only write the health probe
  performs.
- Foreign keys are enforced by PostgreSQL itself. There is no per-connection
  pragma to set — the constraints are declared in the migrations
  (children of `users` `ON DELETE CASCADE`; `exports.job_id`
  `ON DELETE SET NULL`).

## Migrations (Prisma Migrate)

`prisma/migrations` plus the `_prisma_migrations` table is the single schema
authority. The runtime never migrates; deploys do.

| Migration | Purpose |
| --------- | ------- |
| `0_init` | Baseline: all 12 original tables, indexes and FKs (tracked since `e4e69bf`) |
| `20261030150000_pending_order_lifecycle` | W2 pending-order lifecycle, per-user checkout lock, partial unique index |

**Commands** (all of these read `DIRECT_URL` for DDL):

```bash
npx prisma migrate status     # read-only; which migrations the target database has applied
npx prisma migrate deploy     # apply pending migrations (CI, production, rehearsal)
```

**Forbidden against this database:**

- `npx prisma migrate dev` — generates SQL from `schema.prisma`, and the
  partial unique index `pending_orders_one_live_per_user` has no Prisma
  representation, so every run reports permanent drift and may offer to "fix" it.
- `npx prisma db push` — does not use the migration history and **drops** that
  index.

New migrations are hand-written: create
`prisma/migrations/<yyyymmddhhmmss>_<name>/migration.sql` with additive SQL, and
keep `prisma/schema.prisma` in step with it. Additive-only means an older build
still understands a newer schema (extra tables and columns are ignored), so an
app rollback never requires a schema rollback.

If `migrate deploy` fails on a database whose schema already exists (for example
one created with `db push`), the cause is an empty `_prisma_migrations`, not a
broken migration: `0_init` tries to create tables that are already there. Do not
edit migrations to force it through. Verify the real schema matches `0_init`,
then record the baseline once:

```bash
npx prisma migrate resolve --applied 0_init
npx prisma migrate status      # must show 0_init applied, lifecycle migration pending
```

## Tables (13)

| Table | Purpose | Delete behaviour |
| ----- | ------- | ---------------- |
| `users` | accounts, plan, `plan_expires_at`, `session_version`, lockout | — |
| `reset_tokens` | password-reset token hashes | email-scoped, expiry-checked |
| `user_stats` | download/upload counts, storage bytes | CASCADE on user delete |
| `exports` | export records → R2 keys | CASCADE on user delete; `job_id` SET NULL on job delete |
| `export_jobs` | encode/upload job state machine | CASCADE on user delete |
| `processed_webhooks` | Cashfree idempotency ledger | append-only |
| `pending_orders` | server-side order truth for webhook verification | CASCADE on user delete |
| `checkout_locks` | one TTL row per user serialising checkout + reconciliation | released by the holder; `locked_at` is the TTL |
| `monthly_export_counts` | `(user_id, period)` atomic quota | CASCADE on user delete |
| `daily_recording_seconds` | `(user_id, day)` recording-second ledger (BUS-001) | CASCADE on user delete |
| `order_notifications` | receipt-once ledger for order emails | append-only |
| `deleted_identities` | tombstones: deleted email → next session version | append-only |
| `schema_meta` | legacy migration-version marker read by `/api/health` | — |

## Pending-order lifecycle schema (W2)

Migration `prisma/migrations/20261030150000_pending_order_lifecycle` is additive
and transactional. It adds the lifecycle columns to `pending_orders`
(`status`, `closed_at`, `close_reason`, `held_at`, `hold_reason`,
`fulfilled_at`, `last_checked_at`, `probe_count`, `first_probed_at`,
`termination_requested_at`), creates `checkout_locks`, and adds:

- `pending_orders_one_live_per_user` — **partial** unique index on `user_id`
  `WHERE status IN ('creating','open','termination_requested')`. This is the
  duplicate-checkout mutex; `held_review` is deliberately outside it so a late
  PAID order can be recorded while another checkout is live, and `unverified`
  is outside it because historical duplicates are expected to exist.
- `pending_orders_status_created_at_idx` — supports the ops report.
- Ten CHECK constraints tying closure, hold and termination fields to the
  status they belong to (a `fulfilled` row must carry `fulfilled_at` and a
  `close_reason`; a live row must carry neither).

Backfill is deliberately conservative: **every** historical row becomes
`unverified`, and no plan is granted, extended or revoked by the migration.
A `processed_webhooks` claim is preserved (it is order history, and the
operator report shows it), but it is **not** treated as fulfilment evidence:
the old `plan_expires_at > processed_at` test also "proved" a crashed renewal,
because the previous term had already pushed the expiry past the new claim.
Only the per-order `fulfilled_at` marker — written solely by the settlement
transaction, and impossible before this migration — is exact evidence.
Reconciliation classifies each `unverified` row against the gateway and the
operator resolves anything a gateway read cannot settle.

Operational implication: historical orders see no automatic re-grant. A row
with a claim and no marker is reported `investigate_claim_unentitled`; if the
gateway confirms it was paid, an operator decides by hand (grant once, or
refund), because the database cannot prove which of those already happened.

## Concurrency

Quota/counter mutations are single-statement atomic UPDATEs
(`atomicIncrementUploadCount`, `atomicTryConsumeMonthlyExport`,
`atomicIncrementDownloadCount`) — safe under concurrent requests without
application locks. `/api/exports/complete` is idempotent on
(job completed + same key).

Checkout serialises per user through `checkout_locks` (`acquireCheckoutLock` /
`releaseCheckoutLock`): one row keyed by `user_id`, holding a `token` and
`locked_at`, because requests are served by independent serverless isolates that
share no process state. `locked_at` is a TTL so a holder that died mid-request
cannot wedge checkout, and the partial unique index is the backstop if two
reservations ever race.

## Operations

- **Diagnostics** (read-only, run against `DIRECT_URL`):

  ```sql
  SELECT version();
  SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at;
  SELECT status, count(*) FROM pending_orders GROUP BY 1;
  ```

- **Never**: edit `_prisma_migrations` or `schema_meta` by hand, run `db push`
  or `migrate dev`, or delete `pending_orders` rows to "clear" a blocked
  checkout.

### Backup and restore (Supabase)

The database is the system of record for users, plans, orders, quotas and
export metadata (MP4 bytes live in R2 — see `STORAGE.md`). Backups are
provider-managed; nothing in this repo takes them.

**What Supabase offers**

- **Daily backups**, taken by the platform, visible under
  *Dashboard → Database → Backups*. Retention depends on the project's plan.
- **Point-in-time recovery (PITR)**, a separate paid add-on with
  minute-level granularity. If it is not enabled, the finest restore point is
  the latest daily backup.

Both plan and retention are project settings this repository cannot read —
confirm them in the dashboard before relying on either.

**Portable logical backup** (works on any plan, and the only option that can be
restored into a different project):

```bash
pg_dump "$DIRECT_URL" --schema=public --format=custom \
  --no-owner --no-privileges --file="backup-$(date +%F).dump"
```

Run it against `DIRECT_URL` (session mode), never the pooler. Keep the dump
outside the repository — it contains user records — and do not exclude
`_prisma_migrations`: that table is what tells the restored copy which
migrations are already applied.

**Restore procedure**

1. Restore into a **new** Supabase project (or a clone), never over live:
   ```bash
   pg_restore --no-owner --no-privileges --dbname "$SCRATCH_DIRECT_URL" backup-YYYY-MM-DD.dump
   ```
2. Verify the copy before any cutover: `npx prisma migrate status` (must report
   no pending migrations), then row counts on `users`, `exports`,
   `pending_orders` against the source.
3. Cut over by repointing `DATABASE_URL` and `DIRECT_URL` at the restored
   project and redeploying. Nothing else references the host.
4. Record the backup timestamp used, the verification output, and who approved
   the cutover.

A provider-managed restore (daily snapshot or PITR) replaces the project's
database in place, so treat it as a production change: confirm the restore
point first, and prefer the scratch-project path above when there is any doubt.

**Rolling back a bad migration**: there are no down migrations. Either restore a
pre-deploy backup (procedure above) or ship a new additive migration that
corrects the schema. Never hand-revert `_prisma_migrations`.

**A restore is unverified until it has been drilled** — quarterly is the
suggested cadence: restore the newest backup into a scratch project, run
`npx prisma migrate status`, run the smoke list from `DEPLOYMENT.md`, and record
the date and result.

`prisma migrate status` is acceptable on a scratch copy but **must not be run
against production**: in Prisma 6 it can create a shadow database to diagnose
drift, and the partial unique index Prisma cannot represent always reads as
drift. Use a `SELECT` on `_prisma_migrations` plus
`prisma migrate diff --from-url … --to-schema-datamodel … --script` instead.

The end-to-end rehearsal (dump → verify artifact → restore → rehearse
`prisma migrate deploy` → validate constraints and backfill → cleanup), with
every target pinned to a scratch database, is
[MIGRATION-REHEARSAL.md](MIGRATION-REHEARSAL.md).
