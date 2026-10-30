import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The cloud recording library is a Creator entitlement, and a lapsed Creator is
 * no longer entitled to it. The route is owner-scoped, but scoping alone let an
 * ended term keep enumerating and playing back cloud masters — so the plan check
 * runs before any listing, and a paid plan without a stored expiry is treated as
 * expired (fail closed).
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUserById: vi.fn(),
  listUserRecordings: vi.fn(),
  isR2Configured: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return { ...actual, findUserById: mocks.findUserById };
});

vi.mock('@/lib/r2', () => ({
  isR2Configured: mocks.isR2Configured,
  listUserRecordings: mocks.listUserRecordings,
}));

import { GET } from '@/app/api/recordings/route';

const USER_ID = 'user_1';

function request() {
  return new NextRequest('http://localhost/api/recordings');
}

function storedUser(overrides: { plan?: string; planExpiresAt?: string | null }) {
  return {
    id: USER_ID,
    email: 'creator@example.com',
    name: 'Creator',
    passwordHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    plan: overrides.plan ?? 'creator_monthly',
    // An explicit null is meaningful (paid plan, no expiry), so only an omitted
    // key gets the still-active default.
    planExpiresAt:
      'planExpiresAt' in overrides
        ? overrides.planExpiresAt ?? null
        : new Date(Date.now() + 86_400_000).toISOString(),
    sessionVersion: 1,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: USER_ID } } as never);
  mocks.isR2Configured.mockReturnValue(false);
});

describe('GET /api/recordings — entitlement gate', () => {
  it('rejects an unauthenticated request', async () => {
    mocks.auth.mockResolvedValue(null as never);

    const res = await GET(request());

    expect(res.status).toBe(401);
    expect(mocks.findUserById).not.toHaveBeenCalled();
  });

  it('rejects a Free account', async () => {
    mocks.findUserById.mockResolvedValue(storedUser({ plan: 'free', planExpiresAt: null }) as never);

    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Creator plan required' });
    expect(mocks.isR2Configured).not.toHaveBeenCalled();
  });

  it('rejects an expired Creator term', async () => {
    mocks.findUserById.mockResolvedValue(
      storedUser({ planExpiresAt: '2026-01-01T00:00:00.000Z' }) as never,
    );

    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Plan has expired' });
    expect(mocks.listUserRecordings).not.toHaveBeenCalled();
  });

  it('rejects a paid plan with no stored expiry (fails closed)', async () => {
    mocks.findUserById.mockResolvedValue(storedUser({ planExpiresAt: null }) as never);

    const res = await GET(request());

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Plan has expired' });
  });

  it('rejects when the account row is gone', async () => {
    mocks.findUserById.mockResolvedValue(null as never);

    const res = await GET(request());

    expect(res.status).toBe(403);
  });

  it('lists an active Creator’s own prefix', async () => {
    mocks.findUserById.mockResolvedValue(storedUser({}) as never);
    mocks.isR2Configured.mockReturnValue(true);
    mocks.listUserRecordings.mockResolvedValue([
      {
        key: `recordings/${USER_ID}/take-1.webm`,
        size: 2048,
        lastModified: new Date('2026-01-02T03:04:05.000Z'),
      },
    ]);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(mocks.listUserRecordings).toHaveBeenCalledWith(`recordings/${USER_ID}/`);
    expect(await res.json()).toEqual({
      recordings: [
        {
          key: `recordings/${USER_ID}/take-1.webm`,
          size: 2048,
          lastModified: '2026-01-02T03:04:05.000Z',
          recordingId: 'take-1',
        },
      ],
    });
  });

  it('returns an empty list when R2 is unconfigured, without touching it', async () => {
    mocks.findUserById.mockResolvedValue(storedUser({}) as never);

    const res = await GET(request());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ recordings: [] });
    expect(mocks.listUserRecordings).not.toHaveBeenCalled();
  });
});
