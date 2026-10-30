import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { getPrisma } from './prisma';
import type { StoredUser, ResetToken, PlanType, ExportRecord, ExportJobRecord, ExportJobStatus } from '@/types/db';

/**
 * The application data layer, now backed by PostgreSQL through Prisma.
 *
 * Every exported function keeps the exact signature and observable behaviour it
 * had on Turso/libSQL: the same atomic claims, the same conditional counters,
 * the same `rowsAffected`-style booleans, and the same `string` timestamps at
 * the boundary (Prisma returns `Date`; the mappers below convert).
 *
 * Only this module talks to Prisma for application state. Callers never see a
 * `Date`, a `bigint`, or a Prisma error object.
 */

/**
 * The application's logical schema version, preserved from the retired libSQL
 * migration runner (`src/lib/db/schema.ts`, ledger v1–v14). Prisma Migrate is
 * now the single schema authority (`prisma/migrations` + `_prisma_migrations`);
 * this constant is no longer used to *apply* DDL. It is written once into the
 * legacy `schema_meta` marker (see `ensureMigrated`) solely so `/api/health`
 * keeps reporting the same value it always did.
 */
export const SCHEMA_VERSION = 14;

let migrationPromise: Promise<void> | null = null;

/**
 * Ensures the process is bound to a reachable database and that the legacy
 * `schema_meta` version marker exists.
 *
 * This replaces the old runtime migration runner. Prisma Migrate applies schema
 * changes at deploy time, so there is no DDL here. What is preserved:
 *
 *  - the first database call proves connectivity and fails loudly if it cannot,
 *  - `schema_meta.schema_version` is initialised exactly as the old runner left
 *    it on a fresh database, so `/api/health` continues to report `14`.
 *
 * The insert is `DO NOTHING`, so an existing (possibly newer) value is never
 * overwritten — matching the old runner's refusal to downgrade a database that
 * is ahead of this build.
 */
export async function ensureMigrated(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const prisma = getPrisma();
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$executeRaw`
        INSERT INTO schema_meta ("key", "value")
        VALUES ('schema_version', ${String(SCHEMA_VERSION)})
        ON CONFLICT ("key") DO NOTHING`;
    })().catch((err) => {
      migrationPromise = null;
      throw err;
    });
  }
  await migrationPromise;
}

export function setMigrated(value: boolean): void {
  if (value) {
    migrationPromise = Promise.resolve();
  } else {
    migrationPromise = null;
  }
}

// ---------------------------------------------------------------------------
// Row mappers. Prisma yields `Date` for timestamptz and `bigint` for BIGINT; the
// public contract is ISO strings and `number`, so the conversion happens here
// and nowhere else.
// ---------------------------------------------------------------------------

function toIso(value: Date): string;
function toIso(value: Date | null): string | null;
function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

type UserFields = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  createdAt: Date;
  plan: string;
  planExpiresAt: Date | null;
  sessionVersion: number;
};

const userSelect = {
  id: true,
  email: true,
  name: true,
  passwordHash: true,
  createdAt: true,
  plan: true,
  planExpiresAt: true,
  sessionVersion: true,
} as const;

function mapUser(row: UserFields): StoredUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    createdAt: toIso(row.createdAt),
    plan: row.plan as PlanType,
    planExpiresAt: row.planExpiresAt ? row.planExpiresAt.toISOString() : undefined,
    sessionVersion: row.sessionVersion,
  };
}

type ExportFields = {
  id: string;
  userId: string;
  r2Key: string;
  platform: string;
  outputWidth: number;
  outputHeight: number;
  fileSize: bigint;
  mimeType: string;
  status: string;
  createdAt: Date;
  jobId: string | null;
};

function mapExport(row: ExportFields): ExportRecord {
  return {
    id: row.id,
    userId: row.userId,
    r2Key: row.r2Key,
    platform: row.platform,
    outputWidth: row.outputWidth,
    outputHeight: row.outputHeight,
    fileSize: Number(row.fileSize),
    mimeType: row.mimeType,
    status: row.status,
    createdAt: toIso(row.createdAt),
    jobId: row.jobId,
  };
}

type ExportJobFields = {
  id: string;
  userId: string;
  configJson: string;
  status: string;
  progress: number;
  stagingR2Key: string | null;
  resultR2Key: string | null;
  resultExportId: string | null;
  resultFileSize: bigint | null;
  errorMessage: string | null;
  retryCount: number;
  createdAt: Date;
  startedAt: Date | null;
  finalizingAt: Date | null;
  completedAt: Date | null;
};

function mapExportJob(row: ExportJobFields): ExportJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    configJson: row.configJson,
    status: row.status as ExportJobStatus,
    progress: row.progress,
    stagingR2Key: row.stagingR2Key,
    resultR2Key: row.resultR2Key,
    resultExportId: row.resultExportId,
    resultFileSize: Number(row.resultFileSize ?? 0),
    errorMessage: row.errorMessage,
    retryCount: row.retryCount,
    createdAt: toIso(row.createdAt),
    startedAt: toIso(row.startedAt),
    finalizingAt: toIso(row.finalizingAt),
    completedAt: toIso(row.completedAt),
  };
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function findUserByEmail(email: string): Promise<StoredUser | undefined> {
  await ensureMigrated();
  const row = await getPrisma().user.findUnique({
    where: { email: email.toLowerCase() },
    select: userSelect,
  });
  return row ? mapUser(row) : undefined;
}

export async function findUserById(userId: string): Promise<StoredUser | undefined> {
  await ensureMigrated();
  const row = await getPrisma().user.findUnique({
    where: { id: userId },
    select: userSelect,
  });
  return row ? mapUser(row) : undefined;
}

/**
 * Records that an identity was deleted, along with the highest session version
 * ever issued to it.
 *
 * Deleting the `users` row is not enough to end an identity. `middleware` only
 * verifies the JWT signature, and `resolveSessionUser` resolves a stale token by
 * EMAIL — so after a delete, a later signup on the same address would be
 * adopted by the deleted account's still-valid cookie. The high-water mark lets
 * a re-registration start above it, which retires every token from the previous
 * identity instead of silently re-provisioning it.
 *
 * The `GREATEST` upsert is what makes the mark monotonic under concurrent
 * deletes: a second tombstone can never lower the version.
 */
export async function recordDeletedIdentity(email: string, sessionVersion: number): Promise<void> {
  await ensureMigrated();
  const version = Number.isInteger(sessionVersion) && sessionVersion > 0 ? sessionVersion : 1;
  await getPrisma().$executeRaw`
    INSERT INTO deleted_identities (email, session_version, deleted_at)
    VALUES (${email.toLowerCase()}, ${version}, ${new Date()})
    ON CONFLICT (email) DO UPDATE SET
      session_version = GREATEST(deleted_identities.session_version, EXCLUDED.session_version),
      deleted_at = EXCLUDED.deleted_at`;
}

export async function getDeletedIdentitySessionVersion(email: string): Promise<number | null> {
  await ensureMigrated();
  const row = await getPrisma().deletedIdentity.findUnique({
    where: { email: email.toLowerCase() },
    select: { sessionVersion: true },
  });
  if (!row) return null;
  return Number.isInteger(row.sessionVersion) ? row.sessionVersion : null;
}

export async function createUser(
  email: string,
  name: string,
  passwordHash: string,
  id?: string,
  createdAt?: string,
): Promise<StoredUser> {
  await ensureMigrated();
  const userId = id || `user-${crypto.randomUUID()}`;
  const now = createdAt || new Date().toISOString();
  const normalizedEmail = email.toLowerCase();
  // Start above every session version ever issued for this address, so a
  // re-registration on a deleted identity cannot be resumed by a cookie that
  // predates the deletion.
  const sessionVersion = (await getDeletedIdentitySessionVersion(normalizedEmail)) ?? 0;
  await getPrisma().user.create({
    data: {
      id: userId,
      email: normalizedEmail,
      name,
      passwordHash,
      createdAt: new Date(now),
      plan: 'free',
      sessionVersion,
    },
  });
  return {
    id: userId,
    email: normalizedEmail,
    name,
    passwordHash,
    createdAt: now,
    plan: 'free',
    sessionVersion,
  };
}

