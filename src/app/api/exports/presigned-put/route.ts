import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserById, createExportJob, updateExportJobStatus, getActiveExportJobCount, getMonthlyExportCount } from '@/lib/db';
import { getEntitlements, isPlanActive, clampResolution, exceedsResolutionLimit } from '@/lib/entitlements';
import { getSignedUploadUrl, generateExportStagingKey, isR2Configured, getR2ConfigurationError } from '@/lib/r2';
import { MAX_EXPORT_DURATION_SECONDS, describeExportDurationLimit } from '@/lib/export/export-limits';
import { normalizeClaimedHasAudio } from '@/lib/export/artifact-verification';
import { rateLimit } from '@/lib/rate-limit';
import { findExportJobByIdAndUser, setExportJobStagingKey } from '@/lib/db';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const PRESIGNED_RATE_LIMIT_MAX = 10;
const PRESIGNED_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Throttle before any lookup: this endpoint is the most expensive to reach, so
    // the limiter guards the database read below rather than sitting behind the
    // plan checks.
    const rl = rateLimit(`presigned:${session.user.id}`, PRESIGNED_RATE_LIMIT_MAX, PRESIGNED_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) return NextResponse.json({ error: 'Rate limited' }, { status: 429 });

    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    if (!isPlanActive(user.planExpiresAt, user.plan)) return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });

    const entitlements = getEntitlements(user.plan as PlanType);
    if (!entitlements.canExport) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
    // Free should not use direct R2 upload — they are local-only (unlimited local downloads).
    // Resolved before storage configuration because it is a property of the plan, not of
    // the backend: a Free account must be refused for this reason whether or not R2
    // happens to be configured, and it must not be answered with the state of a bucket
    // Free can never use.
    if ((user.plan || 'free') === 'free') {
      return NextResponse.json({ error: 'Free plan uses local export' }, { status: 403 });
    }

    if (!isR2Configured()) return NextResponse.json({ error: `Storage not configured: ${getR2ConfigurationError()}` }, { status: 503 });

    const body = await request.json();
    const { platformId, duration, crop, hasAudio, jobId: existingJobId } = body as {
      platformId: PlatformId;
      duration?: number;
      crop?: { x?: number; y?: number; zoom?: number };
      hasAudio?: unknown;
      jobId?: string;
    };

    if (!platformId) return NextResponse.json({ error: 'Missing platformId' }, { status: 400 });
    // The launch matrix only. `custom` is a legacy compatibility id with no
    // preset, so accepting it here would let a caller set arbitrary dimensions
    // and bypass the single source of truth.
    const preset = LAUNCH_PLATFORM_PRESETS.find((p) => p.id === platformId);
    if (!preset) return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });

    // Duration check (null = unlimited Creator)
    if (typeof duration === 'number' && Number.isFinite(duration) && entitlements.maxDurationSeconds !== null && duration > entitlements.maxDurationSeconds) {
      return NextResponse.json({ error: `Recording too long. Maximum is ${entitlements.maxDurationSeconds} seconds` }, { status: 403 });
    }
    // Creator recording is unlimited, but a single exported artifact is not:
    // the encoder's own bitrate decides how long a recording fits under the
    // server-side size cap. Reject here — before the browser spends bandwidth
    // on a multi-gigabyte PUT — instead of letting the upload finish and then
    // fail at completion. The authoritative check stays on the server-verified
    // R2 object size in /api/exports/complete; this claim-based pre-check is
    // user experience, never the security control.
    if (
      typeof duration === 'number' &&
      Number.isFinite(duration) &&
      duration > 0 &&
      duration > MAX_EXPORT_DURATION_SECONDS
    ) {
      return NextResponse.json({ error: describeExportDurationLimit() }, { status: 403 });
    }
    // Crop check
    if (!entitlements.canCrop && crop && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1 && crop.zoom !== undefined)) {
      return NextResponse.json({ error: 'Crop & reframe requires Creator plan' }, { status: 403 });
    }
    // Resolution check — dimensions always come from the preset, never the client.
    const clamped = clampResolution(preset.width, preset.height, entitlements.maxResolution);
    const clampedW = clamped.width;
    const clampedH = clamped.height;
    if (exceedsResolutionLimit(clampedW, clampedH, entitlements.maxResolution)) {
      return NextResponse.json({ error: 'Resolution exceeds plan limit' }, { status: 403 });
    }

    // Concurrency check
    const active = await getActiveExportJobCount(session.user.id);
    if (active >= 3) return NextResponse.json({ error: 'Maximum 3 concurrent exports' }, { status: 429 });

    // Early quota check (Creator unlimited, so not needed, but keep for safety if Free ever calls)
    if (entitlements.maxExportsPerMonth !== null) {
      const count = await getMonthlyExportCount(session.user.id);
      if (count >= entitlements.maxExportsPerMonth) {
        return NextResponse.json({ error: `Monthly limit reached` }, { status: 403 });
      }
    }

    let jobId: string;
    if (existingJobId) {
      const existing = await findExportJobByIdAndUser(existingJobId, session.user.id);
      if (!existing) return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
      if (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'finalizing') {
        return NextResponse.json({ error: 'Job is not available for upload' }, { status: 409 });
      }
      jobId = existing.id;
    } else {
      // Phase 3: `hasAudio` is the encoder's ground-truth probe of the source
      // blob, stored server-side so /api/exports/complete can require the
      // artifact to actually contain the audio stream when the source had one.
      const configJson = JSON.stringify({
        platformId,
        outputWidth: clampedW,
        outputHeight: clampedH,
        duration,
        crop,
        hasAudio: normalizeClaimedHasAudio(hasAudio) ?? undefined,
      });
      const job = await createExportJob(session.user.id, configJson);
      jobId = job.id;
    }

    const key = generateExportStagingKey(session.user.id, jobId);
    if (!await setExportJobStagingKey(jobId, session.user.id, key)) {
      return NextResponse.json({ error: 'Job is not available for upload' }, { status: 409 });
    }

    const uploadUrl = await getSignedUploadUrl(key, 'video/mp4', 900);

    return NextResponse.json({ jobId, key, uploadUrl, expiresIn: 900, outputWidth: clampedW, outputHeight: clampedH });
  } catch (e) {
    console.error('presigned-put failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed to create presigned URL' }, { status: 500 });
  }
}
