import { PrismaClient } from '@prisma/client';

/**
 * PostgreSQL / Prisma connection for SupersmartX Studio.
 *
 * This module is the single place a Prisma client is constructed. It exists so
 * that:
 *
 *  - there is exactly ONE client per process (Prisma opens a pool; a new client
 *    per request exhausts connections),
 *  - Next.js dev hot-reload does not leak clients (cached on `globalThis`), and
 *  - production still fails closed: a deployment that cannot name a durable
   *    PostgreSQL database must not silently invent one. No in-memory or
   *    local-file fallback is ever reachable in production.
 *
 * The client is created lazily. Nothing here touches the network at import time,
 * so `next build` on a host without DATABASE_URL does not crash; the error
 * surfaces at the first query, exactly as `getDb()` did.
 */

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

/**
 * A non-secret description of the database this process is bound to.
 *
 * Deliberately excludes credentials: only the provider kind and the remote host
 * are exposed. The host alone cannot open a connection (the password is a
 * separate secret), so this is safe to surface to an authenticated operator.
 */
export interface DbIdentity {
  provider: 'postgres';
  /** Remote host only, e.g. `db.<ref>.supabase.co:5432`. Never a password. */
  host: string | null;
  durable: boolean;
}

export function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * True only for a `postgres://`/`postgresql://` connection string.
 *
 * An absent URL is not durable, and neither is anything that is not a Postgres
 * DSN â€” so a misconfigured production deploy fails closed rather than running
 * against an unintended backend.
 */
export function isDurableDatabaseUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  const lower = trimmed.toLowerCase();
  return lower.startsWith('postgres://') || lower.startsWith('postgresql://');
}

/** Provider/host description for `/api/health`. Never includes the password. */
export function describeDatabaseUrl(url: string): DbIdentity {
  try {
    const parsed = new URL(url);
    return { provider: 'postgres', host: parsed.host || null, durable: true };
  } catch {
    return { provider: 'postgres', host: null, durable: true };
  }
}

const globalForPrisma = globalThis as unknown as {
  __supersmartxPrisma?: PrismaClient;
  __supersmartxDbIdentity?: DbIdentity;
};

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL?.trim();

  if (isProductionEnv()) {
    // Fail closed. There is no fallback branch here, by design: a production
    // deployment that cannot name its database has nothing safe to do, and
    // quietly inventing one is how a paid customer ends up with a receipt and
    // no Creator plan.
    if (!url) {
      throw new DatabaseNotConfiguredError(
        'DATABASE_NOT_CONFIGURED: DATABASE_URL is not set. Production requires a durable PostgreSQL database; refusing to start without one.',
      );
    }
    if (!isDurableDatabaseUrl(url)) {
      throw new DatabaseNotConfiguredError(
        'DATABASE_NOT_CONFIGURED: DATABASE_URL must be a postgres:// or postgresql:// connection string in production. Refusing to start against a non-PostgreSQL backend.',
      );
    }
  }

  if (url) {
    globalForPrisma.__supersmartxDbIdentity = describeDatabaseUrl(url);
  }

  return new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

/**
 * The process-wide Prisma client. Created on first use.
 *
 * Cached on `globalThis` outside production so Next.js dev hot-reload reuses one
 * pool instead of leaking a client (and a pool) per module reload.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__supersmartxPrisma) {
    globalForPrisma.__supersmartxPrisma = createPrismaClient();
  }
  return globalForPrisma.__supersmartxPrisma;
}

/**
 * The database this process is bound to, or `null` before the first
 * `getPrisma()` call. Callers must treat a `null`/absent host as "not yet
 * resolved", never as "safe default".
 */
export function getDbIdentity(): DbIdentity | null {
  return globalForPrisma.__supersmartxDbIdentity ?? null;
}

/** Disposes the client and clears the cached identity. Test-only. */
export async function resetPrisma(): Promise<void> {
  if (globalForPrisma.__supersmartxPrisma) {
    await globalForPrisma.__supersmartxPrisma.$disconnect();
    globalForPrisma.__supersmartxPrisma = undefined;
  }
  globalForPrisma.__supersmartxDbIdentity = undefined;
}



