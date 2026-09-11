import type { Client } from '@libsql/client';

const SCHEMA_VERSION = 9;

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
