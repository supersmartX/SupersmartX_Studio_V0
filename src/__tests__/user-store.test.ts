import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

// Set TURSO_DATABASE_URL to in-memory for tests before importing db
process.env.TURSO_DATABASE_URL = 'file::memory:';

// Import after env is set
import {
  findUserByEmail,
  createUser,
  updateUserPlan,
  updateUserPassword,
  verifyPassword,
  getGravatarUrl,
} from '@/lib/user-store';
import {
  saveResetToken,
  findResetToken,
  deleteResetToken,
  deleteResetTokensByEmail,
} from '@/lib/db';
import { migrateFromJson } from '@/lib/db/migrate';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

describe('user-store', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('createUser', () => {
    it('creates a new user with free plan', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      expect(user).not.toBeNull();
      expect(user!.email).toBe('test@example.com');
      expect(user!.name).toBe('Test User');
      expect(user!.plan).toBe('free');
      expect(user!.id).toMatch(/^user-/);
      expect(user!.createdAt).toBeDefined();
      expect(user!.passwordHash).toBeDefined();
      expect(user!.passwordHash).not.toBe('password123');
    });

    it('lowercases email', async () => {
      const user = await createUser('TEST@Example.COM', 'Test User', 'password123');
      expect(user!.email).toBe('test@example.com');
    });

    it('returns null for duplicate email', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const duplicate = await createUser('test@example.com', 'Another', 'password456');
      expect(duplicate).toBeNull();
    });

    it('hashes password with bcrypt', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      expect(user!.passwordHash).toMatch(/^\$2[aby]?\$\d{1,2}\$/);
      expect(user!.passwordHash).not.toBe('password123');
    });
  });

  describe('findUserByEmail', () => {
    it('finds an existing user', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const found = await findUserByEmail('test@example.com');
      expect(found).toBeDefined();
      expect(found!.email).toBe('test@example.com');
      expect(found!.name).toBe('Test User');
    });

    it('returns undefined for non-existent user', async () => {
      const found = await findUserByEmail('nonexistent@example.com');
      expect(found).toBeUndefined();
    });

    it('is case-insensitive', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const found = await findUserByEmail('TEST@EXAMPLE.COM');
      expect(found).toBeDefined();
      expect(found!.email).toBe('test@example.com');
    });
  });

  describe('verifyPassword', () => {
    it('returns true for correct password', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const valid = await verifyPassword('test@example.com', 'password123');
      expect(valid).toBe(true);
    });

    it('returns false for wrong password', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const valid = await verifyPassword('test@example.com', 'wrongpassword');
      expect(valid).toBe(false);
    });

    it('returns false for non-existent user', async () => {
      const valid = await verifyPassword('nonexistent@example.com', 'password123');
      expect(valid).toBe(false);
    });
  });

  describe('updateUserPlan', () => {
    it('updates plan to creator_monthly', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const updated = await updateUserPlan('test@example.com', 'creator_monthly');
      expect(updated).toBe(true);
      const user = await findUserByEmail('test@example.com');
      expect(user!.plan).toBe('creator_monthly');
    });

    it('sets plan expiry date', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const expiresAt = '2027-01-01T00:00:00.000Z';
      await updateUserPlan('test@example.com', 'pro_yearly', expiresAt);
      const user = await findUserByEmail('test@example.com');
      expect(user!.plan).toBe('pro_yearly');
      expect(user!.planExpiresAt).toBe(expiresAt);
    });

    it('returns false for non-existent user', async () => {
      const updated = await updateUserPlan('nonexistent@example.com', 'creator_monthly');
      expect(updated).toBe(false);
    });

    it('updates through all plan types', async () => {
      await createUser('test@example.com', 'Test User', 'password123');
      const plans = ['creator_monthly', 'creator_yearly', 'pro_monthly', 'pro_yearly', 'free'] as const;
      for (const plan of plans) {
        await updateUserPlan('test@example.com', plan);
        const user = await findUserByEmail('test@example.com');
        expect(user!.plan).toBe(plan);
      }
    });
  });

  describe('updateUserPassword', () => {
    it('updates password and allows new password login', async () => {
      await createUser('test@example.com', 'Test User', 'oldpassword');
      const updated = await updateUserPassword('test@example.com', 'newpassword');
      expect(updated).toBe(true);

      const oldValid = await verifyPassword('test@example.com', 'oldpassword');
      expect(oldValid).toBe(false);

      const newValid = await verifyPassword('test@example.com', 'newpassword');
      expect(newValid).toBe(true);
    });

    it('returns false for non-existent user', async () => {
      const updated = await updateUserPassword('nonexistent@example.com', 'newpassword');
      expect(updated).toBe(false);
    });
  });

  describe('getGravatarUrl', () => {
    it('generates a valid gravatar URL', () => {
      const url = getGravatarUrl('test@example.com');
      expect(url).toContain('https://www.gravatar.com/avatar/');
      expect(url).toContain('d=identicon');
    });

    it('normalizes email', () => {
      const url1 = getGravatarUrl('Test@Example.COM');
      const url2 = getGravatarUrl('test@example.com');
      expect(url1).toBe(url2);
    });
  });
});

