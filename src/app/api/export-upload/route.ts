import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/auth';
import { uploadRecording, isR2Configured } from '@/lib/r2';
import { createExport, findUserById, ensureUserStatsRow, findExportJobByIdAndUser, updateExportJobStatus, atomicIncrementUploadCount, atomicTryConsumeMonthlyExport, atomicRevertMonthlyExport, getCurrentPeriod } from '@/lib/db';
import { getEntitlements, isPlanActive, clampResolution } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rate-limit';
import { PLATFORM_PRESETS } from '@/constants';
import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const MAX_EXPORT_SIZE_MB = 200;
const MAX_EXPORT_SIZE_BYTES = MAX_EXPORT_SIZE_MB * 1024 * 1024;
const EXPORT_UPLOAD_RATE_LIMIT_MAX = 20;
const EXPORT_UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function generateExportKey(userId: string): string {
  const id = crypto.randomUUID();
  return `exports/${userId}/${id}.mp4`;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = rateLimit(`export-upload:${session.user.id}`, EXPORT_UPLOAD_RATE_LIMIT_MAX, EXPORT_UPLOAD_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Export upload rate limit exceeded. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
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
    if (!entitlements.canExport) {
      return NextResponse.json({ error: 'Upgrade required to export recordings' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const platformId = formData.get('platformId') as string;
    const jobId = formData.get('jobId') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_EXPORT_SIZE_BYTES) {
      return NextResponse.json({ error: `File too large (max ${MAX_EXPORT_SIZE_MB}MB)` }, { status: 413 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }

    const mimeType = file.type;
    if (mimeType !== 'video/mp4') {
      return NextResponse.json({ error: 'Invalid file type. Only MP4 exports are accepted.' }, { status: 400 });
    }

    if (!platformId) {
      return NextResponse.json({ error: 'Missing platformId' }, { status: 400 });
    }

    const validPlatformIds: PlatformId[] = PLATFORM_PRESETS.map((p) => p.id);
    if (!validPlatformIds.includes(platformId as PlatformId)) {
      return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });
    }

    const preset = PLATFORM_PRESETS.find((p) => p.id === platformId);
    let outputWidth: number;
    let outputHeight: number;

    if (platformId === 'custom') {
      const customWidth = parseInt(formData.get('outputWidth') as string, 10);
      const customHeight = parseInt(formData.get('outputHeight') as string, 10);
      if (!customWidth || !customHeight || customWidth < 1 || customHeight < 1) {
        return NextResponse.json({ error: 'Invalid custom dimensions' }, { status: 400 });
      }
      const clamped = clampResolution(customWidth, customHeight, entitlements.maxResolution);
      outputWidth = clamped.width;
      outputHeight = clamped.height;
    } else if (preset) {
      const clamped = clampResolution(preset.width, preset.height, entitlements.maxResolution);
      outputWidth = clamped.width;
      outputHeight = clamped.height;
    } else {
      return NextResponse.json({ error: 'Invalid platform' }, { status: 400 });
    }

    // Validate and update job if jobId provided
    if (jobId) {
      const job = await findExportJobByIdAndUser(jobId, session.user.id);
      if (!job) {
        return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
      }
      await updateExportJobStatus(jobId, 'uploading', {}, session.user.id);
    }

    await ensureUserStatsRow(session.user.id);

    // Monthly export quota — atomic consume (counts every successful export, R2 or local)
    let quotaConsumed = false;
    if (entitlements.maxExportsPerMonth !== null) {
      const result = await atomicTryConsumeMonthlyExport(session.user.id, entitlements.maxExportsPerMonth);
      if (!result.allowed) {
        const period = getCurrentPeriod();
        return NextResponse.json(
          { error: `Monthly export limit reached (${entitlements.maxExportsPerMonth} exports for ${period}). Upgrade to Creator for unlimited exports.` },
          { status: 403 },
        );
      }
      quotaConsumed = true;
    }

    // Crop & reframe entitlement — Free cannot manipulate crop
    if (!entitlements.canCrop) {
      const cropRaw = formData.get('crop') as string | null;
      if (cropRaw) {
        try {
          const crop = JSON.parse(cropRaw);
          // Any non-default crop (x!=0, y!=0, zoom!=1) is considered manipulation
          if (crop && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1)) {
            return NextResponse.json({ error: 'Crop & reframe requires Creator plan' }, { status: 403 });
          }
        } catch {}
      }
      // Also check explicit crop fields if provided via separate params
      const cropX = formData.get('cropX') as string | null;
      const cropY = formData.get('cropY') as string | null;
      const cropZoom = formData.get('cropZoom') as string | null;
      if ((cropX && parseFloat(cropX) !== 0) || (cropY && parseFloat(cropY) !== 0) || (cropZoom && parseFloat(cropZoom) !== 1)) {
        return NextResponse.json({ error: 'Crop & reframe requires Creator plan' }, { status: 403 });
      }
    }

    // Duration enforcement if duration is provided
    const durationParam = formData.get('duration') as string | null;
    if (durationParam) {
      const durationNum = parseFloat(durationParam);
      if (Number.isFinite(durationNum) && durationNum > entitlements.maxDurationSeconds) {
        return NextResponse.json(
          { error: `Recording too long. Maximum is ${entitlements.maxDurationSeconds} seconds on your plan` },
          { status: 403 },
        );
      }
    }

    const maxStorageBytes = entitlements.maxStorageMB ? entitlements.maxStorageMB * 1024 * 1024 : null;
    const quotaResult = await atomicIncrementUploadCount(
      session.user.id,
      file.size,
      entitlements.maxUploads,
      maxStorageBytes,
    );
    if (!quotaResult.allowed) {
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      return NextResponse.json({ error: quotaResult.reason }, { status: 403 });
    }

    const r2Key = generateExportKey(session.user.id);

    try {
      if (isR2Configured()) {
        await uploadRecording(r2Key, file, {
          userId: session.user.id,
          platform: platformId,
          outputWidth: String(outputWidth),
          outputHeight: String(outputHeight),
          uploadedAt: new Date().toISOString(),
        });
      }
    } catch (uploadErr) {
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      throw uploadErr;
    }

    let exportRecord;
    try {
      exportRecord = await createExport({
        userId: session.user.id,
        r2Key: isR2Configured() ? r2Key : `local/${session.user.id}/${r2Key.split('/').pop()}`,
        platform: platformId,
        outputWidth,
        outputHeight,
        fileSize: file.size,
        mimeType,
        status: 'completed',
        jobId: jobId ?? undefined,
      });
    } catch (e) {
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      throw e;
    }

    // Mark job as completed
    if (jobId) {
      await updateExportJobStatus(jobId, 'completed', {
        resultR2Key: r2Key,
        resultExportId: exportRecord.id,
        resultFileSize: file.size,
      }, session.user.id);
    }

    return NextResponse.json({
      exportId: exportRecord.id,
      r2Key: exportRecord.r2Key,
    });
  } catch (error) {
    console.error('Export upload failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Export upload failed' }, { status: 500 });
  }
}
