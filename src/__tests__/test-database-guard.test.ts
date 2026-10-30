import { describe, it, expect, afterEach, vi } from 'vitest';

/**
 * The test-database guard is the only thing standing between an exported
 * production `DATABASE_URL` and a `TRUNCATE` of every application table, so its
 * decisions are pinned here. Nothing in this file opens a connection: every URL
 * below is an unroutable localhost address that exists only to exercise the
 * string predicate.
 */

const ORIGINAL = {
  DATABASE_URL: process.env.DATABASE_URL,
  ALLOW_TEST_DB: process.env.ALLOW_TEST_DB,
};

function restore() {
  if (ORIGINAL.DATABASE_URL === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = ORIGINAL.DATABASE_URL;
  if (ORIGINAL.ALLOW_TEST_DB === undefined) delete process.env.ALLOW_TEST_DB;
  else process.env.ALLOW_TEST_DB = ORIGINAL.ALLOW_TEST_DB;
}

async function loadDecision(databaseUrl: string | undefined, allow?: string) {
  vi.resetModules();
  if (databaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = databaseUrl;
  if (allow === undefined) delete process.env.ALLOW_TEST_DB;
  else process.env.ALLOW_TEST_DB = allow;
  return import('@/__tests__/helpers/test-database');
}

afterEach(restore);

describe('test database guard', () => {
  it('treats an unset URL as "no test database" without flagging production', async () => {
    const decision = await loadDecision(undefined);
    expect(decision.LOOKS_PRODUCTION).toBe(false);
    expect(decision.HAS_TEST_DB).toBe(false);
  });

  it('refuses a URL carrying a production marker', async () => {
    for (const url of [
      'postgresql://user:pw@127.0.0.1:1/prod',
      'postgresql://user:pw@127.0.0.1:1/supersmartx_studio',
      'postgresql://user:pw@127.0.0.1:1/db.supabase.com',
    ]) {
      const decision = await loadDecision(url);
      expect(decision.LOOKS_PRODUCTION, url).toBe(true);
      expect(decision.HAS_TEST_DB, url).toBe(false);
    }
  });

  it('accepts an ordinary disposable URL', async () => {
    const decision = await loadDecision('postgresql://user:pw@127.0.0.1:1/throwaway');
    expect(decision.LOOKS_PRODUCTION).toBe(false);
    expect(decision.HAS_TEST_DB).toBe(true);
  });

  it('honours the explicit override', async () => {
    const decision = await loadDecision('postgresql://user:pw@127.0.0.1:1/prod', '1');
    expect(decision.LOOKS_PRODUCTION).toBe(false);
    expect(decision.HAS_TEST_DB).toBe(true);
  });

  it('aborts the whole run before any test body when the URL looks deployed', async () => {
    vi.resetModules();
    process.env.DATABASE_URL = 'postgresql://user:pw@127.0.0.1:1/prod';
    delete process.env.ALLOW_TEST_DB;

    await expect(import('@/__tests__/setup')).rejects.toThrow(/Refusing to run tests/);
  });
});
