import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { BillingPeriod } from '@/lib/billing/contracts';
import { getPaddleEnvironment, getSandboxQuote, isPaddleCheckoutEnabled } from '@/lib/billing/paddle';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPaddleCheckoutEnabled()) {
    return NextResponse.json({
      error: getPaddleEnvironment() === 'live'
        ? 'Live Paddle checkout is disabled'
        : 'Paddle checkout is unavailable',
    }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as { period?: unknown } | null;
  if (body?.period !== 'monthly' && body?.period !== 'yearly') {
    return NextResponse.json({ error: 'Invalid billing period' }, { status: 400 });
  }
  const period: BillingPeriod = body.period;
  const quote = getSandboxQuote(period === 'yearly' ? 'creator_yearly' : 'creator_monthly');
  if (!quote) {
    return NextResponse.json({ error: 'Paddle sandbox quote is not configured' }, { status: 503 });
  }
  return NextResponse.json(quote, { headers: { 'Cache-Control': 'no-store' } });
}
