import { getDb } from './driver';
import { migrate } from './schema';
import crypto from 'crypto';
import type { StoredUser, ResetToken, PlanType, ExportRecord, ExportJobRecord, ExportJobStatus } from '@/types/db';

let migrationPromise: Promise<void> | null = null;

export async function ensureMigrated(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const db = getDb();
    await migrate(db);
  })();
  return migrationPromise;
}

export function setMigrated(value: boolean): void {
  if (value) {
    migrationPromise = Promise.resolve();
  } else {
    migrationPromise = null;
  }
}

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, email, name, password_hash, created_at, plan, plan_expires_at FROM users WHERE email = ?',
    args: [email.toLowerCase()],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    passwordHash: row.password_hash as string,
    createdAt: row.created_at as string,
    plan: row.plan as PlanType,
    planExpiresAt: row.plan_expires_at as string | undefined,
  };
}

export async function findUserById(userId: string): Promise<StoredUser | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, email, name, password_hash, created_at, plan, plan_expires_at FROM users WHERE id = ?',
    args: [userId],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    id: row.id as string,
    email: row.email as string,
    name: row.name as string,
    passwordHash: row.password_hash as string,
    createdAt: row.created_at as string,
    plan: row.plan as PlanType,
    planExpiresAt: row.plan_expires_at as string | undefined,
  };
}

export async function createUser(
  email: string,
  name: string,
  passwordHash: string,
  id?: string,
  createdAt?: string,
): Promise<StoredUser> {
  await ensureMigrated();
  const db = getDb();
  const userId = id || `user-${crypto.randomUUID()}`;
  const now = createdAt || new Date().toISOString();
  await db.execute({
    sql: 'INSERT INTO users (id, email, name, password_hash, created_at, plan) VALUES (?, ?, ?, ?, ?, ?)',
    args: [userId, email.toLowerCase(), name, passwordHash, now, 'free'],
  });
  return {
    id: userId,
    email: email.toLowerCase(),
    name,
    passwordHash,
    createdAt: now,
    plan: 'free',
  };
}

export async function updateUserPlan(
  email: string,
  plan: PlanType,
  expiresAt?: string,
): Promise<boolean> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'UPDATE users SET plan = ?, plan_expires_at = ? WHERE email = ?',
    args: [plan, expiresAt || null, email.toLowerCase()],
  });
  return result.rowsAffected > 0;
}

export async function updateUserPassword(
  email: string,
  passwordHash: string,
): Promise<boolean> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'UPDATE users SET password_hash = ? WHERE email = ?',
    args: [passwordHash, email.toLowerCase()],
  });
  return result.rowsAffected > 0;
}

export async function saveResetToken(token: ResetToken): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  // Delete any existing token for this email, then insert the new one
  await db.execute({
    sql: 'DELETE FROM reset_tokens WHERE email = ?',
    args: [token.email],
  });
  await db.execute({
    sql: 'INSERT INTO reset_tokens (token_hash, email, expires_at) VALUES (?, ?, ?)',
    args: [token.tokenHash, token.email, token.expiresAt],
  });
}

export async function findResetToken(tokenHash: string): Promise<ResetToken | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT token_hash, email, expires_at FROM reset_tokens WHERE token_hash = ?',
    args: [tokenHash],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    tokenHash: row.token_hash as string,
    email: row.email as string,
    expiresAt: row.expires_at as string,
  };
}

export async function deleteResetToken(tokenHash: string): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: 'DELETE FROM reset_tokens WHERE token_hash = ?',
    args: [tokenHash],
  });
}

export async function deleteResetTokensByEmail(email: string): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: 'DELETE FROM reset_tokens WHERE email = ?',
    args: [email],
  });
}

export interface UserStats {
  downloadCount: number;
  uploadCount: number;
  storageBytes: number;
}

export async function getUserStats(userId: string): Promise<UserStats> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT download_count, upload_count, storage_bytes FROM user_stats WHERE user_id = ?',
    args: [userId],
  });
  if (result.rows.length === 0) {
    return { downloadCount: 0, uploadCount: 0, storageBytes: 0 };
  }
  const row = result.rows[0];
  return {
    downloadCount: Number(row.download_count),
    uploadCount: Number(row.upload_count),
    storageBytes: Number(row.storage_bytes),
  };
}

export async function incrementDownloadCount(userId: string): Promise<UserStats> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO user_stats (user_id, download_count, upload_count, storage_bytes)
          VALUES (?, 1, 0, 0)
          ON CONFLICT(user_id) DO UPDATE SET download_count = download_count + 1`,
    args: [userId],
  });
  return getUserStats(userId);
}

export async function incrementUploadCount(userId: string, storageBytes: number): Promise<UserStats> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO user_stats (user_id, download_count, upload_count, storage_bytes)
          VALUES (?, 0, 1, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            upload_count = upload_count + 1,
            storage_bytes = storage_bytes + ?`,
    args: [userId, storageBytes, storageBytes],
  });
  return getUserStats(userId);
}

