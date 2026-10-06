import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { createExportJob, findUserById, ensureUserStatsRow, getActiveExportJobCount } from '@/lib/db';
import { getEntitlements, isPlanActive, isPlatformLockedForUser, clampResolution } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rate-limit';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const MAX_CONCURRENT_JOBS = 3;
// Phase 2.9: export creation is a high-risk mutation (job + quota lifecycle),
// so it gets an explicit per-user boundary on top of the concurrency cap.
const CREATE_RATE_LIMIT_MAX = 30;
const CREATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = rateLimit(`export-jobs:create:${session.user.id}`, CREATE_RATE_LIMIT_MAX, CREATE_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const user = await findUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 401 });
    }

    if (!isPlanActive(user.planExpiresAt, user.plan)) {
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

    // The launch matrix is the only accepted set. `custom` has no preset, so it
    // can never produce authoritative dimensions and is rejected here.
    const preset = LAUNCH_PLATFORM_PRESETS.find((item) => item.id === config.platformId);
    if (!preset) {
      return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });
    }

    // Validate config types and ranges
    if (typeof config.outputWidth !== 'number' || typeof config.outputHeight !== 'number') {
      return NextResponse.json({ error: 'Invalid dimensions' }, { status: 400 });
    }
    if (config.outputWidth < 1 || config.outputWidth > 7680 || config.outputHeight < 1 || config.outputHeight > 4320) {
      return NextResponse.json({ error: 'Dimensions must be between 1 and 7680' }, { status: 400 });
    }

    const expected = clampResolution(preset.width, preset.height, entitlements.maxResolution);
    if (config.outputWidth !== expected.width || config.outputHeight !== expected.height) {
      return NextResponse.json({ error: 'Dimensions do not match the validated platform preset' }, { status: 400 });
    }

    // Free plan: only YouTube 16:9 is included — reject any other platform server-side
    if (isPlatformLockedForUser(config.platformId as PlatformId, user.plan || 'free')) {
      return NextResponse.json({ error: 'This format requires the Creator plan' }, { status: 403 });
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
