import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.TURSO_DATABASE_URL = 'file::memory:';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  getR2ConfigurationError: () => null,
  getSignedUploadUrl: vi.fn(async () => 'https://signed.example/upload'),
  generateExportKey: (userId: string) => `exports/${userId}/generated.mp4`,
  generateExportStagingKey: (userId: string, jobId: string) => `staging/${userId}/${jobId}/source.mp4`,
}));

import { auth } from '@/auth';
import { getSignedUploadUrl } from '@/lib/r2';
import { POST } from '@/app/api/exports/presigned-put/route';
import { resetDb, getDb } from '@/lib/db/driver';
import { setMigrated, createUser, updateUserPlanById } from '@/lib/db';
import { FREE_MAX_DURATION_SECONDS } from '@/lib/entitlements';
import {
  MAX_EXPORT_SIZE_BYTES,
  MAX_EXPORT_SIZE_MB,
  MAX_EXPORT_DURATION_SECONDS,
  EXPORT_BYTES_PER_SECOND,
  EXPORT_VIDEO_BITRATE,
  EXPORT_AUDIO_BITRATE,
} from '@/lib/export/export-limits';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

let n = 0;
async function seedUser(plan: 'free' | 'creator_monthly' = 'creator_monthly') {
  n += 1;
  const user = await createUser(`limits-${n}@example.com`, 'Limits', 'hash');
  if (plan === 'creator_monthly') await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
  return user;
}

function presign(duration?: unknown) {
  return new NextRequest('http://localhost/api/exports/presigned-put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platformId: 'youtube-landscape', duration }),
  });
}

describe('export limits are one coherent number', () => {
  it('matches the bitrates the encoder actually uses', () => {
    expect(EXPORT_BYTES_PER_SECOND).toBe((EXPORT_VIDEO_BITRATE + EXPORT_AUDIO_BITRATE) / 8);
  });

  it('derives the artifact duration from the cap and the encoder bitrate', () => {
    expect(MAX_EXPORT_SIZE_MB * 1024 * 1024).toBe(MAX_EXPORT_SIZE_BYTES);
    expect(MAX_EXPORT_DURATION_SECONDS).toBe(
      Math.floor(MAX_EXPORT_SIZE_BYTES / EXPORT_BYTES_PER_SECOND),
    );
  });

  it('is large enough that the previous 200MB cap no longer bounds a Creator export', () => {
    // The finding: 200MiB at the encoder bitrate allowed only ~164s, which is
    // a wall on a plan whose recording duration is unlimited.
    const oldCapSeconds = Math.floor((200 * 1024 * 1024) / EXPORT_BYTES_PER_SECOND);
    expect(oldCapSeconds).toBeLessThan(200);
    expect(MAX_EXPORT_DURATION_SECONDS).toBeGreaterThan(oldCapSeconds * 10);
  });

  it('keeps the cap inside what a single R2 PUT can carry', () => {
    // 5GiB is the S3/R2 single-PUT ceiling; the signed URL is one PUT.
    expect(MAX_EXPORT_SIZE_BYTES).toBeLessThan(5 * 1024 * 1024 * 1024);
  });
});

describe('POST /api/exports/presigned-put duration handling', () => {
  beforeEach(() => {
    cleanTestData();
    vi.clearAllMocks();
    vi.mocked(getSignedUploadUrl).mockResolvedValue('https://signed.example/upload');
  });
  afterEach(() => cleanTestData());

  it('issues an upload URL for a long Creator recording', async () => {
    await seedUser();
    const res = await POST(presign(MAX_EXPORT_DURATION_SECONDS));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe('https://signed.example/upload');
  });

  it('rejects a claimed duration that could never fit under the cap, before any PUT', async () => {
    await seedUser();
    const res = await POST(presign(MAX_EXPORT_DURATION_SECONDS + 1));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('2048'),
    });
    expect(vi.mocked(getSignedUploadUrl)).not.toHaveBeenCalled();
    // No job was written either.
    const jobs = await getDb().execute('SELECT COUNT(*) AS c FROM export_jobs');
    expect(Number(jobs.rows[0]?.c)).toBe(0);
  });

  it('rejects a wildly overstated duration such as a 3 hour recording', async () => {
    await seedUser();
    const res = await POST(presign(3 * 3600));
    expect(res.status).toBe(403);
    expect(vi.mocked(getSignedUploadUrl)).not.toHaveBeenCalled();
  });

  it('treats an absent or non-numeric duration as no claim, not as a rejection', async () => {
    // A fresh user per claim: this route caps concurrent exports at 3, so
    // looping on one user would trip that guard instead of the claim logic.
    for (const claim of [undefined, null, 'lots', NaN, Infinity, 0, -5]) {
      await seedUser();
      const res = await POST(presign(claim));
      expect(res.status).toBe(200);
    }
  });

  it('never reaches the upload stage for a Free user — Free export is local', async () => {
    await seedUser('free');
    const res = await POST(presign(FREE_MAX_DURATION_SECONDS + 1));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: 'Free plan uses local export' });
    expect(vi.mocked(getSignedUploadUrl)).not.toHaveBeenCalled();
  });

  it('binds the signed URL to video/mp4 and a fixed expiry', async () => {
    await seedUser();
    await POST(presign(30));
    expect(vi.mocked(getSignedUploadUrl)).toHaveBeenCalledWith(
      expect.stringMatching(/^staging\//),
      'video/mp4',
      900,
    );
  });
});