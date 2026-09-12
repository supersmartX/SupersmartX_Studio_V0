import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findUserById, ensureMigrated } from '@/lib/db';
import { getDb } from '@/lib/db/driver';
import { listUserRecordings, deleteRecording } from '@/lib/r2';

export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const user = await findUserById(session.user.id);
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 401 });

    // 1. Identify all R2 objects owned by user (exports prefix)
    let r2Keys: string[] = [];
    try {
      // Get keys from DB first (authoritative)
      await ensureMigrated();
      const db = getDb();
      const result = await db.execute({
        sql: `SELECT r2_key FROM exports WHERE user_id = ?`,
        args: [session.user.id],
      });
      r2Keys = result.rows.map((r: any) => r.r2_key as string).filter((k: string) => k && !k.startsWith('local/'));
      // Also list via R2 prefix to catch any orphan jobs without DB row
      try {
        const listed = await listUserRecordings(`exports/${session.user.id}/`);
        for (const obj of listed) {
          if (!r2Keys.includes(obj.key)) r2Keys.push(obj.key);
        }
      } catch {}
    } catch (e) {
      console.warn('Failed to list R2 keys for deletion', e);
    }

    // 2. Delete R2 objects safely (idempotent)
    for (const key of r2Keys) {
      try {
        await deleteRecording(key);
      } catch (e: any) {
        const msg = e?.message || '';
        const isMissing = msg.includes('NotFound') || msg.includes('NoSuchKey');
        if (!isMissing) console.warn(`Failed to delete R2 object ${key}`, e);
        // Continue — treat missing as success
      }
    }

    // 3. Delete DB records (cascade will handle exports, export_jobs, monthly_export_counts, user_stats)
    // Do this after R2 deletion to avoid losing references
    await ensureMigrated();
    const db = getDb();
    try {
      await db.execute({ sql: `DELETE FROM exports WHERE user_id = ?`, args: [session.user.id] });
    } catch {}
    try {
      await db.execute({ sql: `DELETE FROM export_jobs WHERE user_id = ?`, args: [session.user.id] });
    } catch {}
    try {
      await db.execute({ sql: `DELETE FROM monthly_export_counts WHERE user_id = ?`, args: [session.user.id] });
    } catch {}
    try {
      await db.execute({ sql: `DELETE FROM user_stats WHERE user_id = ?`, args: [session.user.id] });
    } catch {}
    try {
      await db.execute({ sql: `DELETE FROM pending_orders WHERE user_id = ?`, args: [session.user.id] });
    } catch {}
    const delUser = await db.execute({ sql: `DELETE FROM users WHERE id = ?`, args: [session.user.id] });

    return NextResponse.json({ success: true, deletedR2Objects: r2Keys.length, userDeleted: delUser.rowsAffected > 0 });
  } catch (e) {
    console.error('Account deletion failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Deletion failed' }, { status: 500 });
  }
}
