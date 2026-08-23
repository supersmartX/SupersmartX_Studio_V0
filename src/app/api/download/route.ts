import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getSignedDownloadUrl, isR2Configured } from '@/lib/r2';

export async function GET(request: NextRequest) {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userPlan = session.user.plan || 'free';

    if (userPlan === 'free') {
      return NextResponse.json({ error: 'Pro plan required' }, { status: 403 });
    }

    if (!isR2Configured()) {
      return NextResponse.json({ error: 'Storage not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: 'Missing key parameter' }, { status: 400 });
    }

    if (!key.startsWith(`recordings/${session.user.id}/`)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = await getSignedDownloadUrl(key, 3600);

    return NextResponse.json({ url, expiresIn: 3600 });
  } catch (error) {
    console.error('Download error:', error);
    return NextResponse.json({ error: 'Download failed' }, { status: 500 });
  }
}
