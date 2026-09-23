# Database

Engine: libSQL (SQLite-compatible). Local: `data/supersmartx.db`.
Production: Turso (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`).
**Without Turso on serverless, the driver falls back to `:memory:` —
all data is lost on cold start.** Turso is mandatory in production.

## Connection & enforcement

- Singleton client: `src/lib/db/driver.ts` (`getDb`, `resetDb` for tests).
- `ensureMigrated()` (`src/lib/db/index.ts`) runs pending migrations once,
  then executes `PRAGMA foreign_keys = ON` on every call — SQLite leaves FK
  enforcement OFF per connection by default, and the schema relies on
  `ON DELETE CASCADE` / `ON DELETE SET NULL`. Never remove this pragma.
- Exception: `POST /api/cashfree/order` briefly disables FK enforcement as a
  last-resort insert path for `pending_orders` and re-enables it in a
  `finally` block. Do not copy this pattern elsewhere.

## Migrations (`src/lib/db/schema.ts`)

Ordered statement list with `schema_meta.schema_version` tracking, currently
**version 10**. `migrate()` is idempotent (`IF NOT EXISTS`, duplicate-column
tolerance). Tables:

| Table | Purpose | Delete behavior |
| ----- | ------- | --------------- |
| `users` | accounts, plan, `plan_expires_at`, `session_version`, lockout | — |
| `reset_tokens` | password-reset token hashes | email-scoped, expiry-checked |
| `user_stats` | download/upload counts, storage bytes | CASCADE on user delete (v10) |
| `exports` | export records → R2 keys | CASCADE on user delete; `job_id` SET NULL on job delete (v10) |
| `export_jobs` | encode/upload job state machine | CASCADE on user delete |
| `processed_webhooks` | Cashfree idempotency | append-only |
| `pending_orders` | server-side order truth for webhook verification | CASCADE on user delete |
| `monthly_export_counts` | `(user_id, period)` atomic quota | CASCADE on user delete |
| `schema_meta` | migration version | — |

v10 rebuilt `exports` and `user_stats` (SQLite cannot ALTER a foreign key)
and filters historical orphans created while FKs were unenforced.

## Concurrency

Quota/counter mutations are single-statement atomic UPDATEs
(`atomicIncrementUploadCount`, `atomicTryConsumeMonthlyExport`,
`atomicIncrementDownloadCount`) — safe under concurrent requests without
application locks. `/api/exports/complete` is idempotent on
(job completed + same key).

## Operations

- New migration: append statements to `MIGRATIONS`, bump `SCHEMA_VERSION`.
  Never edit an already-released statement in place for prod data.
- Backup: Turso point-in-time recovery (configure retention); local dev file
  is disposable.
