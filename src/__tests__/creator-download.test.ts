import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.R2_ACCOUNT_ID = 'test-account';
process.env.R2_ACCESS_KEY_ID = 'test-key-id';
process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
process.env.R2_BUCKET_NAME = 'test-bucket';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { GET } from '@/app/api/download/route';
import { createUser, updateUserPlanById, createExport } from '@/lib/db';

// NextAuth's `auth` is overloaded (middleware + session getter); narrow to
// the session-getter signature for mocking.
const mockAuth = vi.mocked(auth as unknown as () => Promise<Session | null>);

function sessionFor(id: string, email: string) {
  mockAuth.mockResolvedValue({ user: { id, email } } as Session);
}

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

async function seedCompletedExport(userId: string, platform: string, w: number, h: number) {
  return createExport({
    userId,
    r2Key: `exports/${userId}/${platform}-${w}x${h}.mp4`,
    platform,
    outputWidth: w,
    outputHeight: h,
    fileSize: 1024,
    mimeType: 'video/mp4',
    status: 'completed',
    jobId: null,
  });
}

async function downloadAs(userId: string | null, email: string, exportId?: string) {
  if (userId === null) {
    mockAuth.mockResolvedValue(null);
  } else {
    sessionFor(userId, email);
  }
  const url = exportId === undefined
    ? 'http://localhost/api/download'
    : `http://localhost/api/download?exportId=${encodeURIComponent(exportId)}`;
  return GET(new NextRequest(url));
}

describe('creator download across platform ratios', () => {
  beforeEach(() => cleanTestData());
  afterEach(() => {
    cleanTestData();
    vi.clearAllMocks();
  });

  const ratios: Array<[string, number, number]> = [
    ['youtube-landscape', 1280, 720],
    ['youtube-shorts', 1080, 1920],
    ['instagram-post', 1080, 1080],
    ['instagram-portrait', 1080, 1350],
  ];

  for (const [platform, w, h] of ratios) {
    it(`creator ${platform} ${w}x${h} download returns a signed URL`, async () => {
      const user = await seedCreator('creator@example.com');
      const exp = await seedCompletedExport(user.id, platform, w, h);
      const res = await downloadAs(user.id, user.email, exp.id);
      expect(res.status).toBe(200);
      const body = await res.json() as { url?: string; expiresIn?: number };
      expect(typeof body.url).toBe('string');
      expect(body.url as string).toContain('https://');
      expect(body.expiresIn).toBe(3600);
    });
  }

  it('rejects cross-user download (ownership mismatch)', async () => {
    const owner = await seedCreator('owner@example.com');
    const other = await seedCreator('other@example.com');
    const exp = await seedCompletedExport(owner.id, 'youtube-landscape', 1280, 720);
    const res = await downloadAs(other.id, other.email, exp.id);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated download', async () => {
    const res = await downloadAs(null, '', 'export-anything');
    expect(res.status).toBe(401);
  });

  it('rejects missing exportId', async () => {
    const user = await seedCreator('creator@example.com');
    const res = await downloadAs(user.id, user.email, undefined);
    expect(res.status).toBe(400);
  });

  it('rejects unknown exportId', async () => {
    const user = await seedCreator('creator@example.com');
    const res = await downloadAs(user.id, user.email, 'export-does-not-exist');
    expect(res.status).toBe(404);
  });

  it('route boundary stays strict for a session id with no DB row (defense in depth)', async () => {
    // Simulates the diverged-identity state (valid session, rowless id).
    // The route must keep rejecting; healing happens upstream in the
    // session callback, never by relaxing this check.
    const user = await seedCreator('creator@example.com');
    const exp = await seedCompletedExport(user.id, 'youtube-landscape', 1280, 720);
    const res = await downloadAs('oauth-sub-without-row', user.email, exp.id);
    expect(res.status).toBe(401);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('User not found');
  });
});
