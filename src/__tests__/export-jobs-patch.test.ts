import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { PATCH } from '@/app/api/export-jobs/[id]/route';
import { resetDb } from '@/lib/db/driver';
import {
  setMigrated,
  createUser,
  createExportJob,
  findExportJobByIdAndUser,
} from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

let n = 0;

async function setupJob() {
  n += 1;
  const user = await createUser(`patch-${n}@example.com`, 'Patch', 'hash');
  const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
  return { user, job };
}

function patchReq(jobId: string, body: Record<string, unknown>) {
  return {
    req: new NextRequest(`http://localhost/api/export-jobs/${jobId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params: Promise.resolve({ id: jobId }),
  };
}

/**
 * Regression tests for the production PATCH → 400 storm: the client reports
 * encoding progress as { status: 'encoding', progress: N } on every 10%, so
 * same-state updates must be accepted as progress writes. Terminal states
 * must remain inescapable.
 */
describe('PATCH /api/export-jobs/[id] transitions', () => {
  beforeEach(() => {
    cleanTestData();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanTestData();
  });

  it('pending → encoding returns 200', async () => {
    const { user, job } = await setupJob();
    const { req, params } = patchReq(job.id, { status: 'encoding', progress: 0 });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('encoding');
  });

  it('encoding → encoding with progress returns 200 (repeated reports)', async () => {
    const { user, job } = await setupJob();
    for (const progress of [10, 20, 30]) {
      const { req, params } = patchReq(job.id, { status: 'encoding', progress });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(200);
    }
    const stored = await findExportJobByIdAndUser(job.id, user.id);
    expect(stored?.status).toBe('encoding');
    expect(stored?.progress).toBe(30);
  });

  it('encoding → uploading returns 200', async () => {
    const { user, job } = await setupJob();
    const first = patchReq(job.id, { status: 'encoding' });
    expect((await PATCH(first.req, { params: first.params })).status).toBe(200);
    const second = patchReq(job.id, { status: 'uploading' });
    expect((await PATCH(second.req, { params: second.params })).status).toBe(200);
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('uploading');
  });

  it('uploading → completed returns 200', async () => {
    const { user, job } = await setupJob();
    for (const status of ['encoding', 'uploading', 'completed']) {
      const { req, params } = patchReq(job.id, { status });
      expect((await PATCH(req, { params })).status).toBe(200);
    }
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('completed');
  });

  it('completed → encoding/uploading/failed all return 400', async () => {
    const { job } = await setupJob();
    for (const warm of ['encoding', 'uploading', 'completed']) {
      const { req, params } = patchReq(job.id, { status: warm });
      await PATCH(req, { params });
    }
    for (const status of ['encoding', 'uploading', 'failed']) {
      const { req, params } = patchReq(job.id, { status });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/Invalid transition: completed/);
    }
  });

  it('failed → encoding/uploading/completed all return 400', async () => {
    const { user, job } = await setupJob();
    const fail = patchReq(job.id, { status: 'failed', errorMessage: 'boom' });
    expect((await PATCH(fail.req, { params: fail.params })).status).toBe(200);
    for (const status of ['encoding', 'uploading', 'completed']) {
      const { req, params } = patchReq(job.id, { status });
      const res = await PATCH(req, { params });
      expect(res.status).toBe(400);
    }
    expect((await findExportJobByIdAndUser(job.id, user.id))?.status).toBe('failed');
  });

  it('progress-only PATCH without status still works', async () => {
    const { user, job } = await setupJob();
    const first = patchReq(job.id, { status: 'encoding' });
    await PATCH(first.req, { params: first.params });
    const second = patchReq(job.id, { progress: 55 });
    expect((await PATCH(second.req, { params: second.params })).status).toBe(200);
    const stored = await findExportJobByIdAndUser(job.id, user.id);
    expect(stored?.status).toBe('encoding');
    expect(stored?.progress).toBe(55);
  });

  it('genuinely invalid transitions are still rejected', async () => {
    const { job } = await setupJob();
    const { req, params } = patchReq(job.id, { status: 'uploading' });
    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Invalid transition: pending/);
  });
});
