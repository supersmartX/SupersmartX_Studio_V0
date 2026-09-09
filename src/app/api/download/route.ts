import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getSignedDownloadUrl, isR2Configured } from '@/lib/r2';
import { findExportByIdAndUser, findUserById, atomicIncrementDownloadCount, ensureUserStatsRow } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rate-limit';
import type { PlanType } from '@/types/db';

const SIGNED_URL_TTL_SECONDS = (() => {
  const v = parseInt(process.env.R2_SIGNED_URL_TTL_SECONDS || '3600', 10);
  return Number.isFinite(v) && v > 0 ? v : 3600;
})();
const DOWNLOAD_RATE_LIMIT_MAX = 30;
const DOWNLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
    }

    const rl = rateLimit(`download:${session.user.id}`, DOWNLOAD_RATE_LIMIT_MAX, DOWNLOAD_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Download rate limit exceeded. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { searchParams } = new URL(request.url);
    const exportId = searchParams.get('exportId');

    if (!exportId) {
      return NextResponse.json({ error: 'Missing exportId parameter' }, { status: 400 });
    }

    if (exportId.includes('..') || exportId.includes('%2e%2e')) {
      return NextResponse.json({ error: 'Invalid exportId' }, { status: 400 });
    }

    const user = await findUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    const userPlan = user.plan || 'free';
    if (!isPlanActive(user.planExpiresAt, user.plan)) {
      return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });
    }

    const entitlements = getEntitlements(userPlan as PlanType);
    if (!entitlements.canDownload) {
      return NextResponse.json({ error: 'Upgrade required to download recordings' }, { status: 403 });
    }

    const exportRecord = await findExportByIdAndUser(exportId, session.user.id);
    if (!exportRecord) {
      return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    }

    if (exportRecord.status !== 'completed') {
      return NextResponse.json({ error: 'Export is not available for download' }, { status: 404 });
    }

    await ensureUserStatsRow(session.user.id);

    if (entitlements.maxDownloads !== null) {
      const success = await atomicIncrementDownloadCount(session.user.id, entitlements.maxDownloads);
      if (!success) {
        return NextResponse.json(
          { error: `Download limit reached. Maximum is ${entitlements.maxDownloads} downloads on your plan` },
          { status: 403 },
        );
      }
    } else {
      const { incrementDownloadCount } = await import('@/lib/db');
      await incrementDownloadCount(session.user.id);
    }

    const url = await getSignedDownloadUrl(exportRecord.r2Key, SIGNED_URL_TTL_SECONDS);

    return NextResponse.json({ url, expiresIn: SIGNED_URL_TTL_SECONDS });
  } catch (error) {
    console.error('Download failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
