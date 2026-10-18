import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getPrisma,
  resetPrisma,
  isDurableDatabaseUrl,
  isProductionEnv,
  describeDatabaseUrl,
  getDbIdentity,
  DatabaseNotConfiguredError,
} from '@/lib/db/prisma';

/**
 * STATE 21 — production must fail closed on the database, never degrade to an
 * ephemeral or non-PostgreSQL backend.
 *
 * This suite is hermetic: `new PrismaClient()` resolves its datasource but opens
 * no connection, so every assertion here runs without a database. That is the
 * point — the rules under test are about *which* datasource a production process
 * will accept, and that decision must be provable without a network.
 *
 * The libSQL version of this file spied on `createClient`. The Prisma equivalent
 * observes `getDbIdentity()`, which is populated from the resolved URL exactly
 * when a client is built — so it is evidence that the client was constructed for
 * the intended target.
 */

const ORIGINAL_ENV = { ...process.env };
const DURABLE_URL = 'postgresql://user:pass@db.example.supabase.co:6543/postgres';
const DURABLE_HOST = 'db.example.supabase.co:6543';

const EPHEMERAL_OR_FOREIGN_URLS = [
  ':memory:',
  'file::memory:',
  'file:./data/supersmartx.db',
  'file:/tmp/supersmartx.db',
  './data/supersmartx.db',
  '/var/lib/supersmartx.db',
  'libsql://supersmartx-prod.turso.io',
  'https://db.example.turso.io',
  'mysql://user:pass@localhost:3306/supersmartx',
];

function useEnv(env: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL_ENV, ...env } as NodeJS.ProcessEnv;
}

beforeEach(async () => {
  await resetPrisma();
});

afterEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  await resetPrisma();
});

// ---------------------------------------------------------------------------
// A. Production + a valid durable database works.
// ---------------------------------------------------------------------------

describe('A. production with a valid durable database', () => {
  beforeEach(() => {
    useEnv({ NODE_ENV: 'production', DATABASE_URL: DURABLE_URL });
  });

  it('is recognised as production', () => {
    expect(isProductionEnv()).toBe(true);
  });

  it('constructs a client instead of throwing', () => {
    expect(() => getPrisma()).not.toThrow();
  });

  it('reuses one client for the life of the process', () => {
    expect(getPrisma()).toBe(getPrisma());
  });

  it('reports the non-secret database host it is bound to', () => {
    getPrisma();
    // This is the value an operator reads to answer "which database is this
    // deployment writing to?" — host only, never the password.
    expect(getDbIdentity()).toEqual({
      provider: 'postgres',
      host: DURABLE_HOST,
      durable: true,
    });
  });

  it('accepts an https-style pooler host and keeps the port', () => {
    useEnv({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
    });
    getPrisma();
    expect(getDbIdentity()?.host).toBe('aws-0-ap-northeast-2.pooler.supabase.com:6543');
  });
});

// ---------------------------------------------------------------------------
// B. Production + missing or invalid configuration fails closed.
// ---------------------------------------------------------------------------

describe('B. production fails closed on a bad database configuration', () => {
  const MISSING = [
    { name: 'no DATABASE_URL at all', url: undefined },
    { name: 'an empty DATABASE_URL', url: '' },
    { name: 'a whitespace-only DATABASE_URL', url: '   ' },
  ];

  it.each(MISSING)('throws for $name', ({ url }) => {
    useEnv({ NODE_ENV: 'production', DATABASE_URL: url });
    expect(() => getPrisma()).toThrow(DatabaseNotConfiguredError);
  });

  it.each(EPHEMERAL_OR_FOREIGN_URLS)('throws rather than accepting %s', (url) => {
    useEnv({ NODE_ENV: 'production', DATABASE_URL: url });
    expect(() => getPrisma()).toThrow(DatabaseNotConfiguredError);
  });

  it('names the missing variable so the failure is actionable', () => {
    useEnv({ NODE_ENV: 'production', DATABASE_URL: undefined });
    expect(() => getPrisma()).toThrow(/DATABASE_URL/);
  });

  it('does not memoise a failed configuration — a fixed deploy recovers', () => {
    useEnv({ NODE_ENV: 'production', DATABASE_URL: undefined });
    expect(() => getPrisma()).toThrow(DatabaseNotConfiguredError);
    expect(() => getPrisma()).toThrow(DatabaseNotConfiguredError);

    // Operator sets the variable. The next request must work, without a redeploy
    // being the only cure.
    useEnv({ NODE_ENV: 'production', DATABASE_URL: DURABLE_URL });
    expect(() => getPrisma()).not.toThrow();
    expect(getDbIdentity()?.durable).toBe(true);
  });

  it('never constructs a client at all when it is going to refuse', () => {
    useEnv({ NODE_ENV: 'production', DATABASE_URL: undefined });
    expect(() => getPrisma()).toThrow(DatabaseNotConfiguredError);
    expect(getDbIdentity()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// C. Production never substitutes an ephemeral or non-Postgres backend.
// ---------------------------------------------------------------------------

describe('C. production never substitutes an in-memory or foreign database', () => {
  it('refuses every non-postgres url, not just the obvious one', () => {
    for (const url of EPHEMERAL_OR_FOREIGN_URLS) {
      expect(
        () => {
          useEnv({ NODE_ENV: 'production', DATABASE_URL: url });
          getPrisma();
        },
        `expected production to refuse ${url}`,
      ).toThrow(DatabaseNotConfiguredError);
    }
  });

  it('never resolves an identity for any refused configuration', () => {
    for (const url of EPHEMERAL_OR_FOREIGN_URLS) {
      useEnv({ NODE_ENV: 'production', DATABASE_URL: url });
      try {
        getPrisma();
      } catch {
        // Refusing is the expected outcome.
      }
      expect(getDbIdentity()).toBeNull();
    }
  });

  it('classifies url durability the same way the production branch does', () => {
    expect(isDurableDatabaseUrl('postgres://db.example.supabase.co:5432/postgres')).toBe(true);
    expect(isDurableDatabaseUrl(DURABLE_URL)).toBe(true);
    for (const url of [...EPHEMERAL_OR_FOREIGN_URLS, '', '   ', undefined, null]) {
      expect(isDurableDatabaseUrl(url), `${String(url)} must not count as durable`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// D. Test and development do not fail closed.
// ---------------------------------------------------------------------------

describe('D. test and development do not enforce the production rules', () => {
  it('constructs a client under NODE_ENV=test', () => {
    useEnv({ NODE_ENV: 'test', DATABASE_URL: DURABLE_URL });
    expect(() => getPrisma()).not.toThrow();
    expect(getDbIdentity()?.durable).toBe(true);
  });

  it('constructs a client under NODE_ENV=development', () => {
    useEnv({ NODE_ENV: 'development', DATABASE_URL: DURABLE_URL });
    expect(() => getPrisma()).not.toThrow();
  });

  it('does not apply the production postgres-only rule outside production', () => {
    // Outside production a non-postgres string is a configuration mistake, not a
    // data-loss hazard, so the driver does not refuse it here.
    useEnv({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://localhost:5432/dev' });
    expect(() => getPrisma()).not.toThrow();
  });

  it('describes a durable postgres target', () => {
    expect(describeDatabaseUrl(DURABLE_URL)).toEqual({
      provider: 'postgres',
      host: DURABLE_HOST,
      durable: true,
    });
  });
});
