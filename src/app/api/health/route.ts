import { NextResponse } from 'next/server';
import { getPrisma, getDbIdentity } from '@/lib/db/prisma';
import { ensureMigrated } from '@/lib/db';
import { getR2ConfigurationError } from '@/lib/r2';
import { auth } from '@/auth';

export async function GET() {
  const checks: Record<string, string> = {};

  // Database check. `ensureMigrated` proves connectivity (and, on a fresh
  // database, writes the legacy `schema_meta` version marker exactly as the old
  // libSQL runner did at startup).
  try {
    await ensureMigrated();
    checks.database = 'ok';
  } catch (e) {
    checks.database = 'error';
    console.error('Health check DB error:', e instanceof Error ? e.message : 'unknown');
  }

  const healthy = checks.database === 'ok';

  // Basic response for unauthenticated requests — no internal details
  const response: Record<string, unknown> = {
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || 'unknown',
    // Non-sensitive deploy traceability: short commit SHA when the host
    // provides it (Vercel sets VERCEL_GIT_COMMIT_SHA at build time).
    // Never a secret; reveals no infrastructure, data, or configuration.
    commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || 'unknown',
  };

  // Only expose detailed checks to authenticated users
  const session = await auth().catch(() => null);
  if (session?.user?.id) {
    const r2Error = getR2ConfigurationError();
    checks.r2 = r2Error ? 'not_configured' : 'configured';
    if (r2Error) checks.r2_detail = r2Error;

    // Operational diagnostics (never secrets): which database this process is
    // bound to and what schema version it holds. Exposed only to a signed-in
    // operator so a deployment can be proven to target the intended database
    // without reading any credential. A stale schema version or an unexpected
    // host is exactly the evidence needed to catch a wrong-database binding.
    const identity = getDbIdentity();
    if (identity) {
      checks.db_provider = identity.provider;
      checks.db_durable = String(identity.durable);
      if (identity.host) checks.db_host = identity.host;
    }
    try {
      const meta = await getPrisma().schemaMeta.findUnique({
        where: { key: 'schema_version' },
        select: { value: true },
      });
      checks.schema_version = meta ? meta.value : 'none';
    } catch {
      checks.schema_version = 'unreadable';
    }

    response.checks = checks;
  }

  return NextResponse.json(response, { status: healthy ? 200 : 503 });
}
