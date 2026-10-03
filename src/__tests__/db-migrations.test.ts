import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Client } from '@libsql/client';

import { MIGRATIONS, SCHEMA_VERSION, migrate } from '@/lib/db/schema';
import { resetDb, getDb } from '@/lib/db/driver';

/**
 * The runner must treat `schema_meta.schema_version` as a VERSION, not as a
 * positional index into a flat statement array.
 *
 * The defect this locks down: `SCHEMA_VERSION` was 12 while the migration array
 * held 39 statements, and the loop was `for (i = storedVersion; i < length; i++)`.
 * Appending version 13 therefore replayed the tail of the list — including
 * version 10's `DROP TABLE exports` → copy → `RENAME` rebuild and the
 * `user_stats` rebuild — over a live production database.
 *
 * These tests drive the real `migrate()` against a real libSQL/SQLite client and
 * reconstruct a genuine v12 database first, so the upgrade path is exercised
 * end to end rather than described.
 */

const V12 = 12;

function cleanTestData() {
  resetDb();
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

/** Applies groups up to and including `targetVersion`, exactly as production does. */
async function buildDatabaseAtVersion(db: Client, targetVersion: number): Promise<void> {
  for (const migration of MIGRATIONS) {
    if (migration.version > targetVersion) break;
    for (const statement of migration.statements) {
      try {
        await db.execute(statement);
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
        if (msg.includes('duplicate') || msg.includes('already exists')) continue;
        throw e;
      }
    }
    await db.execute({
      sql: 'INSERT OR REPLACE INTO schema_meta (key, value) VALUES (?, ?)',
      args: ['schema_version', String(migration.version)],
    });
  }
}

async function tableExists(db: Client, table: string): Promise<boolean> {
  const result = await db.execute({
    sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    args: [table],
  });
  return result.rows.length > 0;
}

async function storedVersion(db: Client): Promise<string | undefined> {
  const result = await db.execute("SELECT value FROM schema_meta WHERE key = 'schema_version'");
  return result.rows[0] ? String(result.rows[0].value) : undefined;
}

describe('schema migration ledger', () => {
  beforeEach(cleanTestData);
  afterEach(cleanTestData);

  it('versions are contiguous from 1 and SCHEMA_VERSION is the last one', () => {
    expect(MIGRATIONS.map((m) => m.version)).toEqual(
      Array.from({ length: MIGRATIONS.length }, (_, i) => i + 1),
    );
    expect(SCHEMA_VERSION).toBe(MIGRATIONS[MIGRATIONS.length - 1].version);
  });

  it('introduces version 13 without renumbering any historical group', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toContain(12);
    expect(versions).toContain(13);
    expect(versions.filter((v) => v === 12)).toHaveLength(1);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(13);
  });
});

