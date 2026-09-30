import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * STATE 21 — production must fail closed on the database, never degrade to
 * `:memory:`.
 *
 * The client is built through a spy that records the URL it was asked for and
 * then hands back a real in-memory libsql client. Two things follow, and both
 * matter:
 *
 *  - the recorded URL is the assertion that matters (which branch of getDb ran),
 *    so a misconfiguration cannot be masked by the substitute;
 *  - the substitute means these tests are hermetic. A real `libsql://` endpoint
 *    is not reachable from a unit test, and a test that needed one would be a
 *    test that silently passed or failed on network state.
 */

const { createClientSpy } = vi.hoisted(() => ({ createClientSpy: vi.fn() }));

vi.mock('@libsql/client', async () => {
  const actual = await vi.importActual<typeof import('@libsql/client')>('@libsql/client');
  return {
    ...actual,
    createClient: (config: { url: string; authToken?: string }) => {
      createClientSpy(config);
      // Stand in a real, working client so the layer above the driver is
      // genuinely exercised. The requested URL is already recorded above.
      return actual.createClient({ url: 'file::memory:', authToken: config.authToken });
    },
  };
});

import {
  getDb,
  resetDb,
  isDurableDb,
  isDurableDatabaseUrl,
  isProductionEnv,
  DatabaseNotConfiguredError,
} from '@/lib/db/driver';
import { setMigrated, createUser, findUserByEmail, findPendingOrder, createPendingOrder, tryClaimWebhookOrder } from '@/lib/db';

const ORIGINAL_ENV = { ...process.env };
const DURABLE_URL = 'libsql://supersmartx-prod.turso.io';
const DURABLE_TOKEN = 'prod-token';

function urlsRequested(): string[] {
  return createClientSpy.mock.calls.map((call) => (call[0] as { url: string }).url);
}

function useEnv(env: Record<string, string | undefined>): void {
  process.env = { ...ORIGINAL_ENV, ...env } as NodeJS.ProcessEnv;
}

beforeEach(() => {
  createClientSpy.mockClear();
  resetDb();
  setMigrated(false);
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetDb();
  setMigrated(false);
});

// ---------------------------------------------------------------------------
// A. Production + a valid durable database works.
// ---------------------------------------------------------------------------

