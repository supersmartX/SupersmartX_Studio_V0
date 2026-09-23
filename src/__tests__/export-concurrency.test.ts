import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { resetDb, getDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { POST } from '@/app/api/export-jobs/route';
import { createUser, updateUserPlanById, createExportJob } from '@/lib/db';

// A job abandoned longer than the staleness window must not count as
// "concurrent". Kept safely above any legitimate single export.
const STALE_MS = 7 * 60 * 60 * 1000;

const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

async function seedCreator(email: string) {
  const user = await createUser(email, 'Creator User', 'correct-horse-battery-staple-1');
  if (!user) throw new Error('seed user creation failed');
  await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  return user;
}

async function seedStuckJobs(userId: string, count: number, ageMs: number, status = 'encoding') {
  const old = new Date(Date.now() - ageMs).toISOString();
  for (let i = 0; i < count; i++) {
    const job = await createExportJob(userId, '{"platformId":"youtube-landscape"}');
    const db = getDb();
    await db.execute({
      sql: 'UPDATE export_jobs SET status = ?, created_at = ? WHERE id = ?',
      args: [status, old, job.id],
    });
  }
}

function exportJobsRequest() {
  return new NextRequest('http://localhost/api/export-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { platformId: 'youtube-landscape', outputWidth: 1280, outputHeight: 720 } }),
  });
}

describe('export concurrency guard', () => {
  beforeEach(() => cleanTestData());
  afterEach(() => {
    cleanTestData();
    vi.clearAllMocks();
  });

  it('abandoned jobs older than the staleness window do not block a normal single export', async () => {
    const user = await seedCreator('stale-creator@example.com');
    mockAuth.mockResolvedValue({ user: { id: user.id, email: user.email } } as Session);
    await seedStuckJobs(user.id, 3, STALE_MS);
    const res = await POST(exportJobsRequest());
    expect(res.status).toBe(201);
  });

  it('three genuinely active jobs still trigger the guard', async () => {
    const user = await seedCreator('busy-creator@example.com');
    mockAuth.mockResolvedValue({ user: { id: user.id, email: user.email } } as Session);
    await seedStuckJobs(user.id, 3, 60 * 1000);
    const res = await POST(exportJobsRequest());
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/Maximum 3 concurrent exports/);
  });

  it('terminal jobs never count toward concurrency', async () => {
    const user = await seedCreator('done-creator@example.com');
    mockAuth.mockResolvedValue({ user: { id: user.id, email: user.email } } as Session);
    await seedStuckJobs(user.id, 2, STALE_MS, 'completed');
    await seedStuckJobs(user.id, 2, STALE_MS, 'failed');
    await seedStuckJobs(user.id, 2, 60 * 1000, 'completed');
    const res = await POST(exportJobsRequest());
    expect(res.status).toBe(201);
  });
});
