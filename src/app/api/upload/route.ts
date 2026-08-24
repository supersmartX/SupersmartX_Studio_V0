import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { uploadRecording, generateRecordingKey, isR2Configured } from '@/lib/r2';

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
