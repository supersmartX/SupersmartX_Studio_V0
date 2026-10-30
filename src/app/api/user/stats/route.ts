import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getUserStats, findUserById } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import type { PlanType } from '@/types/db';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Read plan from DB (authoritative) instead of JWT (stale)
    const user = await findUserById(session.user.id);
    const userPlan = (user?.plan || 'free') as PlanType;

    // If plan is expired, downgrade to free for this response
    const activePlan = isPlanActive(user?.planExpiresAt, userPlan) ? userPlan : 'free';
    const entitlements = getEntitlements(activePlan);
    const stats = await getUserStats(session.user.id);

    return NextResponse.json({
      plan: activePlan,
      // Billing status. `plan` is the effective plan (paid → free once the
      // term ended); these carry the stored end date and whether a paid term is
      // still running, so the UI can say "access until <date>" or "expired on
      // <date>" instead of dropping the purchase from view.
      planExpiresAt: user?.planExpiresAt ?? null,
      planActive: userPlan !== 'free' && isPlanActive(user?.planExpiresAt, userPlan),
      downloads: {
        used: stats.downloadCount,
        limit: entitlements.maxDownloads,
      },
      uploads: {
        used: stats.uploadCount,
        limit: entitlements.maxUploads,
      },
      storage: {
        usedBytes: stats.storageBytes,
        limitMB: entitlements.maxStorageMB,
      },
      entitlements: {
        canExport: entitlements.canExport,
        canDownload: entitlements.canDownload,
        canBatchExport: entitlements.canBatchExport,
        maxResolution: entitlements.maxResolution,
        maxDurationSeconds: entitlements.maxDurationSeconds,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
