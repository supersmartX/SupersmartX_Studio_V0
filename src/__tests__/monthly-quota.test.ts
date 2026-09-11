import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';
process.env.TURSO_DATABASE_URL = 'file::memory:';
import { createUser, getMonthlyExportCount, atomicTryConsumeMonthlyExport, atomicRevertMonthlyExport, createExport } from '@/lib/db';
import { getCurrentPeriod } from '@/lib/db';

function clean() { resetDb(); setMigrated(false); process.env.TURSO_DATABASE_URL = 'file::memory:'; }

describe('monthly export quota atomic', () => {
  beforeEach(clean); afterEach(clean);

  it('free 3rd export succeeds', async () => {
    const user = await createUser('quota1@example.com', 'Q1', 'pass1234');
    for (let i=0;i<3;i++) {
      const res = await atomicTryConsumeMonthlyExport(user.id, 3);
      expect(res.allowed).toBe(true);
      await createExport({ userId: user.id, r2Key: `k${i}`, platform: 'youtube-landscape', outputWidth:1920, outputHeight:1080, fileSize:1000, mimeType:'video/mp4', status:'completed' });
    }
    expect(await getMonthlyExportCount(user.id)).toBe(3);
  });

  it('free 4th export is rejected', async () => {
    const user = await createUser('quota2@example.com', 'Q2', 'pass1234');
    for (let i=0;i<3;i++) await atomicTryConsumeMonthlyExport(user.id, 3);
    const fourth = await atomicTryConsumeMonthlyExport(user.id, 3);
    expect(fourth.allowed).toBe(false);
    expect(fourth.count).toBe(3);
  });

  it('concurrent 3rd/4th cannot exceed quota', async () => {
    const user = await createUser('quota3@example.com', 'Q3', 'pass1234');
    await atomicTryConsumeMonthlyExport(user.id, 3);
    await atomicTryConsumeMonthlyExport(user.id, 3);
    // Two concurrent attempts for 3rd and 4th (actually 3rd is 3rd, 4th is beyond)
    const results = await Promise.all([
      atomicTryConsumeMonthlyExport(user.id, 3),
      atomicTryConsumeMonthlyExport(user.id, 3),
    ]);
    const allowedCount = results.filter(r=>r.allowed).length;
    expect(allowedCount).toBe(1); // only one of the two should succeed (making total 3)
    expect(await getMonthlyExportCount(user.id)).toBe(3);
  });

  it('local/direct export consumes quota same as R2', async () => {
    const user = await createUser('quota4@example.com', 'Q4', 'pass1234');
    // Simulate local export via atomic consume + createExport with local key
    const res = await atomicTryConsumeMonthlyExport(user.id, 3);
    expect(res.allowed).toBe(true);
    await createExport({ userId: user.id, r2Key: `local/${user.id}/test.mp4`, platform: 'tiktok', outputWidth:1080, outputHeight:1920, fileSize:500, mimeType:'video/mp4', status:'completed' });
    expect(await getMonthlyExportCount(user.id)).toBe(1);
  });

  it('R2 export consumes quota', async () => {
    const user = await createUser('quota5@example.com', 'Q5', 'pass1234');
    const res = await atomicTryConsumeMonthlyExport(user.id, 3);
    expect(res.allowed).toBe(true);
    await createExport({ userId: user.id, r2Key: `exports/${user.id}/abc.mp4`, platform: 'youtube-landscape', outputWidth:1920, outputHeight:1080, fileSize:1000, mimeType:'video/mp4', status:'completed' });
    expect(await getMonthlyExportCount(user.id)).toBe(1);
  });

  it('failed export does not consume quota (revert)', async () => {
    const user = await createUser('quota6@example.com', 'Q6', 'pass1234');
    const res = await atomicTryConsumeMonthlyExport(user.id, 3);
    expect(res.allowed).toBe(true);
    // Simulate failure before createExport — revert
    await atomicRevertMonthlyExport(user.id);
    expect(await getMonthlyExportCount(user.id)).toBe(0);
  });

  it('creator remains unlimited monthly', async () => {
    // Creator limit null means never call atomicTryConsume — but if we try with large limit, it allows many
    const user = await createUser('creator@example.com', 'Creator', 'pass1234');
    // Simulate creator: no limit check, so we can consume 10 without hitting 3 limit (using high limit)
    for (let i=0;i<10;i++) {
      const res = await atomicTryConsumeMonthlyExport(user.id, 1000);
      expect(res.allowed).toBe(true);
    }
    expect(await getMonthlyExportCount(user.id)).toBe(10);
  });

  it('period is UTC calendar month', () => {
    expect(getCurrentPeriod(new Date(Date.UTC(2026,0,15)))).toBe('2026-01');
    expect(getCurrentPeriod(new Date(Date.UTC(2026,11,31)))).toBe('2026-12');
  });
});
