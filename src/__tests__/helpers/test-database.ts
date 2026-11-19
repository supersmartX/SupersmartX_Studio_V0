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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readConfiguredUrl(): string {
  if ((process.env.DATABASE_URL ?? '').trim()) return (process.env.DATABASE_URL ?? '').trim();
  for (const name of ['.env.local', '.env']) {
    try {
      const text = readFileSync(join(process.cwd(), name), 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
        if (!match) continue;
        return match[1].trim().replace(/^(['"])(.*)\1$/, '$2');
      }
    } catch {}
  }
  return '';
}

const configuredUrl = readConfiguredUrl();

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
