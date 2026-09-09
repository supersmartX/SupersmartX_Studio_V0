import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createExportJob, findUserById, ensureUserStatsRow, getActiveExportJobCount } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import type { PlanType } from '@/types/db';

const MAX_CONCURRENT_JOBS = 3;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await findUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    if (!isPlanActive(user.planExpiresAt)) {
      return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });
    }

    const entitlements = getEntitlements(user.plan as PlanType);
    if (!entitlements.canExport) {
      return NextResponse.json({ error: 'Upgrade required to export' }, { status: 403 });
    }

    // Check concurrent job limit
    const activeJobs = await getActiveExportJobCount(session.user.id);
    if (activeJobs >= MAX_CONCURRENT_JOBS) {
      return NextResponse.json(
        { error: `Maximum ${MAX_CONCURRENT_JOBS} concurrent exports. Wait for current exports to finish.` },
        { status: 429 },
      );
    }

    const body = await request.json();
    const { config } = body;

    if (!config || !config.platformId || !config.outputWidth || !config.outputHeight) {
      return NextResponse.json({ error: 'Invalid config' }, { status: 400 });
    }

    // Validate config types and ranges
    if (typeof config.outputWidth !== 'number' || typeof config.outputHeight !== 'number') {
      return NextResponse.json({ error: 'Invalid dimensions' }, { status: 400 });
    }
    if (config.outputWidth < 1 || config.outputWidth > 7680 || config.outputHeight < 1 || config.outputHeight > 4320) {
      return NextResponse.json({ error: 'Dimensions must be between 1 and 7680' }, { status: 400 });
    }

    await ensureUserStatsRow(session.user.id);

    const job = await createExportJob(
      session.user.id,
      JSON.stringify(config),
    );

    return NextResponse.json({ jobId: job.id }, { status: 201 });
  } catch (error) {
    console.error('Create export job failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to create export job' }, { status: 500 });
  }
}
