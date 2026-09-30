import { createClient, type Client } from '@libsql/client';

/**
 * STATE 21 — production must never run on an ephemeral database.
 *
 * This module holds the state that money depends on: `users.plan`,
 * `processed_webhooks` (the fulfilment claim), `order_notifications`,
 * `pending_orders`, the export-job and quota ledgers. Every one of those is
 * written exactly once and read forever.
 *
 * The previous fallback chain was: Turso URL, else a local SQLite file, else —
 * on a read-only filesystem — `:memory:`. That last step is the dangerous one,
 * because it is silent and it is reachable in production precisely when it is
 * needed least and understood least: a Vercel deploy that is missing
 * `TURSO_DATABASE_URL` does not crash, does not 500, and does not fail the
 * health check in a way anyone is watching. It accepts a paid webhook, writes
 * `plan = 'creator_monthly'` into a per-lambda scratch database, answers 200,
 * and the grant evaporates when the container recycles.
 *
 * So the rule is inverted for production: an absent, non-remote, or
 * token-less database configuration is a deployment error, and it throws at the
 * point of use rather than degrading. Development and test keep the file
 * fallback, because `data/supersmartx.db` is a genuine developer database, and
 * an explicit `file::memory:` (or `:memory:`) request is still honoured there
 * — that is the environment asking for an ephemeral database on purpose.
 */

let client: Client | null = null;
let clientIsDurable = false;

/**
 * Thrown when a process that must not lose state has no durable database.
 * Callers treat this as retryable: a payment webhook answered with a 500 here
 * is re-delivered by Cashfree once the deploy is fixed, which is the only
 * outcome that does not lose a paid order.
 */
export class DatabaseNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseNotConfiguredError';
  }
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * True only for a remote libsql/Turso endpoint.
 *
 * Deliberately narrow. `:memory:`, `file::memory:` and any `file:`/bare-path
 * URL are all rejected in production: a local SQLite file is durable on a
 * long-lived host but is a per-instance scratch file on a serverless one, and
 * that difference is exactly what is invisible from the code. `AUTH` on a
 * remote URL is required separately.
 */
export function isDurableDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  return trimmed.startsWith('libsql://') || trimmed.startsWith('https://');
}

/**
 * Whether the process currently holds a database whose writes survive the
 * request. False for `:memory:`, for a local `file:` database, and before the
 * first `getDb()` call.
 */
export function isDurableDb(): boolean {
  return client !== null && clientIsDurable;
}

export function getDb(): Client {
  if (client) return client;

  const tursoUrl = process.env.TURSO_DATABASE_URL?.trim();
  const tursoToken = process.env.TURSO_AUTH_TOKEN?.trim();

  if (isProductionEnv()) {
    // Fail closed. There is no in-memory branch and no local-file branch here,
    // by design: a production deployment that cannot name its database has
    // nothing safe to do, and quietly inventing one is how a paid customer ends
    // up with a receipt and no Creator plan.
    if (!tursoUrl) {
      throw new DatabaseNotConfiguredError(
        'DATABASE_NOT_CONFIGURED: TURSO_DATABASE_URL is not set. Production requires a durable remote database; refusing to start on an ephemeral one.'
      );
    }
    if (!isDurableDatabaseUrl(tursoUrl)) {
      throw new DatabaseNotConfiguredError(
        'DATABASE_NOT_CONFIGURED: TURSO_DATABASE_URL must be a remote libsql:// or https:// endpoint in production. Refusing to start on an ephemeral database.'
      );
    }
    if (!tursoToken) {
      throw new DatabaseNotConfiguredError(
        'DATABASE_NOT_CONFIGURED: TURSO_AUTH_TOKEN is not set. Production requires it to authenticate against the durable database.'
      );
    }
    client = createClient({ url: tursoUrl, authToken: tursoToken });
    clientIsDurable = true;
    return client;
  }

  if (tursoUrl) {
    // An explicit `file::memory:` / `:memory:` request is honoured verbatim —
    // every test in this suite uses it. The durability flag records what the
    // environment asked for so a caller can tell the difference.
    client = createClient({
      url: tursoUrl,
      authToken: tursoToken || undefined,
    });
    clientIsDurable = isDurableDatabaseUrl(tursoUrl);
    return client;
  }

  // Local dev fallback — SQLite file
  try {
    const { join } = require('path') as typeof import('path');
    const { existsSync, mkdirSync } = require('fs') as typeof import('fs');
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    const dbPath = join(dataDir, 'supersmartx.db');
    client = createClient({ url: `file:${dbPath}` });
    clientIsDurable = false;
  } catch {
    // Vercel serverless has read-only filesystem. Only reachable in
    // development/test now — production returned above.
    client = createClient({ url: ':memory:' });
    clientIsDurable = false;
    console.warn('[DB] Local filesystem unavailable and no TURSO_DATABASE_URL set. Using in-memory database.');
  }

  return client;
}

export function resetDb(): void {
  if (client) {
    client.close();
    client = null;
  }
  clientIsDurable = false;
}
