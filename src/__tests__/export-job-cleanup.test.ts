import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  getR2ConfigurationError: () => null,
  deleteRecording: vi.fn(),
}));

import { deleteRecording } from '@/lib/r2';
import { GET, POST } from '@/app/api/export-jobs/cleanup/route';
import { resetDb, getDb } from '@/lib/db/driver';
import { setMigrated, createUser, createExport, findExportById } from '@/lib/db';

const SECRET = 'a-cleanup-secret-for-tests';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const OLD = '2000-01-01T00:00:00.000Z';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}-${counter}`;
}

async function seedJob(options: {
  status: 'pending' | 'encoding' | 'uploading' | 'completed' | 'failed';
  r2Key: string | null;
  createdAt?: string;
  userId?: string;
  jobId?: string;
}) {
  const userId = options.userId ?? (await createUser(nextId('cleanup') + '@example.com', 'Cleanup', 'hash')).id;
  const jobId = options.jobId ?? nextId('job');
  await getDb().execute({
    sql: `INSERT INTO export_jobs (id, user_id, config_json, status, progress, result_r2_key, result_file_size, retry_count, created_at)
          VALUES (?, ?, '{}', ?, 0, ?, 0, 0, ?)`,
    args: [jobId, userId, options.status, options.r2Key, options.createdAt ?? OLD],
  });
  return { userId, jobId };
}

async function jobExists(jobId: string): Promise<boolean> {
  const r = await getDb().execute({ sql: 'SELECT id FROM export_jobs WHERE id = ?', args: [jobId] });
  return r.rows.length > 0;
}

function cronRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/export-jobs/cleanup', { method: 'GET', headers });
}

describe('GET /api/export-jobs/cleanup — Vercel cron invocation', () => {
  beforeEach(() => {
    cleanTestData();
    vi.clearAllMocks();
    process.env.CLEANUP_SECRET = SECRET;
  });
  afterEach(() => {
    cleanTestData();
    delete process.env.CLEANUP_SECRET;
  });

  it('accepts the bearer credential Vercel Cron Jobs actually send', async () => {
    await seedJob({ status: 'failed', r2Key: `exports/${nextId('k')}.mp4` });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deleted: 1, r2Cleaned: 1 });
  });

  it('still accepts the manual x-cleanup-secret header on POST', async () => {
    await seedJob({ status: 'failed', r2Key: `exports/${nextId('k')}.mp4` });

    const res = await POST(
      new NextRequest('http://localhost/api/export-jobs/cleanup', {
        method: 'POST',
        headers: { 'x-cleanup-secret': SECRET },
      }),
    );

    expect(res.status).toBe(200);
  });

  it('rejects a wrong secret without touching anything', async () => {
    const { jobId } = await seedJob({ status: 'failed', r2Key: `exports/${nextId('k')}.mp4` });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}-wrong` }));

    expect(res.status).toBe(401);
    expect(vi.mocked(deleteRecording)).not.toHaveBeenCalled();
    expect(await jobExists(jobId)).toBe(true);
  });

  it('rejects a request with no credential at all', async () => {
    const res = await GET(cronRequest());
    expect(res.status).toBe(401);
  });

  it('rejects a prefix of the secret (length mismatch must not pass)', async () => {
    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET.slice(0, -1)}` }));
    expect(res.status).toBe(401);
  });

  it('fails closed when CLEANUP_SECRET is not configured', async () => {
    delete process.env.CLEANUP_SECRET;
    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(401);
  });
});

describe('GET /api/export-jobs/cleanup — what it may and may not delete', () => {
  beforeEach(() => {
    cleanTestData();
    vi.clearAllMocks();
    process.env.CLEANUP_SECRET = SECRET;
  });
  afterEach(() => {
    cleanTestData();
    delete process.env.CLEANUP_SECRET;
  });

  it('deletes an abandoned failed job and its orphaned R2 object', async () => {
    const r2Key = `exports/${nextId('orphan')}.mp4`;
    const { jobId } = await seedJob({ status: 'failed', r2Key });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deleted: 1, r2Cleaned: 1 });
    expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(r2Key);
    expect(await jobExists(jobId)).toBe(false);
  });

  it('deletes stale in-flight jobs (pending / encoding / uploading)', async () => {
    const pending = await seedJob({ status: 'pending', r2Key: `exports/${nextId('p')}.mp4` });
    const encoding = await seedJob({ status: 'encoding', r2Key: `exports/${nextId('e')}.mp4` });
    const uploading = await seedJob({ status: 'uploading', r2Key: `exports/${nextId('u')}.mp4` });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    await expect(res.json()).resolves.toMatchObject({ deleted: 3, r2Cleaned: 3 });
    expect(await jobExists(pending.jobId)).toBe(false);
    expect(await jobExists(encoding.jobId)).toBe(false);
    expect(await jobExists(uploading.jobId)).toBe(false);
  });

  it('leaves recent jobs alone', async () => {
    const { jobId } = await seedJob({
      status: 'failed',
      r2Key: `exports/${nextId('recent')}.mp4`,
      createdAt: new Date().toISOString(),
    });

    await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    expect(await jobExists(jobId)).toBe(true);
  });

  // The finding: a completed job's result_r2_key IS the object behind a Creator
  // library item, so the sweep used to delete files customers had already paid
  // to export.
  it('preserves a completed export job and its R2 object', async () => {
    const user = await createUser(nextId('creator') + '@example.com', 'Creator', 'hash');
    const r2Key = `exports/${user.id}/library.mp4`;
    const { jobId } = await seedJob({ status: 'completed', r2Key, userId: user.id });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    await expect(res.json()).resolves.toMatchObject({ deleted: 0, r2Cleaned: 0 });
    expect(vi.mocked(deleteRecording)).not.toHaveBeenCalled();
    expect(await jobExists(jobId)).toBe(true);
  });

  // The completion route writes the exports row before stamping the job, so a
  // crash can leave a live export whose job still reads 'uploading'. The object
  // is referenced and must survive — but the stale job row is still reclaimed,
  // because `exports.job_id` is ON DELETE SET NULL.
  it('preserves an R2 object that an exports row references, whatever the job status', async () => {
    const user = await createUser(nextId('creator') + '@example.com', 'Creator', 'hash');
    const r2Key = `exports/${user.id}/referenced.mp4`;
    const { jobId } = await seedJob({ status: 'uploading', r2Key, userId: user.id });
    const created = await createExport({
      userId: user.id,
      r2Key,
      platform: 'youtube-landscape',
      outputWidth: 1920,
      outputHeight: 1080,
      fileSize: 1024,
      mimeType: 'video/mp4',
      status: 'completed',
      jobId,
    });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    // The object is never a delete target...
    await expect(res.json()).resolves.toMatchObject({ deleted: 1, r2Cleaned: 0 });
    expect(vi.mocked(deleteRecording)).not.toHaveBeenCalled();
    // ...and the export itself is untouched, with its job link simply cleared.
    expect(await findExportById(created.id)).toBeDefined();
    expect((await findExportById(created.id))?.jobId).toBeNull();
    // The stale job row is reclaimed.
    expect(await jobExists(jobId)).toBe(false);
  });

  it('reports a bounded sweep rather than reading the whole table', async () => {
    await seedJob({ status: 'failed', r2Key: null });

    const res = await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    // A job with no R2 key is still a stale DB row, but there is nothing in R2
    // to delete, so r2Cleaned must not count it.
    await expect(res.json()).resolves.toMatchObject({ deleted: 1, r2Cleaned: 0 });
  });

  it('keeps the retention window at 30 days', async () => {
    const justInside = new Date(Date.now() - (THIRTY_DAYS_MS - 60_000)).toISOString();
    const justOutside = new Date(Date.now() - (THIRTY_DAYS_MS + 60_000)).toISOString();
    const inside = await seedJob({ status: 'failed', r2Key: null, createdAt: justInside });
    const outside = await seedJob({ status: 'failed', r2Key: null, createdAt: justOutside });

    await GET(cronRequest({ authorization: `Bearer ${SECRET}` }));

    expect(await jobExists(inside.jobId)).toBe(true);
    expect(await jobExists(outside.jobId)).toBe(false);
  });
});