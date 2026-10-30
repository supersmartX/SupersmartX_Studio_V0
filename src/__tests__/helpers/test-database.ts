/**
 * One decision about which database a test run may touch.
 *
 * The database-backed suites `TRUNCATE` every application table between tests,
 * and each of them gates itself on `DATABASE_URL` merely being set. In this
 * repository `DATABASE_URL` points at the deployed database, so "the variable
 * is set" is not evidence of a test database. Anything that looks like the
 * deployed one is refused here, and both the shared harness and the run-wide
 * guard read that decision from this module.
 */
const configuredUrl = (process.env.DATABASE_URL ?? '').trim();

/**
 * Markers of the deployed database: the word "prod", the product name, or a
 * Supabase host (the production instance is on the Supabase pooler). A
 * throwaway database that happens to match can be allowed deliberately with
 * `ALLOW_TEST_DB=1`.
 */
export const LOOKS_PRODUCTION =
  /prod|supersmartx|\.supabase\.(com|co)/i.test(configuredUrl) &&
  process.env.ALLOW_TEST_DB !== '1';

export const HAS_TEST_DB = Boolean(configuredUrl) && !LOOKS_PRODUCTION;