/**
 * Inserts a minimal OAuth/ephemeral account row if (and only if) no row already
 * owns the id or the email. Replaces the raw `INSERT OR IGNORE INTO users` used
 * by the OAuth first-login and payment stub paths.
 */
export async function ensureOAuthUser(input: {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
}): Promise<void> {
  await ensureMigrated();
  await getPrisma().user.createMany({
    data: [
      {
        id: input.id,
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: input.passwordHash,
        createdAt: new Date(),
        plan: 'free',
      },
    ],
    skipDuplicates: true,
  });
}

export async function updateUserPlan(
  email: string,
  plan: PlanType,
  expiresAt?: string,
): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().user.updateMany({
    where: { email: email.toLowerCase() },
    data: { plan, planExpiresAt: expiresAt ? new Date(expiresAt) : null },
  });
  return result.count > 0;
}

export async function updateUserPlanById(
  userId: string,
  plan: PlanType,
  expiresAt?: string,
): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().user.updateMany({
    where: { id: userId },
    data: { plan, planExpiresAt: expiresAt ? new Date(expiresAt) : null },
  });
  return result.count > 0;
}

/**
 * Extends (or starts) a paid plan by exactly one purchased term, and returns
 * the expiry that was stored.
 *
 * A single statement, because a purchase is now also a renewal: two paid orders
 * settling at the same time must stack their terms, and a read-then-write would
 * lose one of them. Postgres evaluates every SET expression against the OLD
 * row, so the CASE can test the stored plan/expiry directly.
 *
 * The term is added to the stored expiry while the paid plan is still active,
 * and to the database clock otherwise — that is what makes a renewal continue
 * from the current end date and an expired (or free) account start fresh. Using
 * the database clock avoids trusting the application server's clock for the
 * entitlement boundary.
 *
 * `interval` is always a server-constructed literal, never user input.
 *
 * Returns null when no user row matched, so the caller can distinguish "user
 * missing" from a successful write.
 */
/**
 * The single statement that extends a plan by one purchased term. Shared by the
 * standalone helper and the atomic settlement so the two can never drift on
 * renewal semantics (stack onto the stored expiry; start from the database
 * clock when free/expired).
 */
function planTermExtensionSql(
  userId: string,
  plan: PlanType,
  interval: '1 month' | '1 year',
): Prisma.Sql {
  return Prisma.sql`
    UPDATE users
    SET plan = ${plan},
        plan_expires_at = CASE
          WHEN plan = 'free' OR plan_expires_at IS NULL OR plan_expires_at <= now()
            THEN now() + ${interval}::interval
          ELSE plan_expires_at + ${interval}::interval
        END
    WHERE id = ${userId}
    RETURNING plan_expires_at`;
}

export async function extendUserPlanTerm(
  userId: string,
  plan: PlanType,
  interval: '1 month' | '1 year',
): Promise<string | null> {
  await ensureMigrated();
  const rows = await getPrisma().$queryRaw<{ plan_expires_at: Date }[]>(
    planTermExtensionSql(userId, plan, interval),
  );
  const stored = rows[0]?.plan_expires_at;
  return stored ? stored.toISOString() : null;
}

/**
 * The most recently fulfilled paid order for a user.
 *
 * Used to decide whether a refunded order is still the grant that owns the
 * current entitlement: if anything settled after it, the refunded order's term
 * is buried under a later purchase and revoking would strip access the user
 * paid for.
 */
export async function findLatestFulfilledOrder(
  userId: string,
): Promise<{ orderId: string; processedAt: string } | null> {
  await ensureMigrated();
  const rows = await getPrisma().$queryRaw<{ order_id: string; processed_at: Date }[]>`
    SELECT w.order_id, w.processed_at
    FROM processed_webhooks w
    JOIN pending_orders p ON p.order_id = w.order_id
    WHERE p.user_id = ${userId}
    ORDER BY w.processed_at DESC
    LIMIT 1`;
  const row = rows[0];
  return row ? { orderId: row.order_id, processedAt: row.processed_at.toISOString() } : null;
}

/**
 * Revokes a paid plan only while the stored expiry is still the one being
 * revoked (compare-and-set). A concurrent purchase that has already extended
 * the plan fails the match, so a refund of an older order can never downgrade
 * access the user has since paid for.
 */
export async function revokeUserPlanIfCurrent(
  userId: string,
  expectedExpiresAt: string,
): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().user.updateMany({
    where: { id: userId, planExpiresAt: new Date(expectedExpiresAt) },
    data: { plan: 'free', planExpiresAt: null },
  });
  return result.count > 0;
}

export async function updateUserPassword(
  email: string,
  passwordHash: string,
): Promise<boolean> {
  await ensureMigrated();
  // Increment session_version to invalidate all existing JWTs for this user
  const result = await getPrisma().user.updateMany({
    where: { email: email.toLowerCase() },
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });
  return result.count > 0;
}

export async function incrementSessionVersion(userId: string): Promise<number> {
  await ensureMigrated();
  const prisma = getPrisma();
  const result = await prisma.user.updateMany({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });
  if (result.count === 0) return 0;
  const check = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return check?.sessionVersion ?? 0;
}

// ---------------------------------------------------------------------------
// Password reset tokens
// ---------------------------------------------------------------------------

export async function saveResetToken(token: ResetToken): Promise<void> {
  await ensureMigrated();
  const prisma = getPrisma();
  // Replace any existing token for this email atomically, so a failure between
  // the delete and the insert can never leave the address token-less.
  await prisma.$transaction([
    prisma.resetToken.deleteMany({ where: { email: token.email } }),
    prisma.resetToken.create({
      data: {
        tokenHash: token.tokenHash,
        email: token.email,
        expiresAt: new Date(token.expiresAt),
      },
    }),
  ]);
}

export async function findResetToken(tokenHash: string): Promise<ResetToken | undefined> {
  await ensureMigrated();
  const row = await getPrisma().resetToken.findUnique({ where: { tokenHash } });
  if (!row) return undefined;
  return {
    tokenHash: row.tokenHash,
    email: row.email,
    expiresAt: toIso(row.expiresAt),
  };
}

export async function deleteResetToken(tokenHash: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().resetToken.deleteMany({ where: { tokenHash } });
}

export async function consumeResetToken(tokenHash: string): Promise<ResetToken | null> {
  await ensureMigrated();
  // Atomic single-use: delete only if not expired and return the deleted row.
  // `DELETE … RETURNING` has no Prisma Client equivalent, so it stays raw SQL
  // with a bound parameter (never string concatenation).
  const rows = await getPrisma().$queryRaw<
    { token_hash: string; email: string; expires_at: Date }[]
  >`DELETE FROM reset_tokens WHERE token_hash = ${tokenHash} AND expires_at > now()
    RETURNING token_hash, email, expires_at`;
  const row = rows[0];
  if (!row) return null;
  return {
    tokenHash: row.token_hash,
    email: row.email,
    expiresAt: toIso(row.expires_at),
  };
}

export async function deleteResetTokensByEmail(email: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().resetToken.deleteMany({ where: { email } });
}

// ---------------------------------------------------------------------------
// Per-user usage counters
// ---------------------------------------------------------------------------

export interface UserStats {
  downloadCount: number;
  uploadCount: number;
  storageBytes: number;
}

function toStats(row: { downloadCount: number; uploadCount: number; storageBytes: bigint }): UserStats {
  return {
    downloadCount: row.downloadCount,
    uploadCount: row.uploadCount,
    storageBytes: Number(row.storageBytes),
  };
}

export async function getUserStats(userId: string): Promise<UserStats> {
  await ensureMigrated();
  const row = await getPrisma().userStats.findUnique({
    where: { userId },
    select: { downloadCount: true, uploadCount: true, storageBytes: true },
  });
  if (!row) return { downloadCount: 0, uploadCount: 0, storageBytes: 0 };
  return toStats(row);
}

export async function incrementDownloadCount(userId: string): Promise<UserStats> {
  await ensureMigrated();
  await getPrisma().userStats.upsert({
    where: { userId },
    create: { userId, downloadCount: 1, uploadCount: 0, storageBytes: BigInt(0) },
    update: { downloadCount: { increment: 1 } },
  });
  return getUserStats(userId);
}

