import { NextRequest, NextResponse } from 'next/server';
import { deleteOldExportJobs, getOldExportJobs } from '@/lib/db';
import { deleteRecording } from '@/lib/r2';
import crypto from 'crypto';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/**
 * Reads the caller secret.
 *
 * Vercel Cron Jobs invoke a cron path with GET and send the secret as
 * `Authorization: Bearer $CRON_SECRET`. The route previously answered POST only,
 * so the scheduled job could never reach it. `x-cleanup-secret` is still
 * accepted so an operator can trigger the sweep manually.
 */
function readProvidedSecret(request: NextRequest): string | null {
  const header = request.headers.get('x-cleanup-secret');
  if (header) return header;
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

/** Constant-time comparison, with the length check that timingSafeEqual requires. */
function secretsMatch(provided: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const providedBuf = encoder.encode(provided);
  const expectedBuf = encoder.encode(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

async function runCleanup(request: NextRequest): Promise<NextResponse> {
  try {
    const secret = readProvidedSecret(request);

    // Read per request, and fail closed: with no configured secret there is
    // nothing to compare against, so the answer is always 401.
    const cleanupSecret = process.env.CLEANUP_SECRET;
    if (!cleanupSecret || !secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!secretsMatch(secret, cleanupSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch the abandoned jobs' R2 keys before deleting DB rows. Both
    //    queries exclude completed jobs and any key an exports row still
    //    references, so a live Creator library object is never a delete target.
    const oldJobs = await getOldExportJobs(MAX_AGE_MS);

    // 2. Delete R2 objects
    for (const job of oldJobs) {
      try {
        await deleteRecording(job.r2Key);
      } catch {
        // R2 deletion failed — continue with DB cleanup
      }
    }

    // 3. Delete DB rows
    const deletedCount = await deleteOldExportJobs(MAX_AGE_MS);

    return NextResponse.json({ deleted: deletedCount, r2Cleaned: oldJobs.length });
  } catch (error) {
    console.error('Cleanup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}

/** Entry point used by the Vercel cron in vercel.json. */
export async function GET(request: NextRequest) {
  return runCleanup(request);
}

/** Kept for manual invocation; the scheduled job uses GET. */
export async function POST(request: NextRequest) {
  return runCleanup(request);
}