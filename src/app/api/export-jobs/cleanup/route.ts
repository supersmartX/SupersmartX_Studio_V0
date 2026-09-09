import { NextRequest, NextResponse } from 'next/server';
import { deleteOldExportJobs, getOldExportJobs } from '@/lib/db';
import { deleteRecording } from '@/lib/r2';
import crypto from 'crypto';

const CLEANUP_SECRET = process.env.CLEANUP_SECRET;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get('x-cleanup-secret');

    if (!CLEANUP_SECRET || !secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Constant-time comparison to prevent timing attacks
    const encoder = new TextEncoder();
    const secretBuf = encoder.encode(secret);
    const expectedBuf = encoder.encode(CLEANUP_SECRET);
    if (secretBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(secretBuf, expectedBuf)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 1. Fetch old jobs with R2 keys before deleting DB rows
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