export async function atomicIncrementUploadCount(
  userId: string,
  fileSize: number,
  maxUploads: number | null,
  maxStorageBytes: number | null,
): Promise<{ allowed: true; stats: UserStats } | { allowed: false; reason: string; stats: UserStats }> {
  await ensureMigrated();
  const db = getDb();

  // Build conditional WHERE clauses for atomic check+increment
  const conditions: string[] = [];
  const args: (string | number)[] = [userId, fileSize, fileSize];

  if (maxUploads !== null) {
    conditions.push('upload_count < ?');
    args.push(maxUploads);
  }
  if (maxStorageBytes !== null) {
    conditions.push('(storage_bytes + ?) <= ?');
    args.push(fileSize, maxStorageBytes);
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const result = await db.execute({
    sql: `UPDATE user_stats
          SET upload_count = upload_count + 1, storage_bytes = storage_bytes + ?
          WHERE user_id = ? ${whereClause}`,
    args,
  });

  if (result.rowsAffected === 0) {
    const currentStats = await getUserStats(userId);
    if (maxUploads !== null && currentStats.uploadCount >= maxUploads) {
      return { allowed: false, reason: `Upload limit reached (${maxUploads} files)`, stats: currentStats };
    }
    if (maxStorageBytes !== null && currentStats.storageBytes + fileSize > maxStorageBytes) {
      return { allowed: false, reason: `Storage limit reached`, stats: currentStats };
    }
    // Row doesn't exist yet — create it and allow
    await ensureUserStatsRow(userId);
    await db.execute({
      sql: `UPDATE user_stats SET upload_count = 1, storage_bytes = ? WHERE user_id = ?`,
      args: [fileSize, userId],
    });
    const newStats = await getUserStats(userId);
    return { allowed: true, stats: newStats };
  }

  const finalStats = await getUserStats(userId);
  return { allowed: true, stats: finalStats };
}

export async function getActiveExportJobCount(userId: string): Promise<number> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT COUNT(*) as cnt FROM export_jobs
          WHERE user_id = ? AND status IN ('pending', 'encoding', 'uploading')`,
    args: [userId],
  });
  return Number(result.rows[0]?.cnt) || 0;
}

export async function createExport(record: Omit<ExportRecord, 'id' | 'createdAt'>): Promise<ExportRecord> {
  await ensureMigrated();
  const db = getDb();
  const id = `export-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO exports (id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, record.userId, record.r2Key, record.platform, record.outputWidth, record.outputHeight, record.fileSize, record.mimeType, record.status, now, record.jobId || null],
  });
  return { ...record, id, createdAt: now };
}

export async function findExportById(exportId: string): Promise<ExportRecord | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id FROM exports WHERE id = ?',
    args: [exportId],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    id: row.id as string,
    userId: row.user_id as string,
    r2Key: row.r2_key as string,
    platform: row.platform as string,
    outputWidth: Number(row.output_width),
    outputHeight: Number(row.output_height),
    fileSize: Number(row.file_size),
    mimeType: row.mime_type as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    jobId: row.job_id as string | null,
  };
}

export async function findExportByIdAndUser(exportId: string, userId: string): Promise<ExportRecord | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id FROM exports WHERE id = ? AND user_id = ?',
    args: [exportId, userId],
  });
  if (result.rows.length === 0) return undefined;
  const row = result.rows[0];
  return {
    id: row.id as string,
    userId: row.user_id as string,
    r2Key: row.r2_key as string,
    platform: row.platform as string,
    outputWidth: Number(row.output_width),
    outputHeight: Number(row.output_height),
    fileSize: Number(row.file_size),
    mimeType: row.mime_type as string,
    status: row.status as string,
    createdAt: row.created_at as string,
    jobId: row.job_id as string | null,
  };
}

export async function atomicIncrementDownloadCount(userId: string, maxDownloads: number): Promise<boolean> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: `UPDATE user_stats
          SET download_count = download_count + 1
          WHERE user_id = ?
          AND ? > download_count`,
    args: [userId, maxDownloads],
  });
  return result.rowsAffected > 0;
}