describe('migrate(): v12 production database upgraded to v13', () => {
  beforeEach(cleanTestData);
  afterEach(cleanTestData);

  it('applies only the new group and leaves exports, user_stats and their rows intact', async () => {
    const db = getDb();

    // 1. Migrate a database up to the version already live in production.
    await buildDatabaseAtVersion(db, V12);
    expect(await storedVersion(db)).toBe(String(V12));
    expect(await tableExists(db, 'deleted_identities')).toBe(false);

    // Seed a user, an export row and a stats row that must survive.
    await db.execute({
      sql: "INSERT INTO users (id, email, name, password_hash, created_at, plan, session_version) VALUES ('u1', 'keep@example.com', 'Keep', 'hash', '2026-01-01T00:00:00.000Z', 'creator_monthly', 3)",
    });
    const job = await db.execute({
      sql: "INSERT INTO export_jobs (id, user_id, config_json, status, created_at) VALUES ('j1', 'u1', '{}', 'completed', '2026-01-01T00:00:00.000Z')",
    });
    expect(job.rows.length).toBe(0);
    await db.execute({
      sql: `INSERT INTO exports (id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id)
            VALUES ('e1', 'u1', 'exports/u1/keep.mp4', 'youtube-landscape', 1920, 1080, 12345, 'video/mp4', 'completed', '2026-01-01T00:00:00.000Z', 'j1')`,
    });
    await db.execute({
      sql: "INSERT INTO user_stats (user_id, download_count, upload_count, storage_bytes) VALUES ('u1', 7, 2, 999)",
    });
    // Rows left behind by an era when foreign keys were not enforced. The v10
    // copy/swap deliberately filters these out — which is exactly why it must
    // not be replayed. Appending a version is not a licence to re-run it.
    // Foreign-key enforcement is disabled for these two inserts only: the rows
    // are illegal by design, and this suite must not depend on whether a
    // neighbouring file happened to turn the pragma on first.
    await db.execute('PRAGMA foreign_keys = OFF');
    try {
      await db.execute({
        sql: `INSERT INTO exports (id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id)
              VALUES ('orphan-export', 'ghost', 'exports/ghost/old.mp4', 'youtube-landscape', 1280, 720, 10, 'video/mp4', 'completed', '2026-01-01T00:00:00.000Z', NULL)`,
      });
      await db.execute({
        sql: "INSERT INTO user_stats (user_id, download_count, upload_count, storage_bytes) VALUES ('ghost', 1, 1, 1)",
      });
    } finally {
      await db.execute('PRAGMA foreign_keys = ON');
    }

    // 2. Run the new build's migrator, exactly as a deploy would.
    await migrate(db);

    // 3. The stored version advanced to the new one.
    expect(await storedVersion(db)).toBe(String(SCHEMA_VERSION));

    // 4. exports still exists, with its row and every column value intact.
    expect(await tableExists(db, 'exports')).toBe(true);
    const exports = await db.execute("SELECT * FROM exports WHERE id = 'e1'");
    expect(exports.rows).toHaveLength(1);
    expect(exports.rows[0].r2_key).toBe('exports/u1/keep.mp4');
    expect(Number(exports.rows[0].file_size)).toBe(12345);
    expect(exports.rows[0].user_id).toBe('u1');
    expect(exports.rows[0].job_id).toBe('j1');

    // 5. user_stats still exists, with its row intact.
    expect(await tableExists(db, 'user_stats')).toBe(true);
    const stats = await db.execute("SELECT * FROM user_stats WHERE user_id = 'u1'");
    expect(stats.rows).toHaveLength(1);
    expect(Number(stats.rows[0].download_count)).toBe(7);
    expect(Number(stats.rows[0].storage_bytes)).toBe(999);

    // 6. The new group's table was created.
    expect(await tableExists(db, 'deleted_identities')).toBe(true);

    // 7. Neither table was rebuilt. The v10 copy/swap filters rows whose user
    //    is gone; replaying it because version 13 was appended would silently
    //    drop these two rows — data loss caused purely by a version bump.
    const orphanExport = await db.execute("SELECT id FROM exports WHERE id = 'orphan-export'");
    expect(orphanExport.rows).toHaveLength(1);
    const orphanStats = await db.execute("SELECT user_id FROM user_stats WHERE user_id = 'ghost'");
    expect(orphanStats.rows).toHaveLength(1);

    // 8. The user's session_version column survived (v10 rebuilt this table).
    const user = await db.execute("SELECT session_version FROM users WHERE id = 'u1'");
    expect(Number(user.rows[0].session_version)).toBe(3);
  });

  it('runs the new migration exactly once — a second run is a no-op', async () => {
    const db = getDb();
    await buildDatabaseAtVersion(db, V12);
    await migrate(db);
    expect(await storedVersion(db)).toBe(String(SCHEMA_VERSION));

    // Remove the artefact the new migration created. If the runner replayed
    // historical statements on a version bump it would also re-create this.
    await db.execute('DROP TABLE deleted_identities');

    await migrate(db);

    expect(await tableExists(db, 'deleted_identities')).toBe(false);
    expect(await storedVersion(db)).toBe(String(SCHEMA_VERSION));
  });

  /**
   * Each version group must be one transaction. The v10 copy/swap drops
   * `exports` and renames a rebuilt copy into its place; run one statement per
   * round trip, a failure between the DROP and the RENAME leaves a production
   * database with no exports table at all.
   *
   * `db.batch` is the atomic unit in @libsql/client (BEGIN…COMMIT, ROLLBACK on
   * any error), so this asserts the runner uses exactly one batch per version,
   * and that the version stamp travels inside that batch rather than after it.
   */
  it('applies each version group as a single transactional batch carrying its own version stamp', async () => {
    const db = getDb();
    await buildDatabaseAtVersion(db, V12);

    const batches: { statements: number; mode?: string }[] = [];
    const realBatch = db.batch.bind(db);
    const spy = vi.spyOn(db, 'batch').mockImplementation((async (stmts: any, mode?: any) => {
      batches.push({ statements: Array.isArray(stmts) ? stmts.length : 0, mode });
      return (realBatch as any)(stmts, mode);
    }) as never);

    await migrate(db);

    // v12 -> current applies v13 and v14 as separate atomic groups.
    const pendingGroups = MIGRATIONS.filter((group) => group.version > V12);
    expect(batches).toHaveLength(pendingGroups.length);
    expect(batches.every((batch) => batch.mode === 'write')).toBe(true);
    expect(batches.map((batch) => batch.statements)).toEqual(
      pendingGroups.map((group) => group.statements.length + 1),
    );
    expect(await storedVersion(db)).toBe(String(SCHEMA_VERSION));
    spy.mockRestore();

    // A fresh database takes one transaction per version, in order.
    cleanTestData();
    const fresh = getDb();
    const freshBatches: number[] = [];
    const realFreshBatch = fresh.batch.bind(fresh);
    const freshSpy = vi.spyOn(fresh, 'batch').mockImplementation((async (stmts: any, mode?: any) => {
      freshBatches.push(Array.isArray(stmts) ? stmts.length : 0);
      return (realFreshBatch as any)(stmts, mode);
    }) as never);

    await migrate(fresh);

    expect(freshBatches).toHaveLength(MIGRATIONS.length);
    freshSpy.mockRestore();
    expect(await storedVersion(fresh)).toBe(String(SCHEMA_VERSION));
  });

  it('leaves the database untouched when a group fails, and says so', async () => {
    const db = getDb();
    await buildDatabaseAtVersion(db, V12);

    const spy = vi.spyOn(db, 'batch').mockImplementation((async () => {
      // A failure in the middle of the group, exactly as a broken statement
      // would produce.
      throw new Error('SQLITE_ERROR: no such table: something_that_is_not_there');
    }) as never);

    await expect(migrate(db)).rejects.toThrow(/rolled back/i);
    spy.mockRestore();

    // Version unchanged and the new table absent: the group did not half-apply.
    expect(await storedVersion(db)).toBe(String(V12));
    expect(await tableExists(db, 'deleted_identities')).toBe(false);
  });
});

