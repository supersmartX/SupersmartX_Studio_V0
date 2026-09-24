import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findExportJobByIdAndUser, updateExportJobStatus } from '@/lib/db';
import type { ExportJobStatus } from '@/types/db';

const VALID_TRANSITIONS: Record<string, ExportJobStatus[]> = {
  pending: ['encoding', 'failed'],
  encoding: ['uploading', 'failed'],
  uploading: ['completed', 'failed'],
};

export async function PATCH(
  request: NextRequest,
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

    const body = await request.json();
    const { status, progress, resultR2Key, resultExportId, resultFileSize, errorMessage } = body;

    // Progress reporting re-sends the CURRENT status (e.g. encoding +
    // progress 10/20/30). Same-state updates are progress writes, not state
    // transitions, so they are always allowed. Genuine transitions still
    // require the map — and terminal states (completed/failed) have no
    // outgoing entries, so they can never leave their state.
    if (status && status !== job.status && !VALID_TRANSITIONS[job.status]?.includes(status)) {
      return NextResponse.json(
        { error: `Invalid transition: ${job.status} → ${status}` },
        { status: 400 },
      );
    }

    // Validate field types and ranges
    if (progress !== undefined && (typeof progress !== 'number' || progress < 0 || progress > 100)) {
      return NextResponse.json({ error: 'Progress must be a number between 0 and 100' }, { status: 400 });
    }
    if (resultFileSize !== undefined && (typeof resultFileSize !== 'number' || resultFileSize < 0)) {
      return NextResponse.json({ error: 'Invalid file size' }, { status: 400 });
    }
    // resultR2Key is owner-namespaced storage state: clients must not point a
    // job at another user's object or an arbitrary key. The authoritative key
    // binding happens in /api/exports/complete (key-match check); this prefix
    // check is defense-in-depth at the earliest write.
    if (resultR2Key !== undefined) {
      const expectedPrefix = `exports/${session.user.id}/`;
      if (typeof resultR2Key !== 'string' || !resultR2Key.startsWith(expectedPrefix)) {
        return NextResponse.json({ error: 'Invalid result key' }, { status: 400 });
      }
    }
    if (resultExportId !== undefined && (typeof resultExportId !== 'string' || resultExportId.length > 200)) {
      return NextResponse.json({ error: 'Invalid export id' }, { status: 400 });
    }

    // Sanitize errorMessage
    const sanitizedError = typeof errorMessage === 'string'
      ? errorMessage.slice(0, 500).replace(/<[^>]*>/g, '')
      : undefined;

    await updateExportJobStatus(id, status || job.status, {
      progress,
      resultR2Key,
      resultExportId,
      resultFileSize,
      errorMessage: sanitizedError,
    }, session.user.id);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Update export job failed:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Failed to update job' }, { status: 500 });
  }
}