export async function ensureUserStatsRow(userId: string): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO user_stats (user_id, download_count, upload_count, storage_bytes)
          VALUES (?, 0, 0, 0)
          ON CONFLICT(user_id) DO NOTHING`,
    args: [userId],
  });
}

function mapExportJobRow(row: Record<string, unknown>): ExportJobRecord {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    configJson: row.config_json as string,
    status: row.status as ExportJobStatus,
    progress: Number(row.progress),
    resultR2Key: row.result_r2_key as string | null,
    resultExportId: row.result_export_id as string | null,
    resultFileSize: Number(row.result_file_size),
    errorMessage: row.error_message as string | null,
    retryCount: Number(row.retry_count),
    createdAt: row.created_at as string,
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
  };
}

export async function createExportJob(
  userId: string,
  configJson: string,
): Promise<ExportJobRecord> {
  await ensureMigrated();
  const db = getDb();
  const id = `ej-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO export_jobs (id, user_id, config_json, status, progress, retry_count, created_at)
          VALUES (?, ?, ?, 'pending', 0, 0, ?)`,
    args: [id, userId, configJson, now],
  });
  return {
    id, userId, configJson, status: 'pending', progress: 0,
    resultR2Key: null, resultExportId: null, resultFileSize: 0,
    errorMessage: null, retryCount: 0, createdAt: now,
    startedAt: null, completedAt: null,
  };
}

export async function updateExportJobStatus(
  jobId: string,
  status: ExportJobStatus,
  patch: {
    progress?: number;
    resultR2Key?: string;
    resultExportId?: string;
    resultFileSize?: number;
    errorMessage?: string;
  } = {},
): Promise<boolean> {
  await ensureMigrated();
  const db = getDb();
  const sets: string[] = ['status = ?'];
  const args: (string | number | null)[] = [status];

  if (status === 'encoding' || status === 'uploading') {
    sets.push("started_at = COALESCE(started_at, CURRENT_TIMESTAMP)");
  }
  if (status === 'completed' || status === 'failed') {
    sets.push("completed_at = CURRENT_TIMESTAMP");
  }
  if (patch.progress !== undefined) {
    sets.push('progress = ?');
    args.push(patch.progress);
  }
  if (patch.resultR2Key !== undefined) {
    sets.push('result_r2_key = ?');
    args.push(patch.resultR2Key);
  }
  if (patch.resultExportId !== undefined) {
    sets.push('result_export_id = ?');
    args.push(patch.resultExportId);
  }
  if (patch.resultFileSize !== undefined) {
    sets.push('result_file_size = ?');
    args.push(patch.resultFileSize);
  }
  if (patch.errorMessage !== undefined) {
    sets.push('error_message = ?');
    args.push(patch.errorMessage);
  }

  args.push(jobId);
  const result = await db.execute({
    sql: `UPDATE export_jobs SET ${sets.join(', ')} WHERE id = ?`,
    args,
  });
  return result.rowsAffected > 0;
}

export async function findExportJobById(jobId: string): Promise<ExportJobRecord | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM export_jobs WHERE id = ?',
    args: [jobId],
  });
  if (result.rows.length === 0) return undefined;
  return mapExportJobRow(result.rows[0]);
}

export async function findExportJobByIdAndUser(
  jobId: string,
  userId: string,
): Promise<ExportJobRecord | undefined> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT * FROM export_jobs WHERE id = ? AND user_id = ?',
    args: [jobId, userId],
  });
  if (result.rows.length === 0) return undefined;
  return mapExportJobRow(result.rows[0]);
}

export async function deleteOldExportJobs(maxAgeMs: number): Promise<number> {
  await ensureMigrated();
  const db = getDb();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  const result = await db.execute({
    sql: 'DELETE FROM export_jobs WHERE created_at < ?',
    args: [cutoff],
  });
  return result.rowsAffected;
}

export async function isWebhookProcessed(orderId: string): Promise<boolean> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: `SELECT 1 FROM processed_webhooks WHERE order_id = ? LIMIT 1`,
    args: [orderId],
  });
  return result.rows.length > 0;
}

export async function markWebhookProcessed(orderId: string): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: `INSERT OR IGNORE INTO processed_webhooks (order_id) VALUES (?)`,
    args: [orderId],
  });
}

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function recordFailedLogin(email: string): Promise<{ locked: boolean; attempts: number }> {
  await ensureMigrated();
  const db = getDb();
  const now = new Date().toISOString();
  await db.execute({
    sql: `UPDATE users SET
            failed_login_attempts = failed_login_attempts + 1,
            locked_until = CASE
              WHEN failed_login_attempts + 1 >= ? THEN datetime('now', '+15 minutes')
              ELSE locked_until
            END
          WHERE email = ? AND (locked_until IS NULL OR locked_until < datetime('now'))`,
    args: [LOCKOUT_THRESHOLD, email.toLowerCase()],
  });
  const result = await db.execute({
    sql: 'SELECT failed_login_attempts, locked_until FROM users WHERE email = ?',
    args: [email.toLowerCase()],
  });
  const row = result.rows[0];
  if (!row) return { locked: false, attempts: 0 };
  const attempts = Number(row.failed_login_attempts);
  const lockedUntil = row.locked_until as string | null;
  return { locked: lockedUntil !== null && new Date(lockedUntil) > new Date(now), attempts };
}

export async function isAccountLocked(email: string): Promise<boolean> {
  await ensureMigrated();
  const db = getDb();
  const result = await db.execute({
    sql: 'SELECT locked_until FROM users WHERE email = ?',
    args: [email.toLowerCase()],
  });
  const row = result.rows[0];
  if (!row || !row.locked_until) return false;
  return new Date(row.locked_until as string) > new Date();
}

export async function resetFailedLogins(email: string): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db.execute({
    sql: "UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE email = ?",
    args: [email.toLowerCase()],
  });
}
