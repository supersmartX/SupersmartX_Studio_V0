import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => null) }));
vi.mock('@/lib/db/driver', () => ({
  getDb: () => ({ execute: vi.fn(async () => ({ rows: [{ '1': 1 }] })) }),
}));
vi.mock('@/lib/db', () => ({ ensureMigrated: vi.fn(async () => {}) }));

import { auth } from '@/auth';
import { GET } from '@/app/api/health/route';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';

describe('health endpoint (acceptance: deploy traceability + information hiding)', () => {
  const OLD_SHA = process.env.VERCEL_GIT_COMMIT_SHA;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VERCEL_GIT_COMMIT_SHA;
  });

  afterEach(() => {
    if (OLD_SHA === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = OLD_SHA;
  });

  it('exposes a short non-sensitive commit identifier when the host provides it', async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = SHA;
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe('healthy');
    expect(body.commit).toBe('abcdef1');
  });

  it('falls back to unknown without leaking environment detail', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.commit).toBe('unknown');
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('VERCEL');
    expect(serialized).not.toContain('TURSO');
    expect(serialized).not.toContain('R2_');
  });

  it('hides detailed checks from unauthenticated callers', async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.checks).toBeUndefined();
  });

  it('reveals storage configuration only to authenticated callers', async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: 'u-1' } } as never);
    const res = await GET();
    const body = await res.json();
    expect(body.checks).toBeDefined();
    expect(['configured', 'not_configured']).toContain(body.checks.r2);
    // Still no secrets or connection strings in the authenticated payload
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('TOKEN');
  });
});