export async function incrementUploadCount(userId: string, storageBytes: number): Promise<UserStats> {
  await ensureMigrated();
  const delta = BigInt(Math.trunc(storageBytes));
  await getPrisma().userStats.upsert({
    where: { userId },
    create: { userId, downloadCount: 0, uploadCount: 1, storageBytes: delta },
    update: { uploadCount: { increment: 1 }, storageBytes: { increment: delta } },
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
  const prisma = getPrisma();
  const bytes = BigInt(Math.trunc(fileSize));

  // Conditional check+increment in a single statement, exactly as the SQL
  // `WHERE …` guarded UPDATE did. The limits are expressed on the pre-increment
  // row so a concurrent upload cannot slip past the bound.
  const where: Prisma.UserStatsWhereInput = { userId };
  if (maxUploads !== null) where.uploadCount = { lt: maxUploads };
  if (maxStorageBytes !== null) where.storageBytes = { lte: BigInt(Math.trunc(maxStorageBytes)) - bytes };
  const data: Prisma.UserStatsUpdateManyMutationInput = {
    uploadCount: { increment: 1 },
    storageBytes: { increment: bytes },
  };

  const first = await prisma.userStats.updateMany({ where, data });
  if (first.count > 0) {
    return { allowed: true, stats: await getUserStats(userId) };
  }

  const currentStats = await getUserStats(userId);
  if (maxUploads !== null && currentStats.uploadCount >= maxUploads) {
    return { allowed: false, reason: `Upload limit reached (${maxUploads} files)`, stats: currentStats };
  }
  if (maxStorageBytes !== null && currentStats.storageBytes + fileSize > maxStorageBytes) {
    return { allowed: false, reason: `Storage limit reached`, stats: currentStats };
  }

  // Row doesn't exist yet — create it, then RE-RUN the same conditional
  // increment. Phase 2.11: an unconditional `SET upload_count = 1` here raced a
  // concurrent first upload and overwrote its increment (lost update →
  // under-counted uploads/storage, i.e. quota could be bypassed).
  await ensureUserStatsRow(userId);
  const retry = await prisma.userStats.updateMany({ where, data });
  if (retry.count === 0) {
    const racedStats = await getUserStats(userId);
    if (maxUploads !== null && racedStats.uploadCount >= maxUploads) {
      return { allowed: false, reason: `Upload limit reached (${maxUploads} files)`, stats: racedStats };
    }
    if (maxStorageBytes !== null && racedStats.storageBytes + fileSize > maxStorageBytes) {
      return { allowed: false, reason: `Storage limit reached`, stats: racedStats };
    }
    return { allowed: false, reason: `Storage limit reached`, stats: racedStats };
  }
  return { allowed: true, stats: await getUserStats(userId) };
}

export async function atomicRevertUploadCount(userId: string, fileSize: number): Promise<void> {
  await ensureMigrated();
  // GREATEST clamp — the Postgres equivalent of SQLite's MAX(0, …).
  await getPrisma().$executeRaw`
    UPDATE user_stats
    SET upload_count = GREATEST(0, upload_count - 1),
        storage_bytes = GREATEST(0, storage_bytes - ${BigInt(Math.trunc(fileSize))})
    WHERE user_id = ${userId}`;
}

// Jobs stuck in a non-terminal state longer than this are abandoned clients
// (cancelled, crashed, or failed exports that never reported back) — not
// running exports. Bounded far above any legitimate single export so normal
// flows never trip the concurrency guard because of stale rows.
export const STUCK_JOB_CUTOFF_MS = 6 * 60 * 60 * 1000;

export async function getActiveExportJobCount(userId: string): Promise<number> {
  await ensureMigrated();
  const cutoff = new Date(Date.now() - STUCK_JOB_CUTOFF_MS);
  return getPrisma().exportJob.count({
    where: {
      userId,
      status: { in: ['pending', 'encoding', 'uploading'] },
      createdAt: { gt: cutoff },
    },
  });
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export async function createExport(record: Omit<ExportRecord, 'id' | 'createdAt'>): Promise<ExportRecord> {
  await ensureMigrated();
  const id = `export-${crypto.randomUUID()}`;
  const now = new Date();
  const row = await getPrisma().export.create({
    data: {
      id,
      userId: record.userId,
      r2Key: record.r2Key,
      platform: record.platform,
      outputWidth: record.outputWidth,
      outputHeight: record.outputHeight,
      fileSize: BigInt(Math.trunc(record.fileSize)),
      mimeType: record.mimeType,
      status: record.status,
      createdAt: now,
      jobId: record.jobId || null,
    },
  });
  return mapExport(row);
}

export type FinalizeExportResult =
  | { kind: 'completed'; export: ExportRecord }
  | { kind: 'claim_lost' };

/**
 * Atomically finalizes an export job: flips the job to `completed` under the
 * server-owned finalization lease, then writes the `exports` row — both in one
 * transaction, so the export row exists if and only if the job reached
 * `completed`. Replaces the former two-statement libSQL `batch`.
 *
 * The conditional `updateMany` is the claim: two concurrent completions (or a
 * retried request) yield exactly one winner; every other caller gets
 * `claim_lost` and writes nothing.
 */
export async function atomicFinalizeExport(input: {
  jobId: string;
  userId: string;
  token: string;
  stagingKey: string;
  finalKey: string;
  platform: string;
  outputWidth: number;
  outputHeight: number;
  fileSize: number;
  now?: Date;
}): Promise<FinalizeExportResult> {
  await ensureMigrated();
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  const exportId = `export-${crypto.randomUUID()}`;
  const bytes = BigInt(Math.trunc(input.fileSize));

  return prisma.$transaction(async (tx) => {
    const updated = await tx.exportJob.updateMany({
      where: {
        id: input.jobId,
        userId: input.userId,
        status: 'finalizing',
        finalizingToken: input.token,
        stagingR2Key: input.stagingKey,
        resultExportId: null,
      },
      data: {
        status: 'completed',
        resultR2Key: input.finalKey,
        resultExportId: exportId,
        resultFileSize: bytes,
        completedAt: now,
        finalizingAt: null,
        finalizingToken: null,
      },
    });
    if (updated.count !== 1) return { kind: 'claim_lost' } as const;

    const row = await tx.export.create({
      data: {
        id: exportId,
        userId: input.userId,
        r2Key: input.finalKey,
        platform: input.platform,
        outputWidth: input.outputWidth,
        outputHeight: input.outputHeight,
        fileSize: bytes,
        mimeType: 'video/mp4',
        status: 'completed',
        createdAt: now,
        jobId: input.jobId,
      },
    });
    return { kind: 'completed', export: mapExport(row) } as const;
  });
}

export async function findExportById(exportId: string): Promise<ExportRecord | undefined> {
  await ensureMigrated();
  const row = await getPrisma().export.findUnique({ where: { id: exportId } });
  return row ? mapExport(row) : undefined;
}

export async function findExportByIdAndUser(exportId: string, userId: string): Promise<ExportRecord | undefined> {
  await ensureMigrated();
  const row = await getPrisma().export.findFirst({ where: { id: exportId, userId } });
  return row ? mapExport(row) : undefined;
}

/** Every export r2_key owned by a user. Used by account deletion to purge R2. */
export async function listUserExportR2Keys(userId: string): Promise<string[]> {
  await ensureMigrated();
  const rows = await getPrisma().export.findMany({
    where: { userId },
    select: { r2Key: true },
  });
  return rows.map((r) => r.r2Key);
}

/** The user's export list, newest first. Used by GET /api/exports. */
export async function listUserExports(userId: string, take = 100): Promise<ExportRecord[]> {
  await ensureMigrated();
  const limit = Number.isFinite(take) && take > 0 ? Math.trunc(take) : 100;
  const rows = await getPrisma().export.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(mapExport);
}

export async function deleteExportByIdAndUser(exportId: string, userId: string): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().export.deleteMany({ where: { id: exportId, userId } });
  return result.count > 0;
}

/** Clamps a storage-byte decrement at zero, mirroring the old MAX(0, …) update. */
export async function decrementStorageBytes(userId: string, bytes: number): Promise<void> {
  await ensureMigrated();
  await getPrisma().$executeRaw`
    UPDATE user_stats
    SET storage_bytes = GREATEST(0, storage_bytes - ${BigInt(Math.trunc(bytes))})
    WHERE user_id = ${userId}`;
}

export async function atomicIncrementDownloadCount(userId: string, maxDownloads: number): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().userStats.updateMany({
    where: { userId, downloadCount: { lt: maxDownloads } },
    data: { downloadCount: { increment: 1 } },
  });
  return result.count > 0;
}

export async function ensureUserStatsRow(userId: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().userStats.createMany({
    data: [{ userId }],
    skipDuplicates: true,
  });
}

// ---------------------------------------------------------------------------
// Monthly export quota
// ---------------------------------------------------------------------------

export function getMonthStartIso(now = new Date()): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return start.toISOString();
}

