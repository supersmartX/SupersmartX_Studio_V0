import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { auth } from '@/auth';
import {
  atomicIncrementUploadCount,
  atomicRevertMonthlyExport,
  atomicRevertRecordingSeconds,
  atomicRevertUploadCount,
  atomicTryConsumeMonthlyExport,
  atomicTryConsumeRecordingSeconds,
  atomicFinalizeExport,
  claimExportJobFinalization,
  ensureUserStatsRow,
  findExportJobByIdAndUser,
  findUserById,
  releaseExportJobFinalization,
  setExportJobStagingKey,
} from '@/lib/db';
import {
  clampResolution,
  computeRecordingChargeSeconds,
  getDailyRecordingAllowanceSeconds,
  getEntitlements,
  isPlanActive,
  isPlatformLockedForUser,
} from '@/lib/entitlements';
import {
  copyRecording,
  deleteRecording,
  generateFinalExportKey,
  getR2ConfigurationError,
  headObject,
  isR2Configured,
} from '@/lib/r2';
import { MAX_EXPORT_SIZE_BYTES, MAX_EXPORT_SIZE_MB } from '@/lib/export/export-limits';
import { LAUNCH_PLATFORM_PRESETS } from '@/constants';
import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const ALLOWED_EXPORT_CONTENT_TYPES = ['video/mp4', 'application/mp4'];

function jobClaimedDurationSeconds(configJson: string | null | undefined): unknown {
  if (!configJson) return undefined;
  try {
    const parsed = JSON.parse(configJson) as { duration?: unknown };
    return parsed?.duration;
  } catch {
    return undefined;
  }
}

