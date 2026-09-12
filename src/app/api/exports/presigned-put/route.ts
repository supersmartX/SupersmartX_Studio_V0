import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserById, createExportJob, updateExportJobStatus, getActiveExportJobCount, getMonthlyExportCount, getCurrentPeriod } from '@/lib/db';
import { getEntitlements, isPlanActive, clampResolution } from '@/lib/entitlements';
import { getSignedUploadUrl, generateExportKey, isR2Configured } from '@/lib/r2';
import { rateLimit } from '@/lib/rate-limit';
import { PLATFORM_PRESETS } from '@/constants';
import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const PRESIGNED_RATE_LIMIT_MAX = 10;
const PRESIGNED_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_EXPORT_SIZE_MB = 200;

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!isR2Configured()) return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });

    const rl = rateLimit(`presigned:${session.user.id}`, PRESIGNED_RATE_LIMIT_MAX, PRESIGNED_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) return NextResponse.json({ error: 'Rate limited' }, { status: 429 });

    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    if (!isPlanActive(user.planExpiresAt, user.plan)) return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });

    const entitlements = getEntitlements(user.plan as PlanType);
    if (!entitlements.canExport) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });
    // Free should not use direct R2 upload — they are local-only
    if (entitlements.maxExportsPerMonth !== null) {
      return NextResponse.json({ error: 'Free plan uses local export' }, { status: 403 });
    }

    const body = await request.json();
    const { platformId, outputWidth, outputHeight, duration, crop, jobId: existingJobId } = body as {
      platformId: PlatformId;
      outputWidth?: number;
      outputHeight?: number;
      duration?: number;
      crop?: { x?: number; y?: number; zoom?: number };
      jobId?: string;
    };

    if (!platformId) return NextResponse.json({ error: 'Missing platformId' }, { status: 400 });
    const validIds: PlatformId[] = PLATFORM_PRESETS.map(p => p.id);
    if (!validIds.includes(platformId)) return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });

    // Duration check
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > entitlements.maxDurationSeconds) {
      return NextResponse.json({ error: `Recording too long. Maximum is ${entitlements.maxDurationSeconds} seconds` }, { status: 403 });
    }
    // Crop check
    if (!entitlements.canCrop && crop && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1 && crop.zoom !== undefined)) {
      return NextResponse.json({ error: 'Crop & reframe requires Creator plan' }, { status: 403 });
    }
    // Resolution check
    const preset = PLATFORM_PRESETS.find(p => p.id === platformId);
    let clampedW = outputWidth || 0;
    let clampedH = outputHeight || 0;
    if (preset) {
      const clamped = clampResolution(preset.width, preset.height, entitlements.maxResolution);
      clampedW = clamped.width; clampedH = clamped.height;
    } else if (platformId === 'custom' && outputWidth && outputHeight) {
      const clamped = clampResolution(outputWidth, outputHeight, entitlements.maxResolution);
      clampedW = clamped.width; clampedH = clamped.height;
    }
    if (clampedW > entitlements.maxResolution.width || clampedH > entitlements.maxResolution.height) {
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
    let key: string;
    if (existingJobId) {
      const existing = await (await import('@/lib/db')).findExportJobByIdAndUser(existingJobId, session.user.id);
      if (!existing) return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
      jobId = existing.id;
      // Reuse stored key if exists, else generate
      key = existing.resultR2Key || generateExportKey(session.user.id);
      if (!existing.resultR2Key) {
        await updateExportJobStatus(jobId, 'pending', { resultR2Key: key }, session.user.id);
      }
    } else {
      key = generateExportKey(session.user.id);
      const configJson = JSON.stringify({ platformId, outputWidth: clampedW, outputHeight: clampedH, duration, crop });
      const job = await createExportJob(session.user.id, configJson);
      await updateExportJobStatus(job.id, 'pending', { resultR2Key: key }, session.user.id);
      jobId = job.id;
    }

    const uploadUrl = await getSignedUploadUrl(key, 'video/mp4', 900);

    return NextResponse.json({ jobId, key, uploadUrl, expiresIn: 900, outputWidth: clampedW, outputHeight: clampedH });
  } catch (e) {
    console.error('presigned-put failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed to create presigned URL' }, { status: 500 });
  }
}
