import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listUserExports } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const rows = await listUserExports(session.user.id, 100);
    // The public shape omits userId, matching the previous projection exactly.
    const exports = rows.map((r) => ({
      id: r.id,
      r2Key: r.r2Key,
      platform: r.platform,
      outputWidth: r.outputWidth,
      outputHeight: r.outputHeight,
      fileSize: r.fileSize,
      mimeType: r.mimeType,
      status: r.status,
      createdAt: r.createdAt,
      jobId: r.jobId ?? null,
    }));
    return NextResponse.json({ exports });
  } catch (e) {
    console.error('list exports failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
