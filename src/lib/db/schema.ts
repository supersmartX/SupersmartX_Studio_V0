import type { Client } from '@libsql/client';

/**
 * Schema migrations are grouped by version, NOT stored as one flat statement
 * array. The previous shape used the stored `schema_version` as a positional
 * index into a flat array of 39 statements while the highest version was 12, so
 * the number never lined up with an index: bumping the version to 13 replayed
 * everything from index 12 onward, including version 10's
 * `DROP TABLE exports` copy/swap and the `user_stats` rebuild.
 *
 * Rules for this file:
 *  - Never renumber or rewrite a historical group's statements. A group's
 *    `version` is the durable contract with databases already in the field.
 *  - Append a new group; never insert into the middle.
 *  - Versions must be contiguous from 1 (asserted below).
 *  - Add a group, then bump SCHEMA_VERSION to that group's version.
 */
const MIGRATION_LEDGER: { version: number; statements: string[] }[] = [
  {
    version: 1,
    statements: [
      `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'free',
    plan_expires_at TEXT
  )`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE TABLE IF NOT EXISTS reset_tokens (
    token_hash TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
      `CREATE INDEX IF NOT EXISTS idx_reset_tokens_email ON reset_tokens(email)`,
      `CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
    ],
  },
  {
    version: 2,
    statements: [
      `CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    download_count INTEGER NOT NULL DEFAULT 0,
    upload_count INTEGER NOT NULL DEFAULT 0,
    storage_bytes INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
    ],
  },
  {
    version: 3,
    statements: [
      `CREATE TABLE IF NOT EXISTS exports (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    platform TEXT NOT NULL,
    output_width INTEGER NOT NULL,
    output_height INTEGER NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT 'video/mp4',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `CREATE INDEX IF NOT EXISTS idx_exports_user_id ON exports(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exports_user_created ON exports(user_id, created_at DESC)`,
      `CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    config_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    result_r2_key TEXT,
    result_export_id TEXT,
    result_file_size INTEGER DEFAULT 0,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `CREATE INDEX IF NOT EXISTS idx_export_jobs_user_id ON export_jobs(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_export_jobs_status ON export_jobs(status)`,
      `CREATE INDEX IF NOT EXISTS idx_export_jobs_user_created ON export_jobs(user_id, created_at DESC)`,
    ],
  },
  {
    // Version 4 — exports carry a back-reference to the job that produced them.
    version: 4,
    statements: [
      `ALTER TABLE exports ADD COLUMN job_id TEXT REFERENCES export_jobs(id)`,
      `CREATE INDEX IF NOT EXISTS idx_exports_job_id ON exports(job_id)`,
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE IF NOT EXISTS processed_webhooks (
    order_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    ],
  },
  {
    // Version 6 — Account lockout
    version: 6,
    statements: [
      `ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0`,
      `ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL`,
    ],
  },
  {
    // Version 7 — Pending orders for payment verification
    version: 7,
    statements: [
      `CREATE TABLE IF NOT EXISTS pending_orders (
    order_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `CREATE INDEX IF NOT EXISTS idx_pending_orders_user ON pending_orders(user_id)`,
    ],
  },
  {
    // Version 8 — Session version for password-reset invalidation
    version: 8,
    statements: [
      `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    // Version 9 — Monthly export quota atomic counter (Free 3/month)
    version: 9,
    statements: [
      `CREATE TABLE IF NOT EXISTS monthly_export_counts (
    user_id TEXT NOT NULL,
    period TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, period),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `CREATE INDEX IF NOT EXISTS idx_monthly_counts_user_period ON monthly_export_counts(user_id, period)`,
    ],
  },
  {
    // Version 10 — enforce referential actions that earlier versions declared
    // without an action. Previously: deleting an export_job (nightly cleanup) or
    // a user (raw DELETE) failed once FK enforcement was enabled, because
    // exports.job_id and user_stats.user_id defaulted to NO ACTION.
    // exports.job_id uses SET NULL (a completed export must survive job cleanup);
    // user_stats.user_id uses CASCADE (stats are owned 1:1 by the user).
    // SQLite cannot ALTER a foreign key, so both tables are rebuilt. The copy
    // filters pre-existing orphans (possible because FKs were historically
    // unenforced): exports of deleted users are dropped (unreachable via
    // ownership-scoped queries), dangling job_id values become NULL, and
    // user_stats of deleted users are dropped.
    //
    // This copy/swap is atomic under SQLite/Turso's implicit transaction for a
    // single `execute` batch; it must never be replayed by a later version bump,
    // which is exactly what the version-grouped runner prevents.
    version: 10,
    statements: [
      `DROP TABLE IF EXISTS exports_new`,
      `CREATE TABLE IF NOT EXISTS exports_new (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    platform TEXT NOT NULL,
    output_width INTEGER NOT NULL,
    output_height INTEGER NOT NULL,
    file_size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT 'video/mp4',
    status TEXT NOT NULL DEFAULT 'completed',
    created_at TEXT NOT NULL,
    job_id TEXT REFERENCES export_jobs(id) ON DELETE SET NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `INSERT OR IGNORE INTO exports_new (id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id)
   SELECT id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at,
     CASE WHEN job_id IS NULL OR job_id IN (SELECT id FROM export_jobs) THEN job_id ELSE NULL END
   FROM exports WHERE user_id IN (SELECT id FROM users)`,
      `DROP TABLE IF EXISTS exports`,
      `ALTER TABLE exports_new RENAME TO exports`,
      `CREATE INDEX IF NOT EXISTS idx_exports_user_id ON exports(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_exports_user_created ON exports(user_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_exports_job_id ON exports(job_id)`,
      `DROP TABLE IF EXISTS user_stats_new`,
      `CREATE TABLE IF NOT EXISTS user_stats_new (
    user_id TEXT PRIMARY KEY,
    download_count INTEGER NOT NULL DEFAULT 0,
    upload_count INTEGER NOT NULL DEFAULT 0,
    storage_bytes INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `INSERT OR IGNORE INTO user_stats_new (user_id, download_count, upload_count, storage_bytes)
   SELECT user_id, download_count, upload_count, storage_bytes FROM user_stats WHERE user_id IN (SELECT id FROM users)`,
      `DROP TABLE IF EXISTS user_stats`,
      `ALTER TABLE user_stats_new RENAME TO user_stats`,
    ],
  },
  {
    // Version 11 — server-side daily recording ledger (BUS-001 remediation).
    // One row per (user, UTC day); charged atomically at export-creation time.
    // Creator/unlimited plans never write here (no rows = unlimited).
    version: 11,
    statements: [
      `CREATE TABLE IF NOT EXISTS daily_recording_seconds (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
      `CREATE INDEX IF NOT EXISTS idx_daily_recording_user_day ON daily_recording_seconds(user_id, day)`,
    ],
  },
  {
    // Version 12 — notification ledger, deliberately separate from
    // processed_webhooks. That table is a *fulfilment* lock: whichever of the
    // webhook and the return-trip verify claims it owns the plan write, and the
    // loser returns early. Reusing it to gate the receipt email meant that when
    // the redirect beat the webhook (the common case) the buyer was activated
    // and never told. One row per (order, kind) makes "send exactly once" a
    // property of the notification itself, independent of who fulfilled.
    version: 12,
    statements: [
      `CREATE TABLE IF NOT EXISTS order_notifications (
    order_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (order_id, kind)
  )`,
    ],
  },
  {
    // Version 13 — identity tombstone for account deletion. Deleting the users
    // row alone left two problems: the old JWT kept a signature that middleware
    // accepts, and resolveSessionUser() resolves a stale token by EMAIL, so a
    // later signup on the same address was silently adopted by that old token.
    // Storing the highest session version ever issued for a deleted address lets
    // a re-registration start above it, which retires every token minted for the
    // previous identity.
    version: 13,
    statements: [
      `CREATE TABLE IF NOT EXISTS deleted_identities (
    email TEXT PRIMARY KEY,
    session_version INTEGER NOT NULL,
    deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
    ],
  },
  {
    // Version 14 — server-owned export finalization lease. The token fences
    // concurrent completions; the timestamp lets a retry recover after a
    // crashed serverless invocation.
    version: 14,
    statements: [
      `ALTER TABLE export_jobs ADD COLUMN staging_r2_key TEXT`,
      `ALTER TABLE export_jobs ADD COLUMN finalizing_at TEXT`,
      `ALTER TABLE export_jobs ADD COLUMN finalizing_token TEXT`,
    ],
  },
];

/**
 * The migration ledger, exported so a deployment can be reconstructed and
 * asserted version-by-version (see `db-migrations.test.ts`). Treat it as
 * read-only: appending a group is the only supported change.
 */
export const MIGRATIONS: readonly { version: number; statements: string[] }[] = MIGRATION_LEDGER;

export const SCHEMA_VERSION = MIGRATION_LEDGER[MIGRATION_LEDGER.length - 1].version;

// Structural invariant, checked at import time: versions are contiguous from 1
// and strictly increasing. A gap would make a stored version unrepresentable.
for (let i = 0; i < MIGRATION_LEDGER.length; i++) {
  const expected = i + 1;
  if (MIGRATION_LEDGER[i].version !== expected) {
    throw new Error(
      `[DB] Migration versions must be contiguous from 1: expected version ${expected}, found ${MIGRATION_LEDGER[i].version}`,
    );
  }
}

/**
 * Reads the stored schema version.
 *
 * Only a genuinely absent `schema_meta` table means "fresh database" (0). Any
 * other failure — permissions, network, a corrupt backend — is rethrown, because
 * falling back to 0 would replay every historical migration against a database
 * that already has data, and the version-10 copy/swap would rebuild `exports`
 * and `user_stats` on the way through.
 */
async function getSchemaVersion(db: Client): Promise<number> {
  let result;
  try {
    result = await db.execute({
      sql: 'SELECT value FROM schema_meta WHERE key = ?',
      args: ['schema_version'],
    });
  } catch (e) {
    const message = (e instanceof Error ? e.message : String(e)).toLowerCase();
    if (message.includes('no such table') || message.includes('does not exist')) return 0;
    throw new Error(`[DB] Failed to read schema version: ${message}`);
  }
  if (result.rows.length === 0) return 0;
  const value = Number(result.rows[0].value);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`[DB] Stored schema_version is not a valid version: ${String(result.rows[0].value)}`);
  }
  return value;
}

/**
 * Applies every version group after `currentVersion`, one group per transaction.
 *
 * Each group is sent to libSQL as a single `batch` in write mode, which the
 * client wraps in BEGIN…COMMIT and rolls back as a unit on any failure. That is
 * what makes the v10 copy/swap safe: it drops `exports`, rebuilds it from
 * `exports_new` and renames — a sequence that, executed one statement at a time,
 * can fail between the DROP and the RENAME and leave a production database with
 * no exports table at all. The version stamp rides in the same batch, so a
 * version can never be recorded without its statements, or applied without
 * being recorded.
 *
 * Consequence worth stating: a group that fails leaves the database exactly as
 * it was, at the last fully applied version, and the next start retries it.
 * That is why there is no per-statement "already exists, carry on" leniency
 * here. Every CREATE in the ledger is `IF NOT EXISTS` and every DROP is
 * `IF EXISTS`, so a duplicate error can only mean the recorded version disagrees
 * with the real schema — an inconsistent database that must stop the deploy
 * loudly rather than be papered over.
 */
export async function migrate(db: Client): Promise<void> {
  const currentVersion = await getSchemaVersion(db);

  // A database newer than this build means the code is behind the schema.
  // Refuse rather than "upgrading" downwards with migrations that may not apply.
  if (currentVersion > SCHEMA_VERSION) {
    throw new Error(
      `[DB] Database schema version ${currentVersion} is newer than this build's ${SCHEMA_VERSION}. Deploy a newer build before touching migrations.`,
    );
  }

  if (currentVersion === SCHEMA_VERSION) return;

  for (const migration of MIGRATIONS) {
    if (migration.version <= currentVersion) continue;

    // The version stamp is part of the same transaction as the statements it
    // describes. Appending a group is the only supported way to change the
    // schema: never renumber, never edit an applied group.
    const batch = [
      ...migration.statements,
      {
        sql: 'INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)',
        args: ['schema_version', String(migration.version)],
      },
    ];

    try {
      await db.batch(batch, 'write');
    } catch (e: unknown) {
      const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
      throw new Error(
        `[DB] Migration ${migration.version} failed and was rolled back; schema is unchanged at version ${currentVersion}: ${msg}`,
      );
    }
  }
}