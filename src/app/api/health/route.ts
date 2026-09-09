import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/driver';
import { ensureMigrated } from '@/lib/db';
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
  };

  // Only expose detailed checks to authenticated users
  const session = await auth().catch(() => null);
  if (session?.user?.id) {
    checks.r2 = (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID)
      ? 'configured'
      : 'not_configured';
    response.checks = checks;
  }

  return NextResponse.json(response, { status: healthy ? 200 : 503 });
}
