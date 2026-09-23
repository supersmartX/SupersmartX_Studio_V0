import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  headObject: vi.fn(),
  deleteRecording: vi.fn(),
}));

import { auth } from '@/auth';
import { headObject, deleteRecording } from '@/lib/r2';
import { POST } from '@/app/api/exports/complete/route';
import { resetDb, getDb } from '@/lib/db/driver';
import {
  setMigrated,
  createUser,
  createExportJob,
  updateExportJobStatus,
  updateUserPlanById,
  findExportJobByIdAndUser,
  getDailyRecordedSeconds,
  atomicTryConsumeRecordingSeconds,
} from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

let n = 0;
const MB = 1024 * 1024;
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

function mockHead(size: number) {
  vi.mocked(headObject).mockResolvedValue({ size, contentType: 'video/mp4' });
}

async function setupUserWithJob(plan: 'free' | 'creator_monthly' = 'creator_monthly') {
  n += 1;
  const user = await createUser(`sec-${n}@example.com`, 'Sec', 'hash');
  if (plan === 'creator_monthly') {
    await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  }
  const key = `exports/${user.id}/job-${n}.mp4`;
  const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
  await updateExportJobStatus(job.id, 'pending', { resultR2Key: key }, user.id);
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
  return { user, job, key };
}

function completeBody(jobId: string, key: string, fileSize: number, extra: Record<string, unknown> = {}) {
  return new NextRequest('http://localhost/api/exports/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobId,
      key,
      fileSize,
      mimeType: 'video/mp4',
      platformId: 'youtube-landscape',
      outputWidth: 1280,
      outputHeight: 720,
      ...extra,
    }),
  });
}

async function exportCount(userId: string): Promise<number> {
  const r = await getDb().execute({
    sql: 'SELECT COUNT(*) AS cnt FROM exports WHERE user_id = ?',
    args: [userId],
  });
  return Number(r.rows[0]?.cnt) || 0;
}

/**
 * SEC-001 + BUS-001 route-level proof. Real DB (users, jobs, exports,
 * quotas, recording ledger); only the session and R2 are mocked, so every
 * enforcement decision under test executes production code.
 */
