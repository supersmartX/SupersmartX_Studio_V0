import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findExportByIdAndUser, findUserById } from '@/lib/db';
import { isPlanActive } from '@/lib/entitlements';
import { getSignedDownloadUrl, isR2Configured } from '@/lib/r2';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isR2Configured()) return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
    const { id } = await params;
    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    if (!isPlanActive(user.planExpiresAt, user.plan)) return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });
    const exp = await findExportByIdAndUser(id, session.user.id);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    if (exp.status !== 'completed') return NextResponse.json({ error: 'Export not ready' }, { status: 404 });
    if (exp.r2Key.startsWith('local/')) return NextResponse.json({ error: 'Local export, no preview' }, { status: 400 });
    const url = await getSignedDownloadUrl(exp.r2Key, 3600);
    return NextResponse.json({ url, expiresIn: 3600 });
  } catch (e) {
    console.error('preview failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
