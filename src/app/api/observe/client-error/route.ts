import { NextRequest, NextResponse } from 'next/server';
import { logger, getRequestId } from '@/lib/observe/logger';

const ALLOWED_KINDS = new Set(['recording_failed', 'video_playback_failed', 'export_encoder_failed', 'export_failed']);

export async function POST(request: NextRequest) {
  try {
    const requestId = getRequestId(request);
    const body = await request.json().catch(() => ({}));
    const { kind, plan, duration, platform, browser } = body as {
      kind: string;
      plan?: string;
      duration?: number;
      platform?: string;
      browser?: string;
    };

    if (!kind || !ALLOWED_KINDS.has(kind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
    }

    // Never log video blob, script, URL
    logger.warn('client_error', {
      route: '/api/observe/client-error',
      requestId,
      kind,
      plan: plan?.slice(0, 20),
      duration: typeof duration === 'number' ? Math.round(duration) : undefined,
      platform: platform?.slice(0, 20),
      browser: browser?.slice(0, 30),
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
