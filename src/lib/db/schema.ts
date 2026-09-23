import type { Client } from '@libsql/client';

const SCHEMA_VERSION = 11;

const MIGRATIONS = [
  // Version 1
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
  // Version 2
  `CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    download_count INTEGER NOT NULL DEFAULT 0,
    upload_count INTEGER NOT NULL DEFAULT 0,
    storage_bytes INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`,
  // Version 3
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
  // Version 4
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
  `ALTER TABLE exports ADD COLUMN job_id TEXT REFERENCES export_jobs(id)`,
  `CREATE INDEX IF NOT EXISTS idx_exports_job_id ON exports(job_id)`,
  // Version 5
  `CREATE TABLE IF NOT EXISTS processed_webhooks (
    order_id TEXT PRIMARY KEY,
    processed_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // Version 6 — Account lockout
  `ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL`,
  // Version 7 — Pending orders for payment verification
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
  // Version 8 — Session version for password-reset invalidation
  `ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0`,
  // Version 9 — Monthly export quota atomic counter (Free 3/month)
  `CREATE TABLE IF NOT EXISTS monthly_export_counts (
    user_id TEXT NOT NULL,
    period TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, period),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_monthly_counts_user_period ON monthly_export_counts(user_id, period)`,
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
  // Version 11 — server-side daily recording ledger (BUS-001 remediation).
  // One row per (user, UTC day); charged atomically at export-creation time.
  // Creator/unlimited plans never write here (no rows = unlimited).
  `CREATE TABLE IF NOT EXISTS daily_recording_seconds (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    seconds REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_recording_user_day ON daily_recording_seconds(user_id, day)`,
];

async function getSchemaVersion(db: Client): Promise<number> {
  try {
    const result = await db.execute({
      sql: 'SELECT value FROM schema_meta WHERE key = ?',
      args: ['schema_version'],
    });
    return result.rows[0] ? Number(result.rows[0].value) : 0;
  } catch {
    return 0;
  }
}

async function setSchemaVersion(db: Client, version: number): Promise<void> {
  await db.execute({
    sql: 'INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)',
    args: ['schema_version', String(version)],
  });
}

export async function migrate(db: Client): Promise<void> {
  const currentVersion = await getSchemaVersion(db);

  if (currentVersion >= SCHEMA_VERSION) return;

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    try {
      await db.execute(MIGRATIONS[i]);
    } catch (e: any) {
      // SQLite: "duplicate column name" or "already exists" = safe to skip
      const msg = (e?.message || '').toLowerCase();
      if (msg.includes('duplicate') || msg.includes('already exists')) {
        continue;
      }
      throw e;
    }
  }

  await setSchemaVersion(db, SCHEMA_VERSION);
}
