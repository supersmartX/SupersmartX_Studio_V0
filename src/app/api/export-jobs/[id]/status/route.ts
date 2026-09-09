import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findExportJobByIdAndUser } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const job = await findExportJobByIdAndUser(id, session.user.id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: job.id,
      status: job.status,
      progress: job.progress,
      resultR2Key: job.resultR2Key,
      resultExportId: job.resultExportId,
      resultFileSize: job.resultFileSize,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    });
  } catch (error) {
    console.error('Get export job status failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to get job status' }, { status: 500 });
  }
}