describe('POST /api/exports/complete enforcement', () => {
  beforeEach(() => {
    cleanTestData();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('SEC-001: server-verified size is authoritative', () => {
    it('1. honest client size succeeds and stores the verified size', async () => {
      const { user, job, key } = await setupUserWithJob();
      mockHead(1 * MB);
      const res = await POST(completeBody(job.id, key, 1 * MB));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.exportId).toBeDefined();
      expect(await exportCount(user.id)).toBe(1);
    });

    it('2. client claiming SMALLER than actual is enforced on actual', async () => {
      const { user, job, key } = await setupUserWithJob();
      mockHead(1 * MB);
      const res = await POST(completeBody(job.id, key, 1024)); // lies: 1KB
      expect(res.status).toBe(200);
      const row = await getDb().execute({
        sql: 'SELECT file_size FROM exports WHERE user_id = ?',
        args: [user.id],
      });
      expect(Number(row.rows[0]?.file_size)).toBe(1 * MB);
    });

    it('3. client claiming LARGER than actual is enforced on actual', async () => {
      const { user, job, key } = await setupUserWithJob();
      mockHead(1 * MB);
      const res = await POST(completeBody(job.id, key, 50 * MB)); // lies: 50MB
      expect(res.status).toBe(200);
      const row = await getDb().execute({
        sql: 'SELECT file_size FROM exports WHERE user_id = ?',
        args: [user.id],
      });
      expect(Number(row.rows[0]?.file_size)).toBe(1 * MB);
    });

    it('4/7/10. actual object over 200MB is rejected WITH cleanup and NO record', async () => {
      const { user, job, key } = await setupUserWithJob();
      mockHead(250 * MB);
      const res = await POST(completeBody(job.id, key, 1 * MB)); // lies small
      expect(res.status).toBe(413);
      expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(key);
      expect(await exportCount(user.id)).toBe(0);
      const stored = await findExportJobByIdAndUser(job.id, user.id);
      expect(stored?.status).not.toBe('completed');
    });

    it('5/6. quota-exhausted user is rejected with cleanup and no record', async () => {
      const { user, job, key } = await setupUserWithJob('free');
      mockHead(1 * MB);
      // Exhaust the free 3-upload quota with real completes.
      for (let i = 0; i < 3; i++) {
        const k = `exports/${user.id}/q-${i}.mp4`;
        const j = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
        await updateExportJobStatus(j.id, 'pending', { resultR2Key: k }, user.id);
        const r = await POST(completeBody(j.id, k, 1 * MB));
        expect(r.status).toBe(200);
      }
      const ledgerBefore = await getDailyRecordedSeconds(user.id);
      vi.mocked(deleteRecording).mockClear();
      const denied = await POST(completeBody(job.id, key, 1 * MB));
      expect(denied.status).toBe(403);
      expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(key);
      expect(await exportCount(user.id)).toBe(3);
      // Ledger reverted: the rejected attempt consumed nothing.
      expect(await getDailyRecordedSeconds(user.id)).toBeCloseTo(ledgerBefore, 6);
    });

    it('8. successful upload within quota persists verified metadata', async () => {
      const { user, job, key } = await setupUserWithJob();
      mockHead(5 * MB);
      const res = await POST(completeBody(job.id, key, 5 * MB));
      expect(res.status).toBe(200);
      const row = await getDb().execute({
        sql: 'SELECT file_size, mime_type, status FROM exports WHERE user_id = ?',
        args: [user.id],
      });
      expect(Number(row.rows[0]?.file_size)).toBe(5 * MB);
      expect(row.rows[0]?.mime_type).toBe('video/mp4');
      expect(row.rows[0]?.status).toBe('completed');
    });

    it('9. retry of a completed request is idempotent (no duplicate, no double charge)', async () => {
      const { user, job, key } = await setupUserWithJob('free');
      mockHead(10 * MB);
      const first = await POST(completeBody(job.id, key, 10 * MB, { duration: 60 }));
      expect(first.status).toBe(200);
      const firstId = (await first.json()).exportId;
      const ledgerAfterFirst = await getDailyRecordedSeconds(user.id);
      const second = await POST(completeBody(job.id, key, 10 * MB, { duration: 60 }));
      expect(second.status).toBe(200);
      expect((await second.json()).exportId).toBe(firstId);
      expect(await exportCount(user.id)).toBe(1);
      expect(await getDailyRecordedSeconds(user.id)).toBeCloseTo(ledgerAfterFirst, 6);
    });
  });

  describe('BUS-001: server ledger decides the daily budget', () => {
    const ACTUAL_150MB = 150 * MB;
    const FLOOR_150MB = ACTUAL_150MB / (12_000_000 / 8); // 100.8s

    it('4. claim shorter than the byte floor is charged at the floor', async () => {
      const { user, job, key } = await setupUserWithJob('free');
      mockHead(ACTUAL_150MB);
      const res = await POST(completeBody(job.id, key, ACTUAL_150MB, { duration: 10 }));
      expect(res.status).toBe(200);
      expect(await getDailyRecordedSeconds(user.id)).toBeCloseTo(FLOOR_150MB, 4);
    });

    it('5/6. zero, negative, and missing claims still charge the floor', async () => {
      for (const bad of [0, -50]) {
        const { user, job, key } = await setupUserWithJob('free');
        mockHead(ACTUAL_150MB);
        const res = await POST(completeBody(job.id, key, ACTUAL_150MB, { duration: bad }));
        expect(res.status).toBe(200);
        expect(await getDailyRecordedSeconds(user.id)).toBeCloseTo(FLOOR_150MB, 4);
      }
      const { user, job, key } = await setupUserWithJob('free');
      mockHead(ACTUAL_150MB);
      const res = await POST(completeBody(job.id, key, ACTUAL_150MB)); // no duration at all
      expect(res.status).toBe(200);
      expect(await getDailyRecordedSeconds(user.id)).toBeCloseTo(FLOOR_150MB, 4);
    });

    it('3. over-budget request is rejected with cleanup and no record', async () => {
      const { user, job, key } = await setupUserWithJob('free');
      await atomicTryConsumeRecordingSeconds(user.id, 590, 600);
      mockHead(ACTUAL_150MB);
      const res = await POST(completeBody(job.id, key, ACTUAL_150MB, { duration: 5 }));
      expect(res.status).toBe(403);
      expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(key);
      expect(await exportCount(user.id)).toBe(0);
      expect(await getDailyRecordedSeconds(user.id)).toBe(590);
    });

    it('7. forged localStorage cannot bypass the server ledger', async () => {
      const { user, job, key } = await setupUserWithJob('free');
      await atomicTryConsumeRecordingSeconds(user.id, 600, 600);
      // Attacker wipes/forges the client ledger to look pristine.
      window.localStorage.clear();
      window.localStorage.setItem('sxs-daily-recording-secs', '0');
      mockHead(ACTUAL_150MB);
      const res = await POST(completeBody(job.id, key, ACTUAL_150MB, { duration: 0 }));
      expect(res.status).toBe(403);
      expect(await exportCount(user.id)).toBe(0);
    });

    it('13/14. unauthenticated completion is rejected and writes no ledger', async () => {
      const { user, job, key } = await setupUserWithJob('free');
      vi.mocked(auth).mockResolvedValue(null as never);
      mockHead(1 * MB);
      const res = await POST(completeBody(job.id, key, 1 * MB, { duration: 60 }));
      expect(res.status).toBe(401);
      expect(await exportCount(user.id)).toBe(0);
      expect(await getDailyRecordedSeconds(user.id)).toBe(0);
    });
  });
});
