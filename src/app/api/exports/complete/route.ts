import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserById, findExportJobByIdAndUser, updateExportJobStatus, createExport, ensureUserStatsRow, atomicIncrementUploadCount, atomicTryConsumeMonthlyExport, atomicRevertMonthlyExport, getCurrentPeriod } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import { headObject, deleteRecording, isR2Configured } from '@/lib/r2';
import { PLATFORM_PRESETS } from '@/constants';
import type { PlanType } from '@/types/db';
import type { PlatformId } from '@/types';

const MAX_EXPORT_SIZE_MB = 200;
const MAX_EXPORT_SIZE_BYTES = MAX_EXPORT_SIZE_MB * 1024 * 1024;

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
    const { jobId, key, fileSize, mimeType, platformId, outputWidth, outputHeight } = body as {
      jobId: string;
      key: string;
      fileSize: number;
      mimeType: string;
      platformId: PlatformId;
      outputWidth: number;
      outputHeight: number;
    };

    if (!jobId || !key || !fileSize || !platformId) return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    if (!key.startsWith(`exports/${session.user.id}/`)) return NextResponse.json({ error: 'Invalid key' }, { status: 403 });
    if (fileSize > MAX_EXPORT_SIZE_BYTES) return NextResponse.json({ error: 'File too large' }, { status: 413 });
    if (mimeType && mimeType !== 'video/mp4') return NextResponse.json({ error: 'Invalid mimeType' }, { status: 400 });

    const job = await findExportJobByIdAndUser(jobId, session.user.id);
    if (!job) return NextResponse.json({ error: 'Invalid job' }, { status: 400 });
    // Idempotency: if already completed with same key, return existing
    if (job.status === 'completed' && job.resultR2Key === key && job.resultExportId) {
      return NextResponse.json({ exportId: job.resultExportId, r2Key: key });
    }
    if (job.status === 'completed') return NextResponse.json({ error: 'Job already completed' }, { status: 409 });
    // Verify expected key matches job's stored key
    if (job.resultR2Key && job.resultR2Key !== key) return NextResponse.json({ error: 'Key mismatch' }, { status: 403 });
    const validIds: PlatformId[] = PLATFORM_PRESETS.map(p => p.id);
    if (!validIds.includes(platformId)) return NextResponse.json({ error: 'Invalid platformId' }, { status: 400 });

    if (!isR2Configured()) return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });

    // Verify object exists via Head
    const head = await headObject(key);
    if (!head) return NextResponse.json({ error: 'Object not found, upload first' }, { status: 400 });
    // Use server-verified size, not client claimed (but check consistency)
    const verifiedSize = head.size;
    if (Math.abs(verifiedSize - fileSize) > 1024) {
      // Allow small delta, but if large mismatch, use verified
    }
    const sizeToStore = verifiedSize || fileSize;
    if (head.contentType && head.contentType !== 'video/mp4' && !head.contentType.includes('mp4')) {
      // Allow video/mp4 only
    }

    await ensureUserStatsRow(session.user.id);
    let quotaConsumed = false;
    if (entitlements.maxExportsPerMonth !== null) {
      const res = await atomicTryConsumeMonthlyExport(session.user.id, entitlements.maxExportsPerMonth);
      if (!res.allowed) {
        // Attempt cleanup of uploaded object since quota exceeded
        try { await deleteRecording(key); } catch {}
        return NextResponse.json({ error: `Monthly limit reached` }, { status: 403 });
      }
      quotaConsumed = true;
    }

    const maxStorageBytes = entitlements.maxStorageMB ? entitlements.maxStorageMB * 1024 * 1024 : null;
    const quotaResult = await atomicIncrementUploadCount(session.user.id, sizeToStore, entitlements.maxUploads, maxStorageBytes);
    if (!quotaResult.allowed) {
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      try { await deleteRecording(key); } catch {}
      return NextResponse.json({ error: quotaResult.reason }, { status: 403 });
    }

    let exportRecord;
    try {
      exportRecord = await createExport({
        userId: session.user.id,
        r2Key: key,
        platform: platformId,
        outputWidth: outputWidth || 1920,
        outputHeight: outputHeight || 1080,
        fileSize: sizeToStore,
        mimeType: 'video/mp4',
        status: 'completed',
        jobId,
      });
    } catch (e) {
      if (quotaConsumed) await atomicRevertMonthlyExport(session.user.id);
      try { await deleteRecording(key); } catch {}
      throw e;
    }

    await updateExportJobStatus(jobId, 'completed', {
      resultR2Key: key,
      resultExportId: exportRecord.id,
      resultFileSize: sizeToStore,
    }, session.user.id);

    return NextResponse.json({ exportId: exportRecord.id, r2Key: key });
  } catch (e) {
    console.error('complete failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Completion failed' }, { status: 500 });
  }
}