describe('migrate(): fresh database and fail-closed reads', () => {
  beforeEach(cleanTestData);
  afterEach(cleanTestData);

  it('migrates an empty database all the way to the current version', async () => {
    const db = getDb();
    await migrate(db);
    expect(await storedVersion(db)).toBe(String(SCHEMA_VERSION));
    for (const table of ['users', 'exports', 'export_jobs', 'user_stats', 'deleted_identities']) {
      expect(await tableExists(db, table)).toBe(true);
    }
  });

  it('treats an absent schema_meta table as version 0, not as a failure', async () => {
    const db = getDb();
    expect(await tableExists(db, 'schema_meta')).toBe(false);
    await migrate(db);
    expect(await storedVersion(db)).toBe(String(SCHEMA_VERSION));
  });

  it('refuses to migrate a database whose stored version is unreadable', async () => {
    const db = getDb();
    await buildDatabaseAtVersion(db, V12);
    await db.execute({
      sql: "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', 'not-a-version')",
    });

    // Silently coercing this to 0 would replay every migration — including the
    // v10 table rebuilds — over a populated database.
    await expect(migrate(db)).rejects.toThrow(/schema_version/i);
    expect(await storedVersion(db)).toBe('not-a-version');
  });

  it('refuses to run against a database newer than this build', async () => {
    const db = getDb();
    await buildDatabaseAtVersion(db, V12);
    await db.execute({
      sql: "INSERT OR REPLACE INTO schema_meta (key, value) VALUES ('schema_version', ?)",
      args: [String(SCHEMA_VERSION + 5)],
    });

    await expect(migrate(db)).rejects.toThrow(/newer than this build/i);
  });
});