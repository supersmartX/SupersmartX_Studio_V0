import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserById, atomicTryConsumeMonthlyExport, getCurrentPeriod } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import type { PlanType } from '@/types/db';

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    if (!isPlanActive(user.planExpiresAt, user.plan)) return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });
    const entitlements = getEntitlements(user.plan as PlanType);
    if (!entitlements.canExport) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
    if (entitlements.maxExportsPerMonth === null) {
      // Creator unlimited — no quota to consume
      return NextResponse.json({ allowed: true, count: null, unlimited: true });
    }
    const result = await atomicTryConsumeMonthlyExport(session.user.id, entitlements.maxExportsPerMonth);
    if (!result.allowed) {
      return NextResponse.json({ error: `Monthly limit reached (${entitlements.maxExportsPerMonth} for ${getCurrentPeriod()})`, allowed: false, count: result.count }, { status: 403 });
    }
    return NextResponse.json({ allowed: true, count: result.count });
  } catch (e) {
    console.error('consume-quota failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
