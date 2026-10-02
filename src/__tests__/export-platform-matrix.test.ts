import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  getR2ConfigurationError: () => null,
  getSignedUploadUrl: vi.fn().mockResolvedValue('https://r2.example/upload'),
  generateExportKey: vi.fn().mockReturnValue('exports/test/key.mp4'),
  headObject: vi.fn().mockResolvedValue({ size: 2_000_000, contentType: 'video/mp4' }),
  deleteRecording: vi.fn(),
  deleteObject: vi.fn(),
}));

import { auth } from '@/auth';
import { POST as createJobPOST } from '@/app/api/export-jobs/route';
import { POST as presignedPOST } from '@/app/api/exports/presigned-put/route';
import { POST as completePOST } from '@/app/api/exports/complete/route';
import { resetDb } from '@/lib/db/driver';
import { setMigrated, createUser, updateUserPlanById, createExportJob, updateExportJobStatus } from '@/lib/db';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlatformId } from '@/types';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();
let n = 0;

async function seedCreator() {
  n += 1;
  const user = await createUser(`matrix-${n}@example.com`, 'Creator', 'hash');
  if (!user) throw new Error('seed user creation failed');
  await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: `matrix-${n}@example.com` } } as never);
  return user;
}

function createJobRequest(platformId: PlatformId, outputWidth: number, outputHeight: number) {
  return new NextRequest('http://localhost/api/export-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config: { platformId, outputWidth, outputHeight } }),
  });
}

function presignedRequest(platformId: PlatformId) {
  return new NextRequest('http://localhost/api/exports/presigned-put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platformId }),
  });
}

/**
 * `custom` is a legacy compatibility id with no preset. Accepting it anywhere in
 * the export path would let a caller set arbitrary dimensions and bypass the
 * single source of truth, so every stage must reject it — not just the UI.
 */
describe('custom platform is rejected by every export stage', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('export-jobs rejects custom even when dimensions are self-consistent', async () => {
    await seedCreator();
    const res = await createJobPOST(createJobRequest('custom', 1234, 567));
    expect(res.status).toBe(400);
  });

  it('presigned-put rejects custom instead of clamping arbitrary dimensions', async () => {
    await seedCreator();
    const res = await presignedPOST(presignedRequest('custom'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'Invalid platformId' });
  });

  it('presigned-put rejects client-supplied output dimensions entirely', async () => {
    await seedCreator();
    const res = await presignedPOST(
      new NextRequest('http://localhost/api/exports/presigned-put', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platformId: 'youtube-landscape', outputWidth: 3840, outputHeight: 2160 }),
      })
    );
    // The response carries the preset-derived frame, not the requested one.
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ outputWidth: 1920, outputHeight: 1080 });
  });

  it('exports/complete rejects a custom job config', async () => {
    const user = await seedCreator();
    const job = await createExportJob(user.id, JSON.stringify({ platformId: 'custom' }));
    const key = 'exports/x/custom.mp4';
    await updateExportJobStatus(job.id, 'pending', { resultR2Key: key }, user.id);

    const res = await completePOST(
      new NextRequest('http://localhost/api/exports/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id, key, platformId: 'custom', outputWidth: 1234, outputHeight: 567 }),
      })
    );
    expect(res.status).toBe(400);
  });
});

describe('portrait presets survive the server entitlement check', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.clearAllMocks();
  });

  // Regression: the per-axis resolution check rejected 1080x1920 for a Creator
  // (1920x1080 envelope), so every vertical preset was refused at presign time.
  const portrait = LAUNCH_PLATFORM_PRESETS.filter((p) => p.height > p.width);

  it('the matrix actually contains portrait presets to guard', () => {
    expect(portrait.length).toBeGreaterThan(0);
  });

  it.each(portrait.map((p) => [p.id, p.width, p.height] as const))(
    'presigned-put accepts the %s preset at %ix%i',
    async (id, width, height) => {
      await seedCreator();
      const res = await presignedPOST(presignedRequest(id));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toMatchObject({ outputWidth: width, outputHeight: height });
    }
  );

  it.each(LAUNCH_PLATFORM_PRESETS.map((p) => [p.id, p.width, p.height] as const))(
    'export-jobs accepts the %s preset at its authoritative dimensions',
    async (id, width, height) => {
      await seedCreator();
      const res = await createJobPOST(createJobRequest(id, width, height));
      expect(res.status).toBe(201);
    }
  );

  it('export-jobs still rejects dimensions that do not match the preset', async () => {
    await seedCreator();
    const res = await createJobPOST(createJobRequest('youtube-shorts', 999, 999));
    expect(res.status).toBe(400);
  });
});
