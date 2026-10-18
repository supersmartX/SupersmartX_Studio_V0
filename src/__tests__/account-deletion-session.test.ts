import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/r2', () => ({
  listUserRecordings: vi.fn(async () => []),
  deleteRecording: vi.fn(async () => undefined),
}));

// Fault-injection seam for the data layer. The real functions are the default
// (so every other case exercises them); the flag lets one test make the
// tombstone write fail so the route's fail-closed path is exercised. The retired
// version spied on the libSQL `getDb().execute`; the route now writes through
// Prisma, so the seam moves to the db module itself.
const dbMocks = vi.hoisted(() => ({ tombstoneError: null as Error | null }));
vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    recordDeletedIdentity: vi.fn((...args: Parameters<typeof actual.recordDeletedIdentity>) => {
      if (dbMocks.tombstoneError) return Promise.reject(dbMocks.tombstoneError);
      return actual.recordDeletedIdentity(...args);
    }),
  };
});

import { auth } from '@/auth';
import { listUserRecordings, deleteRecording } from '@/lib/r2';
import { DELETE as deleteAccount } from '@/app/api/user/delete/route';
import { resetDb, getDb } from '@/__tests__/helpers/db';
import {
  setMigrated,
  createUser,
  findUserById,
  findUserByEmail,
  recordDeletedIdentity,
  getDeletedIdentitySessionVersion,
  createExportJob,
  createExport,
} from '@/lib/db';
import { resolveSessionUser } from '@/lib/auth-identity';
import { reconcileSessionVersion } from '@/lib/session-version';

// Database-backed suite: runs only when DATABASE_URL points at a throwaway
// PostgreSQL database; otherwise the cases are reported as skipped.
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

function cleanTestData() {
  resetDb();
  setMigrated(false);
  dbMocks.tombstoneError = null;
}

const EMAIL = 'reclaim@example.com';

function deleteRequest() {
  return new NextRequest('http://localhost/api/user/delete', { method: 'DELETE' });
}

async function userExists(id: string): Promise<boolean> {
  return Boolean(await findUserById(id));
}

/**
 * The finding: deleting an account removed the row and cleared the local
 * cookies, but nothing retired the still-signed session cookie. NextAuth's JWT
 * survives until it expires, and `resolveSessionUser` falls back to looking the
 * identity up by email — so once the same address signed up again, the deleted
 * account's cookie resolved onto the *new* identity with the new identity's
 * plan, storage and exports.
 *
 * Every test below walks the real path: JWT claim -> resolveSessionUser ->
 * session-version reconciliation.
 */
