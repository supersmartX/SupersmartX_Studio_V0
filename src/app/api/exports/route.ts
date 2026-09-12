import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { ensureMigrated } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureMigrated();
    const db = (await import('@/lib/db/driver')).getDb();
    const result = await db.execute({
      sql: `SELECT id, user_id, r2_key, platform, output_width, output_height, file_size, mime_type, status, created_at, job_id FROM exports WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
      args: [session.user.id],
    });
    const exports = result.rows.map(r => ({
      id: r.id as string,
      r2Key: r.r2_key as string,
      platform: r.platform as string,
      outputWidth: Number(r.output_width),
      outputHeight: Number(r.output_height),
      fileSize: Number(r.file_size),
      mimeType: r.mime_type as string,
      status: r.status as string,
      createdAt: r.created_at as string,
      jobId: r.job_id as string | null,
    }));
    return NextResponse.json({ exports });
  } catch (e) {
    console.error('list exports failed', e instanceof Error ? e.message : 'unknown');
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