describe('reset tokens', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('saveResetToken', () => {
    it('saves a reset token', async () => {
      await saveResetToken({
        tokenHash: 'abc123',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      const found = await findResetToken('abc123');
      expect(found).toBeDefined();
      expect(found!.email).toBe('test@example.com');
    });

    it('replaces existing token for same email', async () => {
      await saveResetToken({
        tokenHash: 'old-token',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      await saveResetToken({
        tokenHash: 'new-token',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      const oldFound = await findResetToken('old-token');
      const newFound = await findResetToken('new-token');
      expect(oldFound).toBeUndefined();
      expect(newFound).toBeDefined();
    });
  });

  describe('findResetToken', () => {
    it('finds an existing token', async () => {
      const token = {
        tokenHash: 'abc123',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      };
      await saveResetToken(token);
      const found = await findResetToken('abc123');
      expect(found).toEqual(token);
    });

    it('returns undefined for non-existent token', async () => {
      const found = await findResetToken('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('deleteResetToken', () => {
    it('deletes a specific token', async () => {
      await saveResetToken({
        tokenHash: 'abc123',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      await deleteResetToken('abc123');
      const found = await findResetToken('abc123');
      expect(found).toBeUndefined();
    });
  });

  describe('deleteResetTokensByEmail', () => {
    it('deletes all tokens for an email', async () => {
      await saveResetToken({
        tokenHash: 'token1',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      });
      await deleteResetTokensByEmail('test@example.com');
      const found = await findResetToken('token1');
      expect(found).toBeUndefined();
    });
  });

  describe('token expiration', () => {
    it('does not filter expired tokens at DB level (expiration checked by caller)', async () => {
      const expiredToken = {
        tokenHash: 'expired',
        email: 'test@example.com',
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // expired 1 hour ago
      };
      await saveResetToken(expiredToken);
      const found = await findResetToken('expired');
      expect(found).toBeDefined(); // DB stores it, caller checks expiry
    });
  });
});

describe('JSON to DB migration', () => {
  const MIGRATION_DATA_DIR = join(process.cwd(), 'data');

  beforeEach(() => {
    cleanTestData();
    if (existsSync(MIGRATION_DATA_DIR)) {
      rmSync(MIGRATION_DATA_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    cleanTestData();
    if (existsSync(MIGRATION_DATA_DIR)) {
      rmSync(MIGRATION_DATA_DIR, { recursive: true, force: true });
    }
  });

  it('imports users from JSON file', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const users = [
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        passwordHash: '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01',
        createdAt: '2025-01-01T00:00:00.000Z',
        plan: 'creator_monthly',
      },
      {
        id: 'user-2',
        email: 'bob@example.com',
        name: 'Bob',
        passwordHash: '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ02',
        createdAt: '2025-02-01T00:00:00.000Z',
        plan: 'free',
      },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    const result = await migrateFromJson();
    expect(result.users).toBe(2);
    expect(result.errors).toHaveLength(0);

    // Verify users are in DB
    const alice = await findUserByEmail('alice@example.com');
    expect(alice).toBeDefined();
    expect(alice!.name).toBe('Alice');
    expect(alice!.plan).toBe('creator_monthly');
    expect(alice!.passwordHash).toBe(users[0].passwordHash); // preserved exactly

    const bob = await findUserByEmail('bob@example.com');
    expect(bob).toBeDefined();
    expect(bob!.name).toBe('Bob');

    // Verify backup was created
    expect(existsSync(join(MIGRATION_DATA_DIR, 'users.json.bak'))).toBe(true);
    expect(existsSync(join(MIGRATION_DATA_DIR, 'users.json'))).toBe(false);
  });

  it('imports reset tokens from JSON file', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const tokens = [
      {
        tokenHash: 'token-hash-1',
        email: 'alice@example.com',
        expiresAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'reset-tokens.json'), JSON.stringify(tokens, null, 2));

    const result = await migrateFromJson();
    expect(result.tokens).toBe(1);
    expect(result.errors).toHaveLength(0);

    const found = await findResetToken('token-hash-1');
    expect(found).toBeDefined();
    expect(found!.email).toBe('alice@example.com');

    // Verify backup was created
    expect(existsSync(join(MIGRATION_DATA_DIR, 'reset-tokens.json.bak'))).toBe(true);
  });

  it('is idempotent — does not re-migrate if backup already exists', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const users = [
      {
        id: 'user-1',
        email: 'alice@example.com',
        name: 'Alice',
        passwordHash: 'hash1',
        createdAt: '2025-01-01T00:00:00.000Z',
        plan: 'free',
      },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    // First migration
    const result1 = await migrateFromJson();
    expect(result1.users).toBe(1);

    // Second migration — no source file exists
    const result2 = await migrateFromJson();
    expect(result2.users).toBe(0);

    // User still exists
    const alice = await findUserByEmail('alice@example.com');
    expect(alice).toBeDefined();
  });

  it('handles invalid JSON gracefully', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), 'not valid json {{{');

    const result = await migrateFromJson();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Failed to read/parse users.json');

    // Original file preserved (no backup created)
    expect(existsSync(join(MIGRATION_DATA_DIR, 'users.json'))).toBe(true);
    expect(existsSync(join(MIGRATION_DATA_DIR, 'users.json.bak'))).toBe(false);
  });

  it('skips invalid user records and imports valid ones', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const users = [
      { id: 'user-1', email: 'good@example.com', name: 'Good', passwordHash: 'hash', createdAt: '2025-01-01T00:00:00.000Z', plan: 'free' },
      { id: 'user-2', name: 'Missing Email' }, // invalid — missing email
      { id: 'user-3', email: 'also-good@example.com', name: 'Also Good', passwordHash: 'hash2', createdAt: '2025-01-01T00:00:00.000Z', plan: 'pro_monthly' },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    const result = await migrateFromJson();
    expect(result.users).toBe(2);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('1 invalid users skipped');

    const good = await findUserByEmail('good@example.com');
    expect(good).toBeDefined();
    const alsoGood = await findUserByEmail('also-good@example.com');
    expect(alsoGood).toBeDefined();
  });

  it('does not re-hash existing password hashes', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const originalHash = '$2b$12$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01';
    const users = [
      { id: 'user-1', email: 'test@example.com', name: 'Test', passwordHash: originalHash, createdAt: '2025-01-01T00:00:00.000Z', plan: 'free' },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    await migrateFromJson();

    const user = await findUserByEmail('test@example.com');
    expect(user!.passwordHash).toBe(originalHash); // exact same hash, not re-hashed
  });

  it('preserves plan type from JSON', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const users = [
      { id: 'user-1', email: 'test@example.com', name: 'Test', passwordHash: 'hash', createdAt: '2025-01-01T00:00:00.000Z', plan: 'pro_yearly' },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    await migrateFromJson();
    const user = await findUserByEmail('test@example.com');
    expect(user!.plan).toBe('pro_yearly');
  });

  it('defaults invalid plan values to free', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const users = [
      { id: 'user-1', email: 'test@example.com', name: 'Test', passwordHash: 'hash', createdAt: '2025-01-01T00:00:00.000Z', plan: 'invalid_plan' },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    await migrateFromJson();
    const user = await findUserByEmail('test@example.com');
    expect(user!.plan).toBe('free');
  });

  it('handles missing JSON files gracefully', async () => {
    // No data/ directory at all
    const result = await migrateFromJson();
    expect(result.users).toBe(0);
    expect(result.tokens).toBe(0);
    expect(result.errors).toHaveLength(0);
  });

  it('preserves existing users when importing (does not overwrite)', async () => {
    mkdirSync(MIGRATION_DATA_DIR, { recursive: true });
    const users = [
      { id: 'user-1', email: 'test@example.com', name: 'Imported', passwordHash: 'imported-hash', createdAt: '2025-01-01T00:00:00.000Z', plan: 'free' },
    ];
    writeFileSync(join(MIGRATION_DATA_DIR, 'users.json'), JSON.stringify(users, null, 2));

    // First migration
    await migrateFromJson();

    // User exists with imported data
    const user1 = await findUserByEmail('test@example.com');
    expect(user1!.name).toBe('Imported');

    // Run migration again (no source file, but user persists)
    await migrateFromJson();
    const user2 = await findUserByEmail('test@example.com');
    expect(user2!.name).toBe('Imported');
  });
});