describe('A. production with a valid durable database', () => {
  beforeEach(() => {
    useEnv({
      NODE_ENV: 'production',
      TURSO_DATABASE_URL: DURABLE_URL,
      TURSO_AUTH_TOKEN: DURABLE_TOKEN,
    });
  });

  it('is recognised as production', () => {
    expect(isProductionEnv()).toBe(true);
  });

  it('connects instead of throwing, and forwards the url and token', () => {
    const client = getDb();
    expect(client).toBeTruthy();
    expect(urlsRequested()).toEqual([DURABLE_URL]);
    expect(createClientSpy.mock.calls[0][0]).toMatchObject({
      url: DURABLE_URL,
      authToken: DURABLE_TOKEN,
    });
  });

  it('reports the connection as durable', () => {
    expect(isDurableDb()).toBe(false); // nothing opened yet
    getDb();
    expect(isDurableDb()).toBe(true);
  });

  it('serves the whole db layer, including payment state, on the durable branch', async () => {
    // The point of the exercise: a production-mode process must be able to read
    // and write the rows that money depends on.
    const user = await createUser('prod-buyer@example.com', 'Buyer', 'hash');
    expect((await findUserByEmail('prod-buyer@example.com'))?.id).toBe(user.id);

    const orderId = 'sxs-prod-order';
    await createPendingOrder({ orderId, userId: user.id, plan: 'creator_monthly', amount: 349, currency: 'INR' });
    expect((await findPendingOrder(orderId))?.userId).toBe(user.id);

    // The fulfilment claim, the exact row a duplicate webhook races for.
    expect(await tryClaimWebhookOrder(orderId)).toBe(true);
    expect(await tryClaimWebhookOrder(orderId)).toBe(false);

    expect(isDurableDb()).toBe(true);
  });

  it('accepts an https:// endpoint as well as libsql://', () => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: 'https://db.example.turso.io', TURSO_AUTH_TOKEN: 't' });
    expect(() => getDb()).not.toThrow();
    expect(urlsRequested()).toEqual(['https://db.example.turso.io']);
  });

  it('reuses one client for the life of the process', () => {
    getDb();
    getDb();
    getDb();
    expect(urlsRequested()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// B. Production + missing or invalid configuration fails closed.
// ---------------------------------------------------------------------------

describe('B. production fails closed on a bad database configuration', () => {
  const MISSING = [
    { name: 'no TURSO_DATABASE_URL at all', env: { TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 't' } },
    { name: 'an empty TURSO_DATABASE_URL', env: { TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: 't' } },
    { name: 'a whitespace-only TURSO_DATABASE_URL', env: { TURSO_DATABASE_URL: '   ', TURSO_AUTH_TOKEN: 't' } },
  ];

  const EPHEMERAL = [
    { name: ':memory:', url: ':memory:' },
    { name: 'file::memory:', url: 'file::memory:' },
    { name: 'a local SQLite file', url: 'file:./data/supersmartx.db' },
    { name: 'a bare filesystem path', url: './data/supersmartx.db' },
  ];

  it.each(MISSING)('throws for $name', ({ env }) => {
    useEnv({ NODE_ENV: 'production', ...env });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
  });

  it.each(EPHEMERAL)('throws rather than accepting $name', ({ url }) => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: 't' });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
  });

  it('throws when a remote url has no auth token', () => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: DURABLE_URL, TURSO_AUTH_TOKEN: undefined });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
  });

  it('throws when a remote url has an empty auth token', () => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: DURABLE_URL, TURSO_AUTH_TOKEN: '  ' });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
  });

  it('names the missing variable so the failure is actionable', () => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 't' });
    expect(() => getDb()).toThrow(/TURSO_DATABASE_URL/);
  });

  it('does not memoise a failed configuration — a fixed deploy recovers', () => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 't' });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);

    // Operator sets the variable. The next request must work, without a redeploy
    // being the only cure.
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: DURABLE_URL, TURSO_AUTH_TOKEN: DURABLE_TOKEN });
    expect(() => getDb()).not.toThrow();
    expect(isDurableDb()).toBe(true);
  });

  it('never opens a client at all when it is going to refuse', () => {
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 't' });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
    expect(createClientSpy).not.toHaveBeenCalled();
    expect(isDurableDb()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C. Production never falls back to :memory:.
// ---------------------------------------------------------------------------

describe('C. production never substitutes an in-memory database', () => {
  const EVERY_EPHEMERAL_URL = [
    ':memory:',
    'file::memory:',
    'file:./data/supersmartx.db',
    'file:/tmp/supersmartx.db',
    './data/supersmartx.db',
    '/var/lib/supersmartx.db',
  ];

  it('refuses every ephemeral url, not just the obvious one', () => {
    for (const url of EVERY_EPHEMERAL_URL) {
      resetDb();
      useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: 't' });
      expect(() => getDb(), `expected production to refuse ${url}`).toThrow(DatabaseNotConfiguredError);
    }
  });

  it('never asks libsql for :memory: under any production configuration', () => {
    // The regression this file exists for. Sweep the whole space of production
    // configs and assert the string ":memory:" is never requested.
    const configs: Array<Record<string, string | undefined>> = [
      { TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 't' },
      { TURSO_DATABASE_URL: '', TURSO_AUTH_TOKEN: 't' },
      { TURSO_DATABASE_URL: '   ', TURSO_AUTH_TOKEN: undefined },
      ...EVERY_EPHEMERAL_URL.map((url) => ({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: 't' })),
      ...EVERY_EPHEMERAL_URL.map((url) => ({ TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: undefined })),
      { TURSO_DATABASE_URL: DURABLE_URL, TURSO_AUTH_TOKEN: undefined },
      { TURSO_DATABASE_URL: DURABLE_URL, TURSO_AUTH_TOKEN: DURABLE_TOKEN },
    ];

    for (const env of configs) {
      resetDb();
      useEnv({ NODE_ENV: 'production', ...env });
      try {
        getDb();
      } catch {
        // Refusing is the expected outcome for most of these.
      }
    }

    expect(urlsRequested()).not.toContain(':memory:');
    expect(urlsRequested().filter((url) => url.includes('memory'))).toEqual([]);
  });

  it('cannot reach the local-file fallback either, even if the filesystem is writable', () => {
    // The old chain had two non-durable branches in production, not one.
    useEnv({ NODE_ENV: 'production', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: 't' });
    expect(() => getDb()).toThrow(DatabaseNotConfiguredError);
    expect(urlsRequested()).toEqual([]);
  });

  it('classifies url durability the same way the production branch does', () => {
    expect(isDurableDatabaseUrl('libsql://db.turso.io')).toBe(true);
    expect(isDurableDatabaseUrl('https://db.turso.io')).toBe(true);
    for (const url of [...EVERY_EPHEMERAL_URL, '', '   ', undefined, null]) {
      expect(isDurableDatabaseUrl(url), `${String(url)} must not count as durable`).toBe(false);
    }
  });

  it('reports an in-memory connection as not durable', () => {
    useEnv({ NODE_ENV: 'test', TURSO_DATABASE_URL: 'file::memory:' });
    getDb();
    expect(isDurableDb()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// D. Test and development keep their existing, explicit database behaviour.
// ---------------------------------------------------------------------------

describe('D. test and development keep their existing database behaviour', () => {
  it('honours the suite\'s explicit file::memory: request under NODE_ENV=test', async () => {
    useEnv({ NODE_ENV: 'test', TURSO_DATABASE_URL: 'file::memory:' });
    const user = await createUser('test-buyer@example.com', 'Buyer', 'hash');
    expect((await findUserByEmail('test-buyer@example.com'))?.id).toBe(user.id);
    expect(urlsRequested()).toEqual(['file::memory:']);
  });

  it('honours it under NODE_ENV=development too', async () => {
    useEnv({ NODE_ENV: 'development', TURSO_DATABASE_URL: 'file::memory:' });
    const user = await createUser('dev-buyer@example.com', 'Buyer', 'hash');
    expect((await findUserByEmail('dev-buyer@example.com'))?.id).toBe(user.id);
  });

  it('still lets the payment ledger be exercised in test', async () => {
    useEnv({ NODE_ENV: 'test', TURSO_DATABASE_URL: 'file::memory:' });
    const user = await createUser('ledger@example.com', 'Buyer', 'hash');
    await createPendingOrder({ orderId: 'o1', userId: user.id, plan: 'creator_monthly', amount: 349, currency: 'INR' });
    expect(await tryClaimWebhookOrder('o1')).toBe(true);
    expect(await tryClaimWebhookOrder('o1')).toBe(false);
  });

  it('falls back to a local file, not :memory:, when development sets no url', () => {
    useEnv({ NODE_ENV: 'development', TURSO_DATABASE_URL: undefined, TURSO_AUTH_TOKEN: undefined });
    getDb();
    const requested = urlsRequested();
    expect(requested).toHaveLength(1);
    expect(requested[0]).toMatch(/^file:.*supersmartx\.db$/);
    expect(requested[0]).not.toContain('memory');
    // A local file is a real developer database: durable across restarts on
    // that host, which is why it is allowed here and refused in production.
    expect(isDurableDb()).toBe(false);
  });

  it('uses a remote url verbatim in development without requiring a token', () => {
    useEnv({ NODE_ENV: 'development', TURSO_DATABASE_URL: 'libsql://dev.turso.io', TURSO_AUTH_TOKEN: undefined });
    getDb();
    expect(urlsRequested()).toEqual(['libsql://dev.turso.io']);
    expect(isDurableDb()).toBe(true);
  });
});
