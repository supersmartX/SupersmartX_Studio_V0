import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listUserRecordings, isR2Configured } from '@/lib/r2';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ recordings: [] });
    }

    const prefix = `recordings/${session.user.id}/`;
    const recordings = await listUserRecordings(prefix);

    return NextResponse.json({
      recordings: recordings.map((r) => ({
        key: r.key,
        size: r.size,
        lastModified: r.lastModified.toISOString(),
        recordingId: r.key.split('/').pop()?.replace(/\.[^.]+$/, '') || '',
      })),
    });
  } catch (error) {
    console.error('List recordings error:', error);
    return NextResponse.json({ error: 'Failed to list recordings' }, { status: 500 });
  }
}
