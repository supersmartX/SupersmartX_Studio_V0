import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { BillingPeriod } from '@/lib/billing/contracts';
import { getSandboxQuote } from '@/lib/billing/paddle';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (process.env.PADDLE_LIVE_CHECKOUT_DISABLED !== 'true') {
    return NextResponse.json({ error: 'Paddle checkout is disabled' }, { status: 503 });
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
