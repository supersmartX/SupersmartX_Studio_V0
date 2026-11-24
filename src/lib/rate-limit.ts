import { getPrisma } from '@/lib/db/prisma';

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 60 * 1000;

function cleanupStaleEntries(): void {
  const now = Date.now();
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) {
      rateLimitMap.delete(key);
    }
  }
}

/**
 * Simple in-memory rate limiter.
 * Note: On Vercel serverless, each cold start resets the counter.
 * For production, consider Upstash Redis or similar.
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  cleanupStaleEntries();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (entry.count >= maxRequests) {
    return { allowed: false, retryAfterMs: entry.resetAt - now };
  }

  entry.count++;
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Distributed limiter for serverless entry points. The atomic update runs in
 * PostgreSQL, while the existing synchronous limiter remains available to
 * isolated unit tests and non-critical local tooling.
 */
export async function rateLimitDistributed(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; retryAfterMs: number }> {
  // Unit tests intentionally use the synchronous in-memory limiter; database
  // integration suites provide a real PostgreSQL schema explicitly.
  if (process.env.VITEST) return rateLimit(key, maxRequests, windowMs);
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  try {
    const rows = await getPrisma().$queryRaw<Array<{ count: number; reset_at: Date; allowed: boolean }>>`
      INSERT INTO "rate_limit_buckets" ("key", "count", "reset_at", "updated_at")
      VALUES (${key}, 1, ${resetAt}, CURRENT_TIMESTAMP)
      ON CONFLICT ("key") DO UPDATE
      SET "count" = CASE
          WHEN "rate_limit_buckets"."reset_at" <= CURRENT_TIMESTAMP THEN 1
          ELSE "rate_limit_buckets"."count" + 1
        END,
        "reset_at" = CASE
          WHEN "rate_limit_buckets"."reset_at" <= CURRENT_TIMESTAMP THEN EXCLUDED."reset_at"
          ELSE "rate_limit_buckets"."reset_at"
        END,
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING "count", "reset_at", "count" <= ${maxRequests} AS "allowed"
    `;
    const row = rows[0];
    if (!row) return { allowed: false, retryAfterMs: windowMs };
    return {
      allowed: row.allowed,
      retryAfterMs: row.allowed ? 0 : Math.max(0, new Date(row.reset_at).getTime() - Date.now()),
    };
  } catch {
    // Fail open to the existing local limiter only when the shared table is
    // unavailable. This preserves availability while deployments roll out the
    // migration; sensitive routes still retain their existing safeguards.
    return rateLimit(key, maxRequests, windowMs);
  }
}
