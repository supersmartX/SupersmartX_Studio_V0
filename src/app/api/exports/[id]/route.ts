import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findExportByIdAndUser, findUserById, ensureMigrated } from '@/lib/db';
import { deleteRecording } from '@/lib/r2';
import { getDb } from '@/lib/db/driver';
import { rateLimit } from '@/lib/rate-limit';

// Phase 2.9: deletion is a high-risk export mutation (DB row + R2 object), so
// it carries the same per-user boundary as export creation (30/h).
const DELETE_RATE_LIMIT_MAX = 30;
const DELETE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const rl = rateLimit(`export-delete:${session.user.id}`, DELETE_RATE_LIMIT_MAX, DELETE_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    const { id } = await params;
    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });
    const exp = await findExportByIdAndUser(id, session.user.id);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    // Delete R2 object if not local
    if (exp.r2Key && !exp.r2Key.startsWith('local/')) {
      try { await deleteRecording(exp.r2Key); } catch (e) { console.warn('R2 delete failed', e); }
    }
    await ensureMigrated();
    const db = getDb();
    await db.execute({ sql: `DELETE FROM exports WHERE id = ? AND user_id = ?`, args: [id, session.user.id] });
    // Optionally update user storage counters — decrement storage_bytes
    try {
      await db.execute({ sql: `UPDATE user_stats SET storage_bytes = MAX(0, storage_bytes - ?) WHERE user_id = ?`, args: [exp.fileSize, session.user.id] });
    } catch {}
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('delete export failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const { id } = await params;
    const exp = await findExportByIdAndUser(id, session.user.id);
    if (!exp) return NextResponse.json({ error: 'Export not found' }, { status: 404 });
    return NextResponse.json({ export: exp });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