describeDb('account deletion retires every token for the identity', () => {
  beforeEach(() => {
    cleanTestData();
    vi.clearAllMocks();
    vi.mocked(listUserRecordings).mockResolvedValue([]);
  });
  afterEach(() => cleanTestData());

  it('leaves no way for the old cookie to reach a new account on the same address', async () => {
    // The deleted identity, and the session cookie it left behind.
    const oldUser = await createUser(EMAIL, 'Old', 'hash');
    await getDb().execute({
      sql: 'UPDATE users SET session_version = ? WHERE id = ?',
      args: [4, oldUser.id],
    });
    const oldToken = { id: oldUser.id, email: EMAIL, sessionVersion: 4 };

    // Sanity: before deletion the cookie is a valid session.
    const before = await resolveSessionUser(oldToken.id, oldToken.email);
    expect(before?.id).toBe(oldUser.id);
    expect(reconcileSessionVersion(oldToken.sessionVersion, before!.sessionVersion)).toBe(4);

    vi.mocked(auth).mockResolvedValue({ user: { id: oldUser.id, email: EMAIL } } as never);
    const res = await deleteAccount(deleteRequest());
    expect(res.status).toBe(200);
    expect(await userExists(oldUser.id)).toBe(false);

    // The same address signs up again.
    const newUser = await createUser(EMAIL, 'New', 'hash2');
    expect(newUser.id).not.toBe(oldUser.id);

    // The email fallback still finds *someone* — that is precisely why the
    // session version has to be what refuses.
    const resolved = await resolveSessionUser(oldToken.id, oldToken.email);
    expect(resolved?.id).toBe(newUser.id);
    expect(resolved!.sessionVersion).toBeGreaterThan(oldToken.sessionVersion);
    expect(reconcileSessionVersion(oldToken.sessionVersion, resolved!.sessionVersion)).toBeNull();
  });

  it('records a tombstone above the version it was holding', async () => {
    const user = await createUser(EMAIL, 'Old', 'hash');
    await getDb().execute({
      sql: 'UPDATE users SET session_version = ? WHERE id = ?',
      args: [9, user.id],
    });
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: EMAIL } } as never);

    await deleteAccount(deleteRequest());

    expect(await getDeletedIdentitySessionVersion(EMAIL)).toBe(10);
  });

  it('keeps raising the floor, so an old cookie is dead across repeated signups', async () => {
    let sessionVersion = 0;
    let staleTokenVersion = 0;

    for (let round = 1; round <= 3; round++) {
      const user = await createUser(EMAIL, `Round ${round}`, `hash-${round}`);
      sessionVersion = user.sessionVersion;
      if (round === 1) staleTokenVersion = sessionVersion;

      vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: EMAIL } } as never);
      expect((await deleteAccount(deleteRequest())).status).toBe(200);

      const next = await createUser(EMAIL, `Round ${round + 1}`, `hash-${round + 1}`);
      expect(next.sessionVersion).toBeGreaterThan(sessionVersion);
      // The token from round 1 is refused against every later identity.
      expect(reconcileSessionVersion(staleTokenVersion, next.sessionVersion)).toBeNull();
      sessionVersion = next.sessionVersion;

      // Free the address again for the next round.
      await getDb().execute({ sql: 'DELETE FROM users WHERE id = ?', args: [next.id] });
    }
  });

  it('does not let the tombstone be lowered by a smaller version', async () => {
    await recordDeletedIdentity(EMAIL, 12);
    await recordDeletedIdentity(EMAIL, 3);
    expect(await getDeletedIdentitySessionVersion(EMAIL)).toBe(12);
  });

  it('matches the tombstone case-insensitively, like every other email lookup', async () => {
    await recordDeletedIdentity(EMAIL, 5);
    expect(await getDeletedIdentitySessionVersion('RECLAIM@Example.COM')).toBe(5);
    const upper = await createUser('RECLAIM@EXAMPLE.COM', 'Upper', 'hash');
    expect(upper.sessionVersion).toBe(5);
  });

  it('leaves a brand-new identity at version 0, so a first sign-in still works', async () => {
    const fresh = await createUser('never-seen@example.com', 'Fresh', 'hash');
    expect(fresh.sessionVersion).toBe(0);
    // A token minted before the claim existed adopts it once.
    expect(reconcileSessionVersion(undefined, fresh.sessionVersion)).toBe(0);
  });

  it('clears both session cookie names on success', async () => {
    const user = await createUser(EMAIL, 'Old', 'hash');
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: EMAIL } } as never);

    const res = await deleteAccount(deleteRequest());

    const cookies = res.cookies.getAll().filter((c) => c.maxAge === 0).map((c) => c.name);
    expect(cookies).toContain('next-auth.session-token');
    expect(cookies).toContain('__Secure-next-auth.session-token');
  });

  it('fails closed: if the tombstone cannot be written, the account is kept', async () => {
    const user = await createUser(EMAIL, 'Old', 'hash');
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: EMAIL } } as never);
    // The tombstone write is the point of no return: if it fails, the account
    // row must survive so the identity is not silently re-provisionable.
    dbMocks.tombstoneError = new Error('tombstone write failed');

    const res = await deleteAccount(deleteRequest());

    expect(res.status).toBe(500);
    // The row survives, so the identity is not silently re-provisionable.
    expect(await userExists(user.id)).toBe(true);
    dbMocks.tombstoneError = null;
    expect(await getDeletedIdentitySessionVersion(EMAIL)).toBeNull();
  });

  it('refuses to delete without a session', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const res = await deleteAccount(deleteRequest());
    expect(res.status).toBe(401);
  });

  it('removes the user’s exports and R2 objects as part of the same deletion', async () => {
    const user = await createUser(EMAIL, 'Old', 'hash');
    const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
    const key = `exports/${user.id}/mine.mp4`;
    await createExport({
      userId: user.id,
      r2Key: key,
      platform: 'youtube-landscape',
      outputWidth: 1920,
      outputHeight: 1080,
      fileSize: 1024,
      mimeType: 'video/mp4',
      status: 'completed',
      jobId: job.id,
    });
    vi.mocked(listUserRecordings).mockResolvedValue([{ key, size: 1024, lastModified: new Date() }]);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: EMAIL } } as never);

    const res = await deleteAccount(deleteRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ deletedR2Objects: 1, userDeleted: true });
    expect(vi.mocked(deleteRecording)).toHaveBeenCalledWith(key);
    const rows = await getDb().execute({ sql: 'SELECT COUNT(*) AS c FROM exports WHERE user_id = ?', args: [user.id] });
    expect(Number(rows.rows[0]?.c)).toBe(0);
    expect(await findUserByEmail(EMAIL)).toBeUndefined();
  });
});

describeDb('session-version reconciliation', () => {
  it('refuses a token whose version no longer matches', () => {
    expect(reconcileSessionVersion(3, 4)).toBeNull();
    expect(reconcileSessionVersion(4, 3)).toBeNull();
  });

  it('accepts an exact match', () => {
    expect(reconcileSessionVersion(7, 7)).toBe(7);
  });

  it('adopts the current version for a token that carries none, exactly once', () => {
    expect(reconcileSessionVersion(undefined, 0)).toBe(0);
    expect(reconcileSessionVersion(null, 12)).toBe(12);
  });
});