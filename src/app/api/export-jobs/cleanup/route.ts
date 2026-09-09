import { NextRequest, NextResponse } from 'next/server';
import { deleteOldExportJobs } from '@/lib/db';
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

    const deletedCount = await deleteOldExportJobs(MAX_AGE_MS);

    return NextResponse.json({ deleted: deletedCount });
  } catch (error) {
    console.error('Cleanup failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Cleanup failed' }, { status: 500 });
  }
}
