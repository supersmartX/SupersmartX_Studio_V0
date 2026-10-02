import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/driver';
import { ensureMigrated } from '@/lib/db';
import { getR2ConfigurationError } from '@/lib/r2';
import { auth } from '@/auth';

export async function GET() {
  const checks: Record<string, string> = {};

  // Database check
  try {
    await ensureMigrated();
    const db = getDb();
    await db.execute('SELECT 1');
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
    response.checks = checks;
  }

  return NextResponse.json(response, { status: healthy ? 200 : 503 });
}
