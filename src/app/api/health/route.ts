import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/driver';
import { ensureMigrated } from '@/lib/db';

export async function GET() {
  const checks: Record<string, string> = {};

  // Database check
  try {
    await ensureMigrated();
    const db = getDb();
    await db.execute('SELECT 1');
    checks.database = 'ok';
  } catch (e) {
    checks.database = `error: ${e instanceof Error ? e.message : 'unknown'}`;
  }

  // R2 check (optional — only if configured)
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) {
    checks.r2 = 'configured';
  } else {
    checks.r2 = 'not_configured';
  }

  const healthy = checks.database === 'ok';

  return NextResponse.json(
    {
      status: healthy ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      version: process.env.npm_package_version || 'unknown',
    },
    { status: healthy ? 200 : 503 },
  );
}
