import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { uploadRecording, generateRecordingKey, isR2Configured } from '@/lib/r2';

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

    const key = generateRecordingKey(session.user.id, extension);

    await uploadRecording(
      key,
      file,
      {
        userId: session.user.id,
        mimeType,
        extension,
        duration,
        width,
        height,
        aspectRatio,
        uploadedAt: new Date().toISOString(),
      }
    );

    return NextResponse.json({
      success: true,
      key,
      recordingId: key.split('/').pop()?.replace(/\.[^.]+$/, '') || '',
    });
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
