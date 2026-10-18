import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb, getDb } from '@/__tests__/helpers/db';
import { setMigrated } from '@/lib/db/index';

import {
  ensureMigrated,
  createUser,
  createExport,
  createExportJob,
  findExportById,
  findExportByIdAndUser,
  findExportJobByIdAndUser,
  ensureUserStatsRow,
  deleteOldExportJobs,
} from '@/lib/db';

// Database-backed suite: runs only when DATABASE_URL points at a throwaway
// PostgreSQL database; otherwise the cases are reported as skipped.
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

function cleanTestData() {
  resetDb();
  setMigrated(false);
}

describeDb('database constraints (acceptance: Data Integrity)', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  it('enforces foreign keys (PostgreSQL enforces constraints unconditionally)', async () => {
    await ensureMigrated();
    // libSQL left foreign-key enforcement off per connection and needed an
    // explicit `PRAGMA foreign_keys = ON`. PostgreSQL has no such switch: the
    // constraints are always enforced, so the assertion is that they exist.
    const result = await getDb().execute({
      sql: "SELECT COUNT(*) AS cnt FROM pg_constraint WHERE contype = 'f'",
    });
    expect(Number(result.rows[0]?.cnt)).toBeGreaterThan(0);
  });

  it('rejects child rows referencing a nonexistent user', async () => {
    await ensureMigrated();
    await expect(
      createExport({
        userId: 'user-does-not-exist',
        r2Key: 'exports/user-does-not-exist/x.mp4',
        platform: 'youtube-landscape',
        outputWidth: 1280,
        outputHeight: 720,
        fileSize: 100,
        mimeType: 'video/mp4',
        status: 'completed',
        jobId: null,
      }),
    ).rejects.toThrow();
  });

  it('cascades user deletion to exports, jobs and stats', async () => {
    const user = await createUser('cascade@example.com', 'Cascade User', 'hash');
    await ensureUserStatsRow(user.id);
    const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
    await createExport({
      userId: user.id,
      r2Key: `exports/${user.id}/x.mp4`,
      platform: 'youtube-landscape',
      outputWidth: 1280,
      outputHeight: 720,
      fileSize: 100,
      mimeType: 'video/mp4',
      status: 'completed',
      jobId: job.id,
    });

    const db = getDb();
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.id] });

    const remainingExports = await db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM exports WHERE user_id = ?',
      args: [user.id],
    });
    const remainingJobs = await db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM export_jobs WHERE user_id = ?',
      args: [user.id],
    });
    const remainingStats = await db.execute({
      sql: 'SELECT COUNT(*) AS cnt FROM user_stats WHERE user_id = ?',
      args: [user.id],
    });
    expect(Number(remainingExports.rows[0]?.cnt)).toBe(0);
    expect(Number(remainingJobs.rows[0]?.cnt)).toBe(0);
    expect(Number(remainingStats.rows[0]?.cnt)).toBe(0);
  });

  it('ownership scoping: one user cannot read another user export or job', async () => {
    const alice = await createUser('alice@example.com', 'Alice', 'hash');
    const bob = await createUser('bob@example.com', 'Bob', 'hash');
    const exp = await createExport({
      userId: alice.id,
      r2Key: `exports/${alice.id}/a.mp4`,
      platform: 'youtube-landscape',
      outputWidth: 1280,
      outputHeight: 720,
      fileSize: 100,
      mimeType: 'video/mp4',
      status: 'completed',
      jobId: null,
    });
    const job = await createExportJob(alice.id, '{}');

    expect(await findExportByIdAndUser(exp.id, bob.id)).toBeUndefined();
    expect(await findExportJobByIdAndUser(job.id, bob.id)).toBeUndefined();
    expect(await findExportByIdAndUser(exp.id, alice.id)).toBeDefined();
    expect(await findExportJobByIdAndUser(job.id, alice.id)).toBeDefined();
  });

  it('job cleanup nulls exports.job_id instead of deleting the export', async () => {
    const user = await createUser('cleanup@example.com', 'Cleanup', 'hash');
    const job = await createExportJob(user.id, '{}');
    const exp = await createExport({
      userId: user.id,
      r2Key: `exports/${user.id}/c.mp4`,
      platform: 'youtube-landscape',
      outputWidth: 1280,
      outputHeight: 720,
      fileSize: 100,
      mimeType: 'video/mp4',
      status: 'completed',
      jobId: job.id,
    });

    // Backdate the job past the retention window, then run the nightly cleanup.
    const db = getDb();
    await db.execute({
      sql: "UPDATE export_jobs SET created_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      args: [job.id],
    });
    expect(await deleteOldExportJobs(30 * 24 * 60 * 60 * 1000)).toBe(1);

    // Export survives with a NULL job link (ON DELETE SET NULL).
    const surviving = await findExportById(exp.id);
    expect(surviving).toBeDefined();
    expect(surviving?.jobId).toBeNull();
  });
});