export function getCurrentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export async function getMonthlyExportCount(userId: string, now = new Date()): Promise<number> {
  await ensureMigrated();
  const prisma = getPrisma();
  const period = getCurrentPeriod(now);
  // Prefer atomic counter table if populated
  const counter = await prisma.monthlyExportCount.findFirst({
    where: { userId, period },
    select: { count: true },
  });
  if (counter) return counter.count;
  // Fallback to timestamp scan for historical data before counter table
  const monthStart = new Date(getMonthStartIso(now));
  return prisma.export.count({ where: { userId, createdAt: { gte: monthStart } } });
}

export async function atomicTryConsumeMonthlyExport(userId: string, limit: number, now = new Date()): Promise<{ allowed: boolean; count: number }> {
  await ensureMigrated();
  const prisma = getPrisma();
  const period = getCurrentPeriod(now);
  // Ensure row exists (0 count) — ignore if already exists
  await prisma.monthlyExportCount.createMany({
    data: [{ userId, period }],
    skipDuplicates: true,
  });
  // Atomic increment only if count < limit
  const updateResult = await prisma.monthlyExportCount.updateMany({
    where: { userId, period, count: { lt: limit } },
    data: { count: { increment: 1 } },
  });
  const row = await prisma.monthlyExportCount.findFirst({
    where: { userId, period },
    select: { count: true },
  });
  return { allowed: updateResult.count > 0, count: row?.count ?? 0 };
}

export async function atomicRevertMonthlyExport(userId: string, now = new Date()): Promise<void> {
  await ensureMigrated();
  const period = getCurrentPeriod(now);
  await getPrisma().$executeRaw`
    UPDATE monthly_export_counts
    SET count = GREATEST(0, count - 1)
    WHERE user_id = ${userId} AND period = ${period}`;
}

// ---------------------------------------------------------------------------
// Daily recording ledger (BUS-001). Same atomic pattern as the monthly counter:
// create the day row, then a single conditional UPDATE. Concurrent requests
// cannot overspend the budget; failures revert.
// ---------------------------------------------------------------------------

export function getCurrentDay(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

export async function getDailyRecordedSeconds(userId: string, now = new Date()): Promise<number> {
  await ensureMigrated();
  const day = getCurrentDay(now);
  const row = await getPrisma().dailyRecordingSecond.findFirst({
    where: { userId, day },
    select: { seconds: true },
  });
  return row?.seconds ?? 0;
}

export async function atomicTryConsumeRecordingSeconds(
  userId: string,
  secondsToCharge: number,
  limit: number,
  now = new Date(),
): Promise<{ allowed: boolean; seconds: number }> {
  await ensureMigrated();
  const prisma = getPrisma();
  const day = getCurrentDay(now);
  const charge = Number.isFinite(secondsToCharge) && secondsToCharge > 0 ? secondsToCharge : 0;
  await prisma.dailyRecordingSecond.createMany({
    data: [{ userId, day }],
    skipDuplicates: true,
  });
  const updateResult = await prisma.dailyRecordingSecond.updateMany({
    where: { userId, day, seconds: { lte: limit - charge } },
    data: { seconds: { increment: charge } },
  });
  const allowed = updateResult.count > 0;
  return { allowed, seconds: await getDailyRecordedSeconds(userId, now) };
}

export async function atomicRevertRecordingSeconds(
  userId: string,
  secondsToRevert: number,
  now = new Date(),
): Promise<void> {
  await ensureMigrated();
  const day = getCurrentDay(now);
  const revert = Number.isFinite(secondsToRevert) && secondsToRevert > 0 ? secondsToRevert : 0;
  await getPrisma().$executeRaw`
    UPDATE daily_recording_seconds
    SET seconds = GREATEST(0, seconds - ${revert})
    WHERE user_id = ${userId} AND day = ${day}`;
}

// ---------------------------------------------------------------------------
// Export jobs
// ---------------------------------------------------------------------------

export async function createExportJob(
  userId: string,
  configJson: string,
): Promise<ExportJobRecord> {
  await ensureMigrated();
  const id = `ej-${crypto.randomUUID()}`;
  const now = new Date();
  const row = await getPrisma().exportJob.create({
    data: {
      id,
      userId,
      configJson,
      status: 'pending',
      progress: 0,
      retryCount: 0,
      createdAt: now,
    },
  });
  return mapExportJob(row);
}

export function isValidExportJobTransition(fromStatus: ExportJobStatus, toStatus: ExportJobStatus): boolean {
  if (fromStatus === toStatus) return true;
  if (fromStatus === 'completed' || fromStatus === 'failed') return false;

  // `pending`/`encoding` -> `completed` is intentional: the client encodes
  // locally, so a job may be completed without ever reporting `uploading`
  // (presigned PUT + /api/exports/complete attach the R2 key at the end).
  const allowed: Record<Exclude<ExportJobStatus, 'completed' | 'failed'>, ExportJobStatus[]> = {
    pending: ['encoding', 'uploading', 'finalizing', 'completed', 'failed'],
    encoding: ['encoding', 'uploading', 'finalizing', 'completed', 'failed'],
    uploading: ['uploading', 'finalizing', 'completed', 'failed'],
    finalizing: [],
  };

  return allowed[fromStatus]?.includes(toStatus) ?? false;
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
  userId?: string,
): Promise<boolean> {
  await ensureMigrated();
  const prisma = getPrisma();

  const current = await prisma.exportJob.findFirst({
    where: userId ? { id: jobId, userId } : { id: jobId },
    select: { status: true, startedAt: true },
  });
  if (!current) return false;
  const currentStatus = current.status as ExportJobStatus;

  if (status !== currentStatus && !isValidExportJobTransition(currentStatus, status)) {
    return false;
  }

  const data: Prisma.ExportJobUpdateManyMutationInput = { status };

  if (status === 'encoding' || status === 'uploading') {
    // COALESCE(started_at, now()): never overwrite an existing start time.
    if (current.startedAt === null) data.startedAt = new Date();
  }
  if (status !== 'finalizing') {
    data.finalizingAt = null;
    data.finalizingToken = null;
  }
  if (status === 'completed' || status === 'failed') {
    data.completedAt = new Date();
  }
  if (patch.progress !== undefined) data.progress = patch.progress;
  if (patch.resultR2Key !== undefined) data.resultR2Key = patch.resultR2Key;
  if (patch.resultExportId !== undefined) data.resultExportId = patch.resultExportId;
  if (patch.resultFileSize !== undefined) data.resultFileSize = BigInt(Math.trunc(patch.resultFileSize));
  if (patch.errorMessage !== undefined) data.errorMessage = patch.errorMessage;

  const result = await prisma.exportJob.updateMany({
    where: userId ? { id: jobId, userId } : { id: jobId },
    data,
  });
  return result.count > 0;
}

const EXPORT_FINALIZATION_LEASE_MS = 30 * 60 * 1000;

export async function claimExportJobFinalization(
  jobId: string,
  userId: string,
  stagingKey: string,
  token: string,
  now = new Date(),
): Promise<boolean> {
  await ensureMigrated();
  const cutoff = new Date(now.getTime() - EXPORT_FINALIZATION_LEASE_MS);
  const result = await getPrisma().exportJob.updateMany({
    where: {
      id: jobId,
      userId,
      stagingR2Key: stagingKey,
      resultExportId: null,
      OR: [
        { status: { in: ['pending', 'encoding', 'uploading'] } },
        { status: 'finalizing', finalizingAt: { lte: cutoff } },
      ],
    },
    data: { status: 'finalizing', finalizingAt: now, finalizingToken: token },
  });
  return result.count === 1;
}

export async function releaseExportJobFinalization(jobId: string, userId: string, token: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().exportJob.updateMany({
    where: { id: jobId, userId, status: 'finalizing', finalizingToken: token },
    data: { status: 'uploading', finalizingAt: null, finalizingToken: null },
  });
}

export async function setExportJobStagingKey(jobId: string, userId: string, stagingKey: string): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().exportJob.updateMany({
    where: {
      id: jobId,
      userId,
      status: { in: ['pending', 'encoding', 'uploading'] },
      resultExportId: null,
    },
    data: { stagingR2Key: stagingKey },
  });
  return result.count === 1;
}

