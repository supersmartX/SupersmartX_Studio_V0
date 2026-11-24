import { describe, expect, it } from 'vitest';
import { getPrisma } from '@/lib/db/prisma';
import { HAS_TEST_DB } from './helpers/test-database';

// Supabase database linters 0013 (rls_disabled_in_public) and 0023
// (sensitive_columns_exposed) flagged the public tables introduced by the
// Prisma migration history because `CREATE TABLE` alone leaves RLS switched
// off. The application only touches PostgreSQL through the privileged Prisma
// connection owner (which bypasses RLS as table owner, as does the Supabase
// `service_role`), so RLS with no policies is effectively deny-all for the
// PostgREST `anon`/`authenticated` roles and changes no application behaviour.
//
// This suite asserts the invariant going forward: on any migrated database,
// every table in the public schema must have RLS enabled. Without a policy,
// that means zero rows readable or writable through PostgREST.
const describeDb = HAS_TEST_DB ? describe : describe.skip;

describeDb('public schema RLS coverage (acceptance: supabase linters 0013/0023)', () => {
  it('has row level security enabled on every table in the public schema', async () => {
    const prisma = getPrisma();
    const rows = await prisma.$queryRawUnsafe<{ tablename: string; rowsecurity: boolean }[]>(
      'SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = \'public\'',
    );

    // Sanity guard: an empty or unmigrated database would trivially satisfy
    // the assertion below, so require the core schema to be present first.
    const tableNames = rows.map((row) => row.tablename);
    expect(tableNames).toContain('users');
    expect(tableNames).toContain('_prisma_migrations');

    const withoutRls = rows
      .filter((row) => !row.rowsecurity)
      .map((row) => row.tablename)
      .sort();
    expect(withoutRls).toEqual([]);
  });
});
