import { beforeEach } from 'vitest';
import { getPrisma } from '@/lib/db/prisma';
import { HAS_TEST_DB } from './test-database';

/**
 * Postgres replacement for the retired libSQL test driver.
 *
 * The old unit tests got isolation for free: every test file opened
 * `file::memory:`, so `resetDb()` merely dropped the client and the next query
 * started from an empty database. PostgreSQL has no per-test in-memory mode, so
 * isolation is reproduced explicitly — when `DATABASE_URL` is present, every
 * test that imports this module starts with an empty database, cleared by a
 * `TRUNCATE … CASCADE` registered below.
 *
 * The clear is defensive: a transient deadlock is retried a bounded number of
 * times (then surfaced, never swallowed), and a table dropped by a fault
 * injection is rebuilt so one test cannot break the rest of the run.
 *
 * The suite is gated on `DATABASE_URL` (see the `describeDb` guard each file
 * uses), so `npm test` without credentials runs the ordinary unit suite and the
 * database-backed cases are reported as skipped rather than failing. A URL that
 * looks like the deployed database does not count as a test database — see
 * `./test-database` — so exporting the production value from `.env.local`
 * cannot turn this `TRUNCATE` loose on real accounts.
 */

export { HAS_TEST_DB };

const APP_TABLES = [
  'users',
  'reset_tokens',
  'user_stats',
  'exports',
  'export_jobs',
  'processed_webhooks',
  'pending_orders',
  'checkout_locks',
  'monthly_export_counts',
  'daily_recording_seconds',
  'order_notifications',
  'deleted_identities',
  'schema_meta',
];

// The only table a fault-injection test (state-machine-certification) drops, so
// the only one the harness needs to be able to rebuild. Mirrors the 0_init
// migration exactly (types, default, primary key).
const REPAIR_DDL: Record<string, string> = {
  order_notifications: `CREATE TABLE IF NOT EXISTS "order_notifications" (
    "order_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "order_notifications_pkey" PRIMARY KEY ("order_id","kind")
  )`,
};

/**
 * Extracts the PostgreSQL SQLSTATE. Prisma wraps raw-query failures with the
 * code in `meta.code`; a plain `code` is also accepted so this keeps working if
 * Prisma changes the shape.
 */
function sqlState(error: unknown): string | undefined {
  const wrapped = error as { code?: unknown; meta?: { code?: unknown } } | null;
  if (typeof wrapped?.meta?.code === 'string') return wrapped.meta.code;
  if (typeof wrapped?.code === 'string') return wrapped.code;
  return undefined;
}

const UNDEFINED_TABLE = '42P01';
const DEADLOCK = '40P01';
const TRUNCATE_MAX_ATTEMPTS = 5;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

async function truncateAll(): Promise<void> {
  const prisma = getPrisma();
  const allTables = `TRUNCATE TABLE ${APP_TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`;

  // Fast path: one statement clears every table. A deadlock (`40P01`) here is a
  // transient collision between this AccessExclusiveLock and a transaction that
  // is still settling from the previous test, so retry a bounded number of times
  // and then surface it — an unbounded retry would hide a genuinely leaked
  // transaction.
  for (let attempt = 1; attempt <= TRUNCATE_MAX_ATTEMPTS; attempt++) {
    try {
      await prisma.$executeRawUnsafe(allTables);
      return;
    } catch (error) {
      const state = sqlState(error);

      if (state === DEADLOCK) {
        if (attempt === TRUNCATE_MAX_ATTEMPTS) throw error;
        console.warn(
          `[db-test-harness] TRUNCATE deadlock; retry ${attempt}/${TRUNCATE_MAX_ATTEMPTS}`,
        );
        await sleep(100 * attempt);
        continue;
      }

      if (state !== UNDEFINED_TABLE) throw error;

      // A fault-injection test dropped a table, which makes the all-tables
      // statement fail atomically. Fall through to repair known tables, then
      // clear each remaining one so a missing table cannot cascade into
      // unrelated suites.
      break;
    }
  }

  for (const [table, ddl] of Object.entries(REPAIR_DDL)) {
    if (!APP_TABLES.includes(table)) continue;
    await prisma.$executeRawUnsafe(ddl);
  }
  for (const table of APP_TABLES) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    } catch (error) {
      if (sqlState(error) !== UNDEFINED_TABLE) throw error;
    }
  }
}

if (HAS_TEST_DB) {
  // Registered at import time so it applies only to files that pull in the
  // harness (the database-backed suites). Runs before each test, ahead of any
  // suite-level `beforeEach`, because it is registered first.
  beforeEach(async () => {
    await truncateAll();
  });
}

/**
 * Retained for call-site compatibility. Isolation is provided by the per-test
 * `TRUNCATE` above; the pooled Prisma client is deliberately kept alive across
 * tests (`resetDb` used to drop an in-memory client, but reconnecting per test
 * would only churn connections against a real server).
 */
export function resetDb(): void {
  // no-op
}

/** Back-compat alias for the migrator's memo reset. */
export { setMigrated } from '@/lib/db';

type Statement = string | { sql: string; args?: unknown[] };

export interface CompatResult {
  rows: Record<string, unknown>[];
  rowsAffected: number;
}

function isRowReturning(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql) || /\breturning\b/i.test(sql);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * libSQL treated every parameter as dynamically typed; PostgreSQL does not. A
 * JS string is sent as `text`, which cannot be assigned to or compared against a
 * `timestamptz` column without a cast. Tests that bind ISO timestamps (backdating
 * a row, asserting an expiry window) therefore bind them as `Date`s, which
 * Prisma sends as timestamps.
 */
function bindArg(value: unknown): unknown {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) ? new Date(value) : value;
}

/**
 * Prisma hands back `Date` for `timestamptz`, `bigint` for `BIGINT`, and
 * `Prisma.Decimal` for `numeric`. The old libSQL results carried ISO strings and
 * `number`s, and the tests assert on those shapes (`toBe` between two
 * timestamps, `Number(rows[0].c)` for a `COUNT`). Normalising here keeps every
 * existing assertion meaningful.
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (typeof value === 'bigint') {
      out[key] = Number(value);
    } else if (
      value !== null &&
      typeof value === 'object' &&
      typeof (value as { toNumber?: unknown }).toNumber === 'function'
    ) {
      out[key] = Number(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Minimal `getDb()` stand-in for tests that use raw SQL to seed or inspect
 * state. Translates libSQL `?` placeholders to Postgres `$n` and routes
 * row-returning statements to `$queryRawUnsafe`.
 */
export function getDb() {
  const prisma = getPrisma();
  const adapter = {
    async execute(statement: Statement): Promise<CompatResult> {
      const raw = typeof statement === 'string' ? statement : statement.sql;
      const args = (typeof statement === 'string' ? [] : statement.args ?? []).map(bindArg);
      let index = 0;
      const sql = raw.replace(/\?/g, () => `$${++index}`);
      if (isRowReturning(sql)) {
        const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql, ...args);
        const list = Array.isArray(rows) ? rows.map(normalizeRow) : [];
        return { rows: list, rowsAffected: list.length };
      }
      const rowsAffected = await prisma.$executeRawUnsafe(sql, ...args);
      return { rows: [], rowsAffected };
    },
    async batch(statements: Statement[]): Promise<CompatResult[]> {
      const results: CompatResult[] = [];
      for (const statement of statements) {
        results.push(await adapter.execute(statement));
      }
      return results;
    },
  };
  return adapter;
}