export async function findExportJobById(jobId: string): Promise<ExportJobRecord | undefined> {
  await ensureMigrated();
  const row = await getPrisma().exportJob.findUnique({ where: { id: jobId } });
  return row ? mapExportJob(row) : undefined;
}

export async function findExportJobByIdAndUser(
  jobId: string,
  userId: string,
): Promise<ExportJobRecord | undefined> {
  await ensureMigrated();
  const row = await getPrisma().exportJob.findFirst({ where: { id: jobId, userId } });
  return row ? mapExportJob(row) : undefined;
}

/**
 * Retention sweep for export jobs.
 *
 * Only abandoned work is eligible. A `completed` job's `result_r2_key` IS the
 * R2 object behind a Creator library item, so sweeping it deleted a file the
 * customer had already exported.
 *
 * The two halves of the sweep have different guarantees and they must not be
 * conflated:
 *
 * - `getOldExportJobs` decides which *objects* may be deleted in R2, and
 *   excludes any key an `exports` row still references. An export whose job
 *   never advanced past `uploading` (the completion route writes the export row
 *   before stamping the job) is therefore never a delete target.
 * - `deleteOldExportJobs` deletes *rows*. It does not need the same exclusion,
 *   because `exports.job_id` is declared `ON DELETE SET NULL`: the export and
 *   its R2 object survive intact while the stale job row is reclaimed.
 */
const CLEANABLE_EXPORT_JOB_STATUSES = ['pending', 'encoding', 'uploading', 'failed'] as const;

export async function deleteOldExportJobs(maxAgeMs: number): Promise<number> {
  await ensureMigrated();
  const cutoff = new Date(Date.now() - maxAgeMs);
  const result = await getPrisma().exportJob.deleteMany({
    where: { createdAt: { lt: cutoff }, status: { in: [...CLEANABLE_EXPORT_JOB_STATUSES] } },
  });
  return result.count;
}

export async function getOldExportJobs(maxAgeMs: number): Promise<{ r2Key: string }[]> {
  await ensureMigrated();
  const cutoff = new Date(Date.now() - maxAgeMs);
  // The correlated NOT IN against `exports.r2_key` has no concise Prisma Client
  // equivalent; raw SQL with a bound parameter keeps the exact semantics.
  const rows = await getPrisma().$queryRaw<{ result_r2_key: string }[]>`
    SELECT result_r2_key FROM export_jobs
    WHERE created_at < ${cutoff}
      AND result_r2_key IS NOT NULL
      AND status IN ('pending', 'encoding', 'uploading', 'failed')
      AND result_r2_key NOT IN (SELECT r2_key FROM exports)`;
  return rows.map((row) => ({ r2Key: row.result_r2_key }));
}

// ---------------------------------------------------------------------------
// Webhook / notification claims
// ---------------------------------------------------------------------------

/**
 * Whether a claim row exists for an order.
 *
 * This is NOT evidence that the order was granted anything. A claim with no
 * `pending_orders.fulfilled_at` marker is the crash case W8 had to close. Use
 * `findPendingOrderClaim` when the question is "was this fulfilled?", and
 * `settleFulfilledOrder` to fulfil.
 */
export async function isWebhookProcessed(orderId: string): Promise<boolean> {
  await ensureMigrated();
  const count = await getPrisma().processedWebhook.count({ where: { orderId } });
  return count > 0;
}

export async function markWebhookProcessed(orderId: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().processedWebhook.createMany({
    data: [{ orderId }],
    skipDuplicates: true,
  });
}

/**
 * Inserts a bare fulfilment claim. Returns true only for the caller that won.
 *
 * Production fulfilment no longer uses this two-step (claim, then write): the
 * claim alone can commit without a grant. `settleFulfilledOrder` is the
 * fulfilment primitive. This remains for legacy repair, fixtures and the
 * claim-arbitration tests — an order claimed through it has no marker and will
 * be treated as `claim_without_grant` until a settlement exists.
 */
export async function tryClaimWebhookOrder(orderId: string): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().processedWebhook.createMany({
    data: [{ orderId }],
    skipDuplicates: true,
  });
  return result.count > 0;
}

export async function releaseWebhookClaim(orderId: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().processedWebhook.deleteMany({ where: { orderId } });
}

/**
 * Claims the right to send one kind of post-payment notification for an order.
 *
 * Separate from the webhook claim on purpose. `processed_webhooks` answers
 * "has this order been fulfilled?", which is a question about the plan write —
 * and only the first caller to ask it may write. Whether the receipt has been
 * emailed is a different question with a different lifetime, so gating it on the
 * same row silently dropped the receipt whenever the return trip fulfilled the
 * order first and the real webhook arrived second.
 *
 * Returns true only for the caller that won, so concurrent duplicates send one
 * email between them rather than five.
 */
export async function tryClaimOrderNotification(orderId: string, kind: string): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().orderNotification.createMany({
    data: [{ orderId, kind }],
    skipDuplicates: true,
  });
  return result.count > 0;
}

/**
 * Releases a notification claim so a later event can retry the send. Used only
 * when delivery itself failed — a permanently-unsent receipt must not be
 * retried forever, but a transient transport failure should be recoverable.
 */
export async function releaseOrderNotification(orderId: string, kind: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().orderNotification.deleteMany({ where: { orderId, kind } });
}

// ---------------------------------------------------------------------------
// Account lockout
// ---------------------------------------------------------------------------

const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export async function recordFailedLogin(email: string): Promise<{ locked: boolean; attempts: number }> {
  await ensureMigrated();
  const prisma = getPrisma();
  const now = new Date();
  const lockMinutes = Math.round(LOCKOUT_DURATION_MS / 60000);
  // The CASE arms on the pre-increment count and stamps `locked_until` with a
  // server-side interval, so the lock is measured against the database clock and
  // racing logins cannot unlock a row early.
  await prisma.$executeRaw`
    UPDATE users SET
      failed_login_attempts = COALESCE(failed_login_attempts, 0) + 1,
      locked_until = CASE
        WHEN COALESCE(failed_login_attempts, 0) + 1 >= ${LOCKOUT_THRESHOLD}
          THEN now() + make_interval(mins => ${lockMinutes})
        ELSE locked_until
      END
    WHERE email = ${email.toLowerCase()} AND (locked_until IS NULL OR locked_until < now())`;
  const row = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: { failedLoginAttempts: true, lockedUntil: true },
  });
  if (!row) return { locked: false, attempts: 0 };
  const attempts = row.failedLoginAttempts ?? 0;
  return { locked: row.lockedUntil !== null && row.lockedUntil > now, attempts };
}

export async function isAccountLocked(email: string): Promise<boolean> {
  await ensureMigrated();
  const row = await getPrisma().user.findUnique({
    where: { email: email.toLowerCase() },
    select: { lockedUntil: true },
  });
  if (!row || !row.lockedUntil) return false;
  return row.lockedUntil > new Date();
}

export async function resetFailedLogins(email: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().user.updateMany({
    where: { email: email.toLowerCase() },
    data: { failedLoginAttempts: 0, lockedUntil: null },
  });
}

// ---------------------------------------------------------------------------
// Pending orders for payment verification
// ---------------------------------------------------------------------------

export async function createPendingOrder(order: {
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
}): Promise<void> {
  await ensureMigrated();
  const prisma = getPrisma();
  // `ON CONFLICT (order_id) DO NOTHING` preserves idempotent re-creation while
  // still surfacing a genuine foreign-key / NOT NULL violation (unlike the old
  // `INSERT OR IGNORE`, which swallowed every constraint error).
  try {
    await prisma.pendingOrder.createMany({
      data: [
        {
          orderId: order.orderId,
          userId: order.userId,
          plan: order.plan,
          amount: new Prisma.Decimal(order.amount),
          currency: order.currency,
        },
      ],
      skipDuplicates: true,
    });
  } catch (e) {
    // Preserve the stable `pending_order_not_persisted` contract callers and
    // logs rely on, while keeping the underlying constraint reason.
    throw new Error(
      `pending_order_not_persisted: order ${order.orderId} was rejected by a constraint (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }

  // The old `INSERT OR IGNORE` discarded ANY constraint violation silently, so a
  // call that returned without throwing was not proof a row existed. Both the
  // webhook and the return-trip verify key off this row: if it silently failed to
  // write, a *paid* order becomes a permanent 404 with no plan activation. Verify
  // the write instead of trusting the conflict clause.
  const persisted = await prisma.pendingOrder.findUnique({
    where: { orderId: order.orderId },
    select: { orderId: true },
  });
  if (!persisted) {
    throw new Error(
      `pending_order_not_persisted: order ${order.orderId} was rejected by a constraint and silently ignored`,
    );
  }
}

// ---------------------------------------------------------------------------
// Pending-order lifecycle (W2)
//
// The state machine itself lives in the reconciler; this section only provides
// the atomic primitives it needs. Writes are guarded by the status they expect,
// so a stale reader can never overwrite a newer decision (for example turning a
// freshly-`fulfilled` order back into `open`).
// ---------------------------------------------------------------------------

/**
 * The user already has a live checkout. Raised by `reservePendingOrder` when
 * the partial unique index `pending_orders_one_live_per_user` rejects the
 * insert — the database, not an application check, is the mutex.
 */
export class PendingOrderConflictError extends Error {
  readonly code = 'pending_order_live_exists';
  constructor() {
    super('pending_order_live_exists');
    this.name = 'PendingOrderConflictError';
  }
}

/** PostgreSQL SQLSTATE from a Prisma error, whichever wrapper it arrives in. */
function pgErrorCode(error: unknown): string | undefined {
  const wrapped = error as { code?: unknown; meta?: { code?: unknown } } | null;
  if (typeof wrapped?.meta?.code === 'string') return wrapped.meta.code;
  if (typeof wrapped?.code === 'string') return wrapped.code;
  return undefined;
}

const UNIQUE_VIOLATION = '23505';

export interface PendingOrderLifecycleRow {
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
  createdAt: string;
  status: string;
  closedAt: string | null;
  closeReason: string | null;
  heldAt: string | null;
  holdReason: string | null;
  fulfilledAt: string | null;
  lastCheckedAt: string | null;
  probeCount: number;
  firstProbedAt: string | null;
  terminationSentAt: string | null;
}

type PendingOrderRecord = Prisma.PendingOrderGetPayload<Record<string, never>>;

function mapLifecycleRow(row: PendingOrderRecord): PendingOrderLifecycleRow {
  return {
    orderId: row.orderId,
    userId: row.userId,
    plan: row.plan,
    amount: Number(row.amount),
    currency: row.currency,
    createdAt: row.createdAt.toISOString(),
    status: row.status,
    closedAt: toIso(row.closedAt),
    closeReason: row.closeReason,
    heldAt: toIso(row.heldAt),
    holdReason: row.holdReason,
    fulfilledAt: toIso(row.fulfilledAt),
    lastCheckedAt: toIso(row.lastCheckedAt),
    probeCount: row.probeCount,
    firstProbedAt: toIso(row.firstProbedAt),
    terminationSentAt: toIso(row.terminationSentAt),
  };
}

/**
 * Reserves the order id in the database *before* anything is sent to Cashfree.
 *
 * The insert is the concurrency gate: a second live row for the same user is
 * rejected by the partial unique index, which is reported as
 * `PendingOrderConflictError` rather than as a storage failure. Leaving the row
 * in `creating` before the gateway call is what makes a crash recoverable —
 * the order id is known, so its existence can be probed instead of guessed.
 */
export async function reservePendingOrder(order: {
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
}): Promise<void> {
  await ensureMigrated();
  try {
    await getPrisma().$executeRaw`
      INSERT INTO pending_orders (order_id, user_id, plan, amount, currency, status)
      VALUES (${order.orderId}, ${order.userId}, ${order.plan}, ${order.amount}::numeric, ${order.currency}, 'creating')`;
  } catch (e) {
    if (pgErrorCode(e) === UNIQUE_VIOLATION) throw new PendingOrderConflictError();
    throw new Error(
      `pending_order_not_persisted: order ${order.orderId} was rejected by a constraint (${
        e instanceof Error ? e.message : String(e)
      })`,
    );
  }
}

/** `creating` → `open`, once the gateway confirmed the order exists. */
export async function markPendingOrderOpen(orderId: string): Promise<boolean> {
  await ensureMigrated();
  const changed = await getPrisma().$executeRaw`
    UPDATE pending_orders
    SET status = 'open', last_checked_at = now()
    WHERE order_id = ${orderId} AND status = 'creating'`;
  return changed > 0;
}

/**
 * Records that Cashfree accepted a kill request but has not confirmed it.
 * `termination_requested_at` is stamped once and kept, so the stuck-termination
 * alert can measure how long the state has really lasted.
 */
export async function markPendingOrderTerminationRequested(orderId: string): Promise<boolean> {
  await ensureMigrated();
  const changed = await getPrisma().$executeRaw`
    UPDATE pending_orders
    SET status = 'termination_requested',
        termination_requested_at = COALESCE(termination_requested_at, now()),
        last_checked_at = now()
    WHERE order_id = ${orderId} AND status IN ('open', 'creating', 'termination_requested')`;
  return changed > 0;
}

/**
 * Repairs the lifecycle status of an already-fulfilled order. TOTAL: never
 * throws.
 *
 * Fulfilment itself writes the status inside `settleFulfilledOrder`'s
 * transaction; this is only for rows whose marker exists but whose status was
 * left behind by an older path (the reconciler's self-heal and the operator
 * release). It does not grant anything.
 */
export async function markPendingOrderFulfilled(orderId: string): Promise<boolean> {
  try {
    await ensureMigrated();
    const changed = await getPrisma().$executeRaw`
      UPDATE pending_orders
      SET status = 'fulfilled',
          fulfilled_at = COALESCE(fulfilled_at, now()),
          closed_at = COALESCE(closed_at, now()),
          close_reason = COALESCE(close_reason, 'paid_fulfilled'),
          last_checked_at = now()
      WHERE order_id = ${orderId} AND status <> 'fulfilled'`;
    return changed > 0;
  } catch (e) {
    console.warn(
      `[pending-order] fulfilled status write failed for ${orderId}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/**
 * Parks an order for operator review. The hold survives a second hold (the
 * reason is refreshed): a `held_review` row is never released by a timeout, only
 * by a confirmed settlement or an explicit operator release.
 */
export async function markPendingOrderHeld(
  orderId: string,
  reason: string,
): Promise<boolean> {
  await ensureMigrated();
  const changed = await getPrisma().$executeRaw`
    UPDATE pending_orders
    SET status = 'held_review',
        held_at = COALESCE(held_at, now()),
        hold_reason = ${reason},
        closed_at = COALESCE(closed_at, now()),
        close_reason = COALESCE(close_reason, 'held_unapplied'),
        last_checked_at = now()
    WHERE order_id = ${orderId} AND status <> 'fulfilled'`;
  return changed > 0;
}

/**
 * Raised inside the settlement transaction to force a rollback. A claim that
 * committed without its grant and per-order marker is the W8 defect, so every
 * validation failure after the claim insert aborts the whole transaction
 * instead of returning a value that would let it commit.
 */
class SettlementAbort extends Error {
  constructor(
    readonly code: 'order_missing' | 'order_owner_mismatch' | 'user_missing' | 'marker_write_missing',
  ) {
    super(code);
    this.name = 'SettlementAbort';
  }
}

export type SettleFulfilledOrderResult =
  | { state: 'fulfilled'; expiresAt: string; fulfilledAt: string }
  | { state: 'already_fulfilled'; expiresAt: string | null; fulfilledAt: string }
  | { state: 'claim_without_grant' }
  | {
      state:
        | 'order_missing'
        | 'order_owner_mismatch'
        | 'user_missing'
        | 'marker_write_missing';
    };

/**
 * Settles one paid order: claim, grant and per-order marker in ONE transaction.
 *
 * Why one transaction is the whole point: the previous pipeline committed the
 * claim first and then wrote the plan. A throw between them (a serverless
 * freeze, a connection reset, a failing grant) left a committed claim with no
 * entitlement — and `verify` treated any claim as proof of payment, so the
 * buyer was told "activated" for a plan nobody was granted. Here the claim row
 * (`processed_webhooks`) is inserted as the pivot; the plan write and the
 * `pending_orders` fulfilment marker happen in the same transaction. COMMIT is
 * atomic across all three, so a visible claim implies a visible grant and
 * marker, and an aborted attempt leaves nothing behind.
 *
 * Concurrency: the claim primary key is the mutex. A second delivery's INSERT
 * blocks on the uncommitted row and, once the winner commits, `ON CONFLICT DO
 * NOTHING` returns no row — the loser then reads the winner's committed marker
 * and reports `already_fulfilled`. If the winner aborts, the loser's insert
 * succeeds and it performs the grant itself. Exactly one term is ever granted.
 *
 * `already_fulfilled` is read from `fulfilled_at`, which is exact per-order
 * evidence and is written only by this transaction. It replaces the old
 * `plan_expires_at > processed_at` heuristic, which misread a renewal whose
 * earlier term already extended the account: the expiry is later than the new
 * claim even when that claim's own grant never landed.
 *
 * `claim_without_grant` (a claim with no marker) is the legacy/racing case. It
 * is never fulfilled here: the caller must treat it as pending review. New
 * settlements cannot produce it, because the claim and the marker commit
 * together.
 */
export async function settleFulfilledOrder(params: {
  orderId: string;
  userId: string;
  plan: PlanType;
  interval: '1 month' | '1 year';
}): Promise<SettleFulfilledOrderResult> {
  await ensureMigrated();
  try {
    return await getPrisma().$transaction(
      async (tx): Promise<SettleFulfilledOrderResult> => {
        const claimRows = await tx.$queryRaw<{ order_id: string }[]>`
          INSERT INTO processed_webhooks (order_id)
          VALUES (${params.orderId})
          ON CONFLICT (order_id) DO NOTHING
          RETURNING order_id`;

        if (claimRows.length === 0) {
          // Another path owns the claim. Its transaction either committed the
          // marker and grant together, or it aborted (in which case our insert
          // would have succeeded). So a visible claim with no marker is a
          // pre-fix dangling row, not an in-flight winner.
          const existing = await tx.$queryRaw<
            { user_id: string; fulfilled_at: Date | null; plan_expires_at: Date | null }[]
          >`
            SELECT p.user_id, p.fulfilled_at, u.plan_expires_at
            FROM pending_orders p
            LEFT JOIN users u ON u.id = p.user_id
            WHERE p.order_id = ${params.orderId}`;
          const row = existing[0];
          if (!row) return { state: 'order_missing' };
          if (row.user_id !== params.userId) return { state: 'order_owner_mismatch' };
          if (!row.fulfilled_at) return { state: 'claim_without_grant' };
          return {
            state: 'already_fulfilled',
            expiresAt: toIso(row.plan_expires_at),
            fulfilledAt: row.fulfilled_at.toISOString(),
          };
        }

        // Claim won. Lock the order row so the marker decision is made against
        // the same row the grant is about to affect.
        const locked = await tx.$queryRaw<{ user_id: string; fulfilled_at: Date | null }[]>`
          SELECT user_id, fulfilled_at
          FROM pending_orders
          WHERE order_id = ${params.orderId}
          FOR UPDATE`;
        const orderRow = locked[0];
        if (!orderRow) throw new SettlementAbort('order_missing');
        if (orderRow.user_id !== params.userId) throw new SettlementAbort('order_owner_mismatch');

        if (orderRow.fulfilled_at) {
          // The order was granted earlier without a claim row (an old path
          // released it after the write). Committing the claim repairs the
          // record; granting again would be a second term for one payment.
          const owner = await tx.$queryRaw<{ plan_expires_at: Date | null }[]>`
            SELECT plan_expires_at FROM users WHERE id = ${params.userId}`;
          return {
            state: 'already_fulfilled',
            expiresAt: toIso(owner[0]?.plan_expires_at ?? null),
            fulfilledAt: orderRow.fulfilled_at.toISOString(),
          };
        }

        const granted = await tx.$queryRaw<{ plan_expires_at: Date }[]>(
          planTermExtensionSql(params.userId, params.plan, params.interval),
        );
        if (!granted[0]) throw new SettlementAbort('user_missing');

        const marked = await tx.$queryRaw<{ fulfilled_at: Date }[]>`
          UPDATE pending_orders
          SET status = 'fulfilled',
              fulfilled_at = now(),
              closed_at = COALESCE(closed_at, now()),
              close_reason = COALESCE(close_reason, 'paid_fulfilled'),
              last_checked_at = now()
          WHERE order_id = ${params.orderId}
          RETURNING fulfilled_at`;
        if (!marked[0]) throw new SettlementAbort('marker_write_missing');

        return {
          state: 'fulfilled',
          expiresAt: granted[0].plan_expires_at.toISOString(),
          fulfilledAt: marked[0].fulfilled_at.toISOString(),
        };
      },
      {
        // READ COMMITTED is what makes a blocked ON CONFLICT/UPDATE re-read the
        // winner's committed row; the unique claim key and the row lock are the
        // serialization, not the isolation level.
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        maxWait: 5_000,
        timeout: 10_000,
      },
    );
  } catch (error) {
    if (error instanceof SettlementAbort) return { state: error.code };
    throw error;
  }
}

/** Closes an order with the reason the gateway (or an operator) established. */
export async function closePendingOrder(
  orderId: string,
  reason: string,
  from?: readonly string[],
): Promise<boolean> {
  await ensureMigrated();
  const statusFilter = from && from.length > 0
    ? Prisma.sql`AND status IN (${Prisma.join(from.map((status) => Prisma.sql`${status}`))})`
    : Prisma.empty;
  const changed = await getPrisma().$executeRaw`
    UPDATE pending_orders
    SET status = 'closed',
        closed_at = COALESCE(closed_at, now()),
        close_reason = ${reason},
        last_checked_at = now()
    WHERE order_id = ${orderId} AND status NOT IN ('fulfilled', 'closed')
    ${statusFilter}`;
  return changed > 0;
}

/**
 * Records one gateway probe of a reserved order.
 *
 * `not_found` advances the orphan counter and stamps the first probe;
 * `found` clears both (the order exists, so it can never be an orphan);
 * `uncertain` only notes the attempt, because uncertainty must not move a
 * reservation one step closer to release.
 */
export async function recordPendingOrderProbe(
  orderId: string,
  outcome: 'found' | 'not_found' | 'uncertain',
): Promise<{ probeCount: number; firstProbedAt: Date | null } | null> {
  await ensureMigrated();
  const rows = await getPrisma().$queryRaw<{ probe_count: number; first_probed_at: Date | null }[]>`
    UPDATE pending_orders
    SET probe_count = CASE
          WHEN ${outcome} = 'not_found' THEN probe_count + 1
          WHEN ${outcome} = 'found' THEN 0
          ELSE probe_count
        END,
        first_probed_at = CASE
          WHEN ${outcome} = 'not_found' THEN COALESCE(first_probed_at, now())
          WHEN ${outcome} = 'found' THEN NULL
          ELSE first_probed_at
        END,
        last_checked_at = now()
    WHERE order_id = ${orderId} AND status IN ('creating', 'unverified')
    RETURNING probe_count, first_probed_at`;
  const row = rows[0];
  return row ? { probeCount: row.probe_count, firstProbedAt: row.first_probed_at } : null;
}

/** Notes that this order was examined but its state did not change. */
export async function touchPendingOrder(orderId: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().$executeRaw`
    UPDATE pending_orders SET last_checked_at = now() WHERE order_id = ${orderId}`;
}

/** The user's live checkout, if any (the partial unique index allows one). */
export async function findLivePendingOrder(userId: string): Promise<PendingOrderLifecycleRow | null> {
  await ensureMigrated();
  const row = await getPrisma().pendingOrder.findFirst({
    where: { userId, status: { in: ['creating', 'open', 'termination_requested'] } },
    orderBy: { createdAt: 'desc' },
  });
  return row ? mapLifecycleRow(row) : null;
}

/**
 * Every order the reconciler should look at for this user: live checkouts, paid
 * obligations, and historical rows that have never been classified.
 *
 * Least-recently-checked first, so a capped pass over a user with many
 * historical rows moves forward instead of re-examining the same ones forever.
 */
export async function findPendingOrdersForReconcile(
  userId: string,
  limit: number,
): Promise<PendingOrderLifecycleRow[]> {
  await ensureMigrated();
  const rows = await getPrisma().pendingOrder.findMany({
    where: {
      userId,
      status: { in: ['creating', 'open', 'termination_requested', 'held_review', 'unverified'] },
    },
    orderBy: [{ lastCheckedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
    take: limit,
  });
  return rows.map(mapLifecycleRow);
}

export async function findPendingOrderLifecycle(
  orderId: string,
): Promise<PendingOrderLifecycleRow | null> {
  await ensureMigrated();
  const row = await getPrisma().pendingOrder.findUnique({ where: { orderId } });
  return row ? mapLifecycleRow(row) : null;
}

/**
 * Whether an order is claimed, and whether that claim is corroborated by the
 * order's own fulfilment marker.
 *
 * `entitled` means `pending_orders.fulfilled_at` is set — exact per-order
 * evidence, written only by the atomic settlement transaction that also granted
 * the term. It deliberately does NOT infer anything from
 * `plan_expires_at > processed_at`: for a renewal the account's expiry is
 * already later than the new claim because of the term before it, so that
 * comparison marks a crashed renewal as fulfilled. A claim without a marker is
 * a review case, never a granted term.
 */
export async function findPendingOrderClaim(
  orderId: string,
): Promise<{ claimed: boolean; entitled: boolean } | null> {
  await ensureMigrated();
  const rows = await getPrisma().$queryRaw<
    { processed_at: Date | null; fulfilled_at: Date | null }[]
  >`
    SELECT w.processed_at, p.fulfilled_at
    FROM pending_orders p
    LEFT JOIN processed_webhooks w ON w.order_id = p.order_id
    WHERE p.order_id = ${orderId}`;
  const row = rows[0];
  if (!row) return null;
  return {
    claimed: row.processed_at !== null,
    entitled: row.fulfilled_at !== null,
  };
}

export interface PendingOrderOpsRow extends PendingOrderLifecycleRow {
  processedAt: string | null;
  planExpiresAt: string | null;
  /** The user's stored plan, for the "claimed but unentitled" review case. */
  userPlan: string;
}

export async function listPendingOrdersForOps(params: {
  statuses: readonly string[];
  limit: number;
}): Promise<PendingOrderOpsRow[]> {
  await ensureMigrated();
  const statusFilter = Prisma.join(params.statuses.map((status) => Prisma.sql`${status}`));
  const rows = await getPrisma().$queryRaw<{
    order_id: string;
    user_id: string;
    plan: string;
    amount: string;
    currency: string;
    created_at: Date;
    status: string;
    closed_at: Date | null;
    close_reason: string | null;
    held_at: Date | null;
    hold_reason: string | null;
    fulfilled_at: Date | null;
    last_checked_at: Date | null;
    probe_count: number;
    first_probed_at: Date | null;
    termination_requested_at: Date | null;
    processed_at: Date | null;
    plan_expires_at: Date | null;
    user_plan: string;
  }[]>`
    SELECT p.order_id, p.user_id, p.plan, p.amount::text AS amount, p.currency, p.created_at,
           p.status, p.closed_at, p.close_reason, p.held_at, p.hold_reason, p.fulfilled_at,
           p.last_checked_at, p.probe_count, p.first_probed_at, p.termination_requested_at,
           w.processed_at, u.plan_expires_at, u.plan AS user_plan
    FROM pending_orders p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN processed_webhooks w ON w.order_id = p.order_id
    WHERE p.status IN (${statusFilter})
    ORDER BY p.created_at DESC
    LIMIT ${params.limit}`;
  return rows.map((row) => ({
    orderId: row.order_id,
    userId: row.user_id,
    plan: row.plan,
    amount: Number(row.amount),
    currency: row.currency,
    createdAt: row.created_at.toISOString(),
    status: row.status,
    closedAt: toIso(row.closed_at),
    closeReason: row.close_reason,
    heldAt: toIso(row.held_at),
    holdReason: row.hold_reason,
    fulfilledAt: toIso(row.fulfilled_at),
    lastCheckedAt: toIso(row.last_checked_at),
    probeCount: row.probe_count,
    firstProbedAt: toIso(row.first_probed_at),
    terminationSentAt: toIso(row.termination_requested_at),
    processedAt: toIso(row.processed_at),
    planExpiresAt: toIso(row.plan_expires_at),
    userPlan: row.user_plan,
  }));
}

export async function countPendingOrdersByStatus(): Promise<Record<string, number>> {
  await ensureMigrated();
  const groups = await getPrisma().pendingOrder.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  for (const group of groups) counts[group.status] = group._count._all;
  return counts;
}

/**
 * Takes the per-user checkout mutex.
 *
 * Reconciliation reads several rows and may call the gateway for each before
 * anything is reserved, so the unique index alone cannot stop two concurrent
 * checkouts from both classifying the same historical order and then racing to
 * create. This row serializes that whole window. The TTL is the crash
 * protection: a holder that dies releases its lock by timing out, not by a
 * cleanup job.
 */
export async function acquireCheckoutLock(
  userId: string,
  token: string,
  ttlMs: number,
): Promise<boolean> {
  await ensureMigrated();
  const rows = await getPrisma().$queryRaw<{ token: string }[]>`
    INSERT INTO checkout_locks (user_id, token, locked_at)
    VALUES (${userId}, ${token}, now())
    ON CONFLICT (user_id) DO UPDATE
      SET token = EXCLUDED.token, locked_at = now()
      WHERE checkout_locks.locked_at < now() - (${ttlMs}::int * interval '1 millisecond')
    RETURNING token`;
  return rows.length > 0;
}

/** Releases the mutex only if this caller still owns it. */
export async function releaseCheckoutLock(userId: string, token: string): Promise<void> {
  await ensureMigrated();
  await getPrisma().$executeRaw`
    DELETE FROM checkout_locks WHERE user_id = ${userId} AND token = ${token}`;
}

export async function findPendingOrder(orderId: string): Promise<{
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
} | null> {
  await ensureMigrated();
  const row = await getPrisma().pendingOrder.findUnique({ where: { orderId } });
  if (!row) return null;
  return {
    orderId: row.orderId,
    userId: row.userId,
    plan: row.plan,
    amount: Number(row.amount),
    currency: row.currency,
  };
}

// ---------------------------------------------------------------------------
// Account deletion helpers. The route deletes R2 first, then these DB rows, in
// the same order the old raw SQL used.
// ---------------------------------------------------------------------------

export async function deleteUserById(userId: string): Promise<boolean> {
  await ensureMigrated();
  const result = await getPrisma().user.deleteMany({ where: { id: userId } });
  return result.count > 0;
}

/**
 * Deletes the child rows owned by a user before the account row. Each statement
 * is independently guarded, mirroring the old route's per-delete try/catch so a
 * single failure cannot strand the rest of the cleanup.
 */
export async function purgeUserOwnedData(userId: string): Promise<void> {
  await ensureMigrated();
  const prisma = getPrisma();
  const steps: Array<() => Promise<unknown>> = [
    () => prisma.export.deleteMany({ where: { userId } }),
    () => prisma.exportJob.deleteMany({ where: { userId } }),
    () => prisma.monthlyExportCount.deleteMany({ where: { userId } }),
    () => prisma.userStats.deleteMany({ where: { userId } }),
    () => prisma.pendingOrder.deleteMany({ where: { userId } }),
  ];
  for (const step of steps) {
    try {
      await step();
    } catch {
      // Continue — the final users delete cascades whatever remains.
    }
  }
}
