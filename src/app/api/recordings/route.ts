import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { listUserRecordings, isR2Configured } from '@/lib/r2';
import { findUserById } from '@/lib/db';
import { isCreatorPlan, isPlanActive } from '@/lib/entitlements';

export async function GET(_request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The cloud recording library is a Creator entitlement (Free is
    // local/device-only), and an expired term is no longer a Creator term. The
    // listing is owner-scoped either way, but without this gate a lapsed
    // account could keep enumerating and playing back its cloud masters.
    const user = await findUserById(session.user.id);
    if (!user || !isCreatorPlan(user.plan)) {
      return NextResponse.json({ error: 'Creator plan required' }, { status: 403 });
    }
    if (!isPlanActive(user.planExpiresAt, user.plan)) {
      return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });
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
    console.error('List recordings error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to list recordings' }, { status: 500 });
  }
}