async function completedResponse(jobId: string, userId: string, stagingKey: string) {
  const latest = await findExportJobByIdAndUser(jobId, userId);
  if (latest?.status === 'completed' && latest.resultExportId && latest.resultR2Key && latest.stagingR2Key === stagingKey) {
    return NextResponse.json({ exportId: latest.resultExportId, r2Key: latest.resultR2Key });
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    if (!isPlanActive(user.planExpiresAt, user.plan)) return NextResponse.json({ error: 'Plan has expired' }, { status: 403 });

    const entitlements = getEntitlements(user.plan as PlanType);
    if (!entitlements.canExport) return NextResponse.json({ error: 'Upgrade required' }, { status: 403 });

    const body = await request.json();
    const { jobId, key, fileSize, mimeType, platformId, outputWidth, outputHeight, duration } = body as {
      jobId: string;
      key: string;
      fileSize: number;
      mimeType: string;
      platformId: PlatformId;
      outputWidth: number;
      outputHeight: number;
      duration?: unknown;
    };

    if (!jobId || !key || !fileSize || !platformId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    if (fileSize > MAX_EXPORT_SIZE_BYTES) return NextResponse.json({ error: 'File too large' }, { status: 413 });
    if (mimeType && mimeType !== 'video/mp4') return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 });

    const job = await findExportJobByIdAndUser(jobId, session.user.id);
    if (!job) return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
    if (
      job.status === 'completed' &&
      job.resultExportId &&
      job.resultR2Key &&
      (job.stagingR2Key === key || (!job.stagingR2Key && job.resultR2Key === key))
    ) {
      return NextResponse.json({ exportId: job.resultExportId, r2Key: job.resultR2Key });
    }
    if (job.status === 'completed') return NextResponse.json({ error: 'Job already completed' }, { status: 409 });
    if (job.status === 'failed') return NextResponse.json({ error: 'Job is not available for completion' }, { status: 409 });

    // Complete an in-flight upload issued before staging keys were deployed.
    let stagingKey = job.stagingR2Key;
    if (!stagingKey && job.resultR2Key === key && key.startsWith(`exports/${session.user.id}/`)) {
      if (!await setExportJobStagingKey(jobId, session.user.id, key)) {
        return NextResponse.json({ error: 'Job is not available for completion' }, { status: 409 });
      }
      stagingKey = key;
    }
    if (!stagingKey || stagingKey !== key) return NextResponse.json({ error: 'Key mismatch' }, { status: 403 });
    if (!stagingKey.startsWith(`staging/${session.user.id}/`) && !stagingKey.startsWith(`exports/${session.user.id}/`)) {
      return NextResponse.json({ error: 'Invalid key' }, { status: 403 });
    }

    if (!LAUNCH_PLATFORM_PRESETS.some((preset) => preset.id === platformId)) {
      return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });
    }
    if (isPlatformLockedForUser(platformId, user.plan || 'free')) {
      return NextResponse.json({ error: 'This format requires the Creator plan' }, { status: 403 });
    }

    const jobConfig = JSON.parse(job.configJson || '{}') as { platformId?: PlatformId };
    const authoritativePlatformId = jobConfig.platformId;
    const preset = LAUNCH_PLATFORM_PRESETS.find((item) => item.id === authoritativePlatformId);
    if (!preset) return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });

    const expectedDimensions = clampResolution(preset.width, preset.height, entitlements.maxResolution);
    if (platformId !== authoritativePlatformId) return NextResponse.json({ error: 'Platform mismatch' }, { status: 400 });
    if (outputWidth !== expectedDimensions.width || outputHeight !== expectedDimensions.height) {
      return NextResponse.json({ error: 'Output dimensions do not match the validated export configuration' }, { status: 400 });
    }
    if (!isR2Configured()) return NextResponse.json({ error: `Storage not configured: ${getR2ConfigurationError()}` }, { status: 503 });

    const source = await headObject(stagingKey);
    if (!source || source.size <= 0) return NextResponse.json({ error: 'Object not found, upload first' }, { status: 400 });
    if (source.size > MAX_EXPORT_SIZE_BYTES) {
      try { await deleteRecording(stagingKey); } catch {}
      return NextResponse.json({ error: `File too large (max ${MAX_EXPORT_SIZE_MB}MB)` }, { status: 413 });
    }
    if (Math.abs(source.size - fileSize) > 1024) {
      console.warn('complete: client fileSize disagrees with verified size; server wins');
    }
    const sourceType = source.contentType?.trim().toLowerCase();
    if (!sourceType || !ALLOWED_EXPORT_CONTENT_TYPES.includes(sourceType)) {
      try { await deleteRecording(stagingKey); } catch {}
      return NextResponse.json({ error: 'Uploaded file is not a valid MP4' }, { status: 400 });
    }
    if (!source.eTag) return NextResponse.json({ error: 'Uploaded object cannot be finalized' }, { status: 503 });

    const dailyAllowance = getDailyRecordingAllowanceSeconds(user.plan);
    const recordingCharge = dailyAllowance === null
      ? 0
      : computeRecordingChargeSeconds(duration ?? jobClaimedDurationSeconds(job.configJson), source.size);
    const maxStorageBytes = entitlements.maxStorageMB ? entitlements.maxStorageMB * 1024 * 1024 : null;
    const finalKey = generateFinalExportKey(session.user.id, jobId);
    const finalizationToken = crypto.randomUUID();

    if (!await claimExportJobFinalization(jobId, session.user.id, stagingKey, finalizationToken)) {
      const latest = await findExportJobByIdAndUser(jobId, session.user.id);
      if (latest?.status === 'completed' && latest.resultExportId && latest.resultR2Key && latest.stagingR2Key === stagingKey) {
        return NextResponse.json({ exportId: latest.resultExportId, r2Key: latest.resultR2Key });
      }
      return NextResponse.json({ error: 'Export is already being finalized. Retry shortly.' }, { status: 409 });
    }

    let recordingConsumedSeconds = 0;
    let monthlyConsumed = false;
    let uploadConsumed = false;

    const revertQuotas = async () => {
      if (uploadConsumed) await atomicRevertUploadCount(session.user.id, source.size);
      if (monthlyConsumed) await atomicRevertMonthlyExport(session.user.id);
      if (recordingConsumedSeconds > 0) await atomicRevertRecordingSeconds(session.user.id, recordingConsumedSeconds);
    };

    try {
      await copyRecording(stagingKey, finalKey, source.eTag);
      const finalized = await headObject(finalKey);
      const finalType = finalized?.contentType?.trim().toLowerCase();
      if (
        !finalized || finalized.size !== source.size || !finalType ||
        !ALLOWED_EXPORT_CONTENT_TYPES.includes(finalType)
      ) {
        try { await deleteRecording(finalKey); } catch {}
        await releaseExportJobFinalization(jobId, session.user.id, finalizationToken);
        return NextResponse.json({ error: 'Finalized file verification failed' }, { status: 502 });
      }

      await ensureUserStatsRow(session.user.id);
      if (dailyAllowance !== null) {
        const daily = await atomicTryConsumeRecordingSeconds(session.user.id, recordingCharge, dailyAllowance);
        if (!daily.allowed) {
          try { await deleteRecording(finalKey); } catch {}
          try { await deleteRecording(stagingKey); } catch {}
          await releaseExportJobFinalization(jobId, session.user.id, finalizationToken);
          return NextResponse.json({ error: 'Daily Free recording allowance reached. Creator recording duration and sessions are unlimited.' }, { status: 403 });
        }
        recordingConsumedSeconds = recordingCharge;
      }
      if (entitlements.maxExportsPerMonth !== null) {
        const monthly = await atomicTryConsumeMonthlyExport(session.user.id, entitlements.maxExportsPerMonth);
        if (!monthly.allowed) {
          await revertQuotas();
          try { await deleteRecording(finalKey); } catch {}
          try { await deleteRecording(stagingKey); } catch {}
          await releaseExportJobFinalization(jobId, session.user.id, finalizationToken);
          return NextResponse.json({ error: 'Monthly limit reached' }, { status: 403 });
        }
        monthlyConsumed = true;
      }
      const uploadQuota = await atomicIncrementUploadCount(
        session.user.id,
        source.size,
        entitlements.maxUploads,
        maxStorageBytes,
      );
      if (!uploadQuota.allowed) {
        await revertQuotas();
        try { await deleteRecording(finalKey); } catch {}
        try { await deleteRecording(stagingKey); } catch {}
        await releaseExportJobFinalization(jobId, session.user.id, finalizationToken);
        return NextResponse.json({ error: uploadQuota.reason }, { status: 403 });
      }
      uploadConsumed = true;

      const result = await atomicFinalizeExport({
        jobId,
        userId: session.user.id,
        token: finalizationToken,
        stagingKey,
        finalKey,
        platform: authoritativePlatformId,
        outputWidth: expectedDimensions.width,
        outputHeight: expectedDimensions.height,
        fileSize: source.size,
      });
      if (result.kind === 'claim_lost') {
        await revertQuotas();
        try { await deleteRecording(finalKey); } catch {}
        const latest = await findExportJobByIdAndUser(jobId, session.user.id);
        if (latest?.status === 'completed' && latest.resultExportId && latest.resultR2Key && latest.stagingR2Key === stagingKey) {
          return NextResponse.json({ exportId: latest.resultExportId, r2Key: latest.resultR2Key });
        }
        return NextResponse.json({ error: 'Export is already being finalized. Retry shortly.' }, { status: 409 });
      }
      // Keep the staging key on the completed job so cleanup can retry if this
      // deletion fails. The presigned URL can write only this staging object.
      try { await deleteRecording(stagingKey); } catch {}
      return NextResponse.json({ exportId: result.export.id, r2Key: finalKey });
    } catch (error) {
      await revertQuotas();
      try { await deleteRecording(finalKey); } catch {}
      await releaseExportJobFinalization(jobId, session.user.id, finalizationToken);
      throw error;
    }
  } catch (error) {
    console.error('complete failed', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Completion failed' }, { status: 500 });
  }
}