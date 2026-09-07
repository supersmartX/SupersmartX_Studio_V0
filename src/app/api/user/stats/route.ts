import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getUserStats } from '@/lib/db';
import { getEntitlements } from '@/lib/entitlements';
import type { PlanType } from '@/types/db';

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userPlan = (session.user.plan || 'free') as PlanType;
    const entitlements = getEntitlements(userPlan);
    const stats = await getUserStats(session.user.id);

    return NextResponse.json({
      plan: userPlan,
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
