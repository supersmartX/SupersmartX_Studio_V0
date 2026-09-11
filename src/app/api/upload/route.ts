import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { uploadRecording, generateRecordingKey, isR2Configured } from '@/lib/r2';
import { atomicIncrementUploadCount, ensureUserStatsRow, findUserById } from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rate-limit';
import type { PlanType } from '@/types/db';

const UPLOAD_RATE_LIMIT_MAX = 10;
const UPLOAD_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
const ALLOWED_MIME_TYPES = [
  'video/webm',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/mp4;codecs=h264',
];
const ALLOWED_EXTENSIONS = ['webm', 'mp4'];

function sanitizeExtension(ext: string): string | null {
  const cleaned = ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ALLOWED_EXTENSIONS.includes(cleaned) ? cleaned : null;
}

function sanitizeMetadataValue(val: string): string {
  return val.replace(/[<>"'&]/g, '').trim().slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
    }

    const rl = rateLimit(`upload:${session.user.id}`, UPLOAD_RATE_LIMIT_MAX, UPLOAD_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Upload rate limit exceeded. Please try again later.' },
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
      return NextResponse.json({ error: 'Upgrade required to upload recordings' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const mimeType = formData.get('mimeType') as string || 'video/webm';
    const extension = formData.get('extension') as string || 'webm';
    const duration = formData.get('duration') as string || '0';
    const width = formData.get('width') as string || '0';
    const height = formData.get('height') as string || '0';
    const aspectRatio = formData.get('aspectRatio') as string || '16:9';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'File too large (max 100MB)' }, { status: 413 });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: 'Empty file' }, { status: 400 });
    }

    if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
    }

    const safeExtension = sanitizeExtension(extension);
    if (!safeExtension) {
      return NextResponse.json({ error: 'Invalid extension' }, { status: 400 });
    }

    // Duration check
    const durationNum = parseFloat(duration);
    if (durationNum > entitlements.maxDurationSeconds) {
      return NextResponse.json(
        { error: `Recording too long. Maximum is ${entitlements.maxDurationSeconds} seconds on your plan` },
        { status: 403 },
      );
    }

    // Resolution check
    const widthNum = parseInt(width, 10);
    const heightNum = parseInt(height, 10);
    if (widthNum > entitlements.maxResolution.width || heightNum > entitlements.maxResolution.height) {
      return NextResponse.json(
        { error: `Resolution too high. Maximum is ${entitlements.maxResolution.width}x${entitlements.maxResolution.height} on your plan` },
        { status: 403 },
      );
    }

    // Atomic upload count and storage check — prevents race condition
    await ensureUserStatsRow(session.user.id);
    const maxStorageBytes = entitlements.maxStorageMB ? entitlements.maxStorageMB * 1024 * 1024 : null;
    const quotaResult = await atomicIncrementUploadCount(
      session.user.id,
      file.size,
      entitlements.maxUploads,
      maxStorageBytes,
    );
    if (!quotaResult.allowed) {
      return NextResponse.json({ error: quotaResult.reason }, { status: 403 });
    }

    const key = generateRecordingKey(session.user.id, safeExtension);

    await uploadRecording(
      key,
      file,
      {
        userId: session.user.id,
        mimeType,
        extension: safeExtension,
        duration: sanitizeMetadataValue(duration),
        width: sanitizeMetadataValue(width),
        height: sanitizeMetadataValue(height),
        aspectRatio: sanitizeMetadataValue(aspectRatio),
        uploadedAt: new Date().toISOString(),
      }
    );

    // Upload count already incremented atomically above

    return NextResponse.json({
      success: true,
      key,
      recordingId: key.split('/').pop()?.replace(/\.[^.]+$/, '') || '',
    });
  } catch {
    console.error('Upload failed');
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
