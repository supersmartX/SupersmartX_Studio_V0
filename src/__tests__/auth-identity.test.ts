import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

import { resolveSessionUser } from '@/lib/auth-identity';
import { createUser } from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

describe('resolveSessionUser', () => {
  beforeEach(() => cleanTestData());
  afterEach(() => cleanTestData());

  it('keeps a healthy session id (row found by id)', async () => {
    const user = await createUser('healthy@example.com', 'Healthy', 'correct-horse-battery-staple-1');
    expect(user).not.toBeNull();
    const resolved = await resolveSessionUser(user!.id, user!.email);
    expect(resolved?.id).toBe(user!.id);
  });

  it('heals a diverged session by adopting the email row id', async () => {
    // Simulates the production failure: valid session carrying an OAuth
    // subject (or other id) with no users row, while the durable row for
    // the same email exists under a different id. Pre-fix this state
    // produced "User not found" on every export/download call.
    const user = await createUser('diverged@example.com', 'Diverged', 'correct-horse-battery-staple-1');
    expect(user).not.toBeNull();
    const resolved = await resolveSessionUser('oauth-sub-without-row', user!.email);
    expect(resolved?.id).toBe(user!.id);
    expect(resolved?.email).toBe(user!.email);
  });

  it('prefers the id row when both id and email rows exist', async () => {
    const byId = await createUser('by-id@example.com', 'By Id', 'correct-horse-battery-staple-1');
    const byEmail = await createUser('by-email@example.com', 'By Email', 'correct-horse-battery-staple-1');
    expect(byId).not.toBeNull();
    expect(byEmail).not.toBeNull();
    // Session id matches its own row: keep it even though the email
    // belongs to a different account (must never cross accounts).
    const resolved = await resolveSessionUser(byId!.id, byEmail!.email);
    expect(resolved?.id).toBe(byId!.id);
  });

  it('returns null for a fully orphaned identity (no row by id or email)', async () => {
    const resolved = await resolveSessionUser('ghost-id', 'ghost@example.com');
    expect(resolved).toBeNull();
  });

  it('returns null when there is no session id', async () => {
    const user = await createUser('noid@example.com', 'No Id', 'correct-horse-battery-staple-1');
    expect(user).not.toBeNull();
    // No id: email-only sessions are not adopted here (callers decide).
    const resolved = await resolveSessionUser(undefined, undefined);
    expect(resolved).toBeNull();
  });
});
