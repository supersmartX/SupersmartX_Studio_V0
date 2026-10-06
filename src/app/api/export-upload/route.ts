import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/auth';
import { uploadRecording, isR2Configured } from '@/lib/r2';
import { describeArtifactFailure, normalizeClaimedDuration, normalizeClaimedHasAudio, verifyExportArtifact } from '@/lib/export/artifact-verification';
import { createExport, findUserById, ensureUserStatsRow, findExportJobByIdAndUser, updateExportJobStatus, atomicIncrementUploadCount, atomicRevertUploadCount, atomicTryConsumeMonthlyExport, atomicRevertMonthlyExport, atomicTryConsumeRecordingSeconds, atomicRevertRecordingSeconds, getCurrentPeriod } from '@/lib/db';
import { getEntitlements, isPlanActive, clampResolution, isPlatformLockedForUser, getDailyRecordingAllowanceSeconds, computeRecordingChargeSeconds } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rate-limit';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
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
    if (userPlan === 'free') {
      return NextResponse.json({ error: 'Free plan uses local export' }, { status: 403 });
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

    // The launch matrix only — `custom` is a legacy id with no preset.
    const preset = LAUNCH_PLATFORM_PRESETS.find((p) => p.id === platformId);
    if (!preset) {
      return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });
    }

    // Free plan: only YouTube 16:9 is included — reject any other platform server-side
    if (isPlatformLockedForUser(platformId as PlatformId, userPlan)) {
      return NextResponse.json({ error: 'This format requires the Creator plan' }, { status: 403 });
    }

    // Dimensions always come from the preset; a client cannot request its own frame.
    const clamped = clampResolution(preset.width, preset.height, entitlements.maxResolution);
    const outputWidth = clamped.width;
    const outputHeight = clamped.height;

    // Validate and update job if jobId provided
    if (jobId) {
      const job = await findExportJobByIdAndUser(jobId, session.user.id);
      if (!job) {
        return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
      }
      // Phase 2.2/2.11: a terminal (completed/failed) or non-transitionable
      // (finalizing) job must not be replayed through upload — that would
      // re-consume quota and re-point the job at a second export row. False
      // means the shared transition guard refused the move.
      const moved = await updateExportJobStatus(jobId, 'uploading', {}, session.user.id);
      if (!moved) {
        return NextResponse.json({ error: 'Job is not available for upload' }, { status: 409 });
      }
    }

    // PHASE 3 — parse the ACTUAL uploaded bytes before a single quota unit is
    // taken. The received file is read once here and the same buffer is
    // uploaded below (a Blob over it shares the memory), so verification adds
    // no second full read of the artifact. Dimensions come from the preset
    // clamp above — never from the form. A rejected artifact consumes no
    // quota, writes no row, and leaves the job in `uploading` so a corrected
    // re-upload can retry (the transition guard allows the self-move).
    const artifactBytes = await file.arrayBuffer();
    const verification = verifyExportArtifact(artifactBytes, {
      width: outputWidth,
      height: outputHeight,
      durationSeconds: normalizeClaimedDuration(formData.get('duration')),
      hasAudio: normalizeClaimedHasAudio(formData.get('hasAudio')),
      sizeBytes: file.size,
    });
    if (!verification.ok) {
      console.warn(`export-upload: artifact verification failed (${verification.code}) for user ${session.user.id}`);
      return NextResponse.json({ error: describeArtifactFailure(verification.code) }, { status: 400 });
    }

    await ensureUserStatsRow(session.user.id);

    // Monthly export quota — atomic consume (counts every successful export, R2 or local)
    let quotaConsumed = false;
    if (entitlements.maxExportsPerMonth !== null) {
      const result = await atomicTryConsumeMonthlyExport(session.user.id, entitlements.maxExportsPerMonth);
      if (!result.allowed) {
        const period = getCurrentPeriod();
        return NextResponse.json(
          { error: `Monthly export limit reached (${entitlements.maxExportsPerMonth} exports for ${period}). Creator export count is unlimited; each file is limited to 2 GiB (about 28 min at current 1080p settings).` },
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
          if (crop && typeof crop === 'object' && (crop.x !== 0 || crop.y !== 0 || crop.zoom !== 1)) {
            return NextResponse.json({ error: 'Crop & reframe requires Creator plan' }, { status: 403 });
          }
        } catch {
          return NextResponse.json({ error: 'Invalid crop data' }, { status: 400 });
        }
      }
      // Also check explicit crop fields if provided via separate params
      const cropX = formData.get('cropX') as string | null;
      const cropY = formData.get('cropY') as string | null;
      const cropZoom = formData.get('cropZoom') as string | null;
      if ((cropX && parseFloat(cropX) !== 0) || (cropY && parseFloat(cropY) !== 0) || (cropZoom && parseFloat(cropZoom) !== 1)) {
        return NextResponse.json({ error: 'Crop & reframe requires Creator plan' }, { status: 403 });
      }
    }

    // Duration enforcement if duration is provided (null = unlimited Creator)
    const durationParam = formData.get('duration') as string | null;
    if (durationParam) {
      const durationNum = parseFloat(durationParam);
      if (
        Number.isFinite(durationNum) &&
        entitlements.maxDurationSeconds !== null &&
        durationNum > entitlements.maxDurationSeconds
      ) {
        return NextResponse.json(
          { error: `Recording too long. Maximum is ${entitlements.maxDurationSeconds} seconds on your plan` },
          { status: 403 },
        );
      }
    }

    // BUS-001: server-side daily recording budget, charged from VERIFIED
    // file bytes (floor) and the client claim, whichever is larger.
    // A missing/zero/negative duration still charges the byte floor.
    let recordingConsumedSeconds = 0;
    const dailyAllowance = getDailyRecordingAllowanceSeconds(userPlan);
    if (dailyAllowance !== null) {
      const charge = computeRecordingChargeSeconds(
        durationParam ? parseFloat(durationParam) : undefined,
        file.size,
      );
      const budget = await atomicTryConsumeRecordingSeconds(session.user.id, charge, dailyAllowance);
      if (!budget.allowed) {
        if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
        return NextResponse.json(
          { error: 'Daily Free recording allowance reached. Creator recording duration and sessions are unlimited.' },
          { status: 403 },
        );
      }
      recordingConsumedSeconds = charge;
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
      if (recordingConsumedSeconds > 0) await atomicRevertRecordingSeconds(session.user.id, recordingConsumedSeconds);
      return NextResponse.json({ error: quotaResult.reason }, { status: 403 });
    }

    const r2Key = generateExportKey(session.user.id);

    try {
      if (isR2Configured()) {
        // Upload the same buffer that was verified — one full read, and what
        // lands in R2 is byte-for-byte what passed verification.
        await uploadRecording(r2Key, new Blob([artifactBytes], { type: 'video/mp4' }), {
          userId: session.user.id,
          platform: platformId,
          outputWidth: String(outputWidth),
          outputHeight: String(outputHeight),
          uploadedAt: new Date().toISOString(),
        });
      }
    } catch (uploadErr) {
      // Phase 2.11: every debit taken above is returned when the upload never
      // lands, and the job is moved to `failed` instead of being left stuck in
      // `uploading` (which would hold a concurrency slot until the stale-job
      // cutoff). Rethrown below, so the outer handler still answers 500.
      await atomicRevertUploadCount(session.user.id, file.size);
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      if (recordingConsumedSeconds > 0) await atomicRevertRecordingSeconds(session.user.id, recordingConsumedSeconds);
      if (jobId) {
        await updateExportJobStatus(jobId, 'failed', { errorMessage: 'Export upload failed' }, session.user.id).catch(() => {});
      }
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
      await atomicRevertUploadCount(session.user.id, file.size);
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      if (recordingConsumedSeconds > 0) await atomicRevertRecordingSeconds(session.user.id, recordingConsumedSeconds);
      if (jobId) {
        await updateExportJobStatus(jobId, 'failed', { errorMessage: 'Export record creation failed' }, session.user.id).catch(() => {});
      }
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
