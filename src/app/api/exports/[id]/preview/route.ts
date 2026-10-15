import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findExportByIdAndUser, findUserById } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import { getSignedDownloadUrl, isR2Configured, getR2ConfigurationError } from '@/lib/r2';
import { rateLimit } from '@/lib/rate-limit';
import type { PlanType } from '@/types/db';

const PREVIEW_RATE_LIMIT_MAX = 30;
const PREVIEW_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isR2Configured()) return NextResponse.json({ error: `Storage not configured: ${getR2ConfigurationError()}` }, { status: 503 });

    const rl = rateLimit(`preview:${session.user.id}`, PREVIEW_RATE_LIMIT_MAX, PREVIEW_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { id } = await params;
    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    if (!isPlanActive(user.planExpiresAt, user.plan)) return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });
    const entitlements = getEntitlements((user.plan || 'free') as PlanType);
    if (!entitlements.canDownload) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
    const exp = await findExportByIdAndUser(id, session.user.id);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    if (exp.status !== 'completed') return NextResponse.json({ error: 'Export not ready' }, { status: 404 });
    // Same namespace rule as download: only a finished object inside this
    // user's final prefix may be signed. `local/` rows have no R2 object,
    // `staging/` objects are unverified uploads, and any other prefix must
    // never become an access URL — all answer like a missing export.
    if (
      exp.r2Key.startsWith('local/') ||
      exp.r2Key.startsWith('staging/') ||
      (exp.r2Key.startsWith('exports/') && !exp.r2Key.startsWith(`exports/${session.user.id}/`))
    ) {
      return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    }
    const url = await getSignedDownloadUrl(exp.r2Key, 3600);
    return NextResponse.json({ url, expiresIn: 3600 });
  } catch (e) {
    console.error('preview failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
