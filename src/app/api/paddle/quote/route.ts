import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import type { BillingPeriod } from '@/lib/billing/contracts';
import {
  createSandboxCheckoutQuote,
  getPaddleClient,
  getPaddleEnvironment,
  getTrustedPaddleCountry,
  isPaddleCheckoutEnabled,
  PaddlePriceLookupError,
  PaddlePriceMismatchError,
} from '@/lib/billing/paddle';
import { rateLimitDistributed } from '@/lib/rate-limit';
import { readBoundedBody } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

const QUOTE_RATE_LIMIT_MAX = 60;
const QUOTE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_QUOTE_BODY_BYTES = 8_192;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = await rateLimitDistributed(`paddle-quote:${session.user.id}`, QUOTE_RATE_LIMIT_MAX, QUOTE_RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many quote requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  if (!isPaddleCheckoutEnabled()) {
    return NextResponse.json({
      error: getPaddleEnvironment() === 'live'
        ? 'Live Paddle checkout is disabled'
        : 'Paddle checkout is unavailable',
    }, { status: 503 });
  }

  const raw = await readBoundedBody(request, MAX_QUOTE_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Quote request is too large' }, { status: 413 });
  }
  let body: { period?: unknown } | null = null;
  try {
    body = JSON.parse(raw) as { period?: unknown } | null;
  } catch {
    body = null;
  }
  if (body?.period !== 'monthly' && body?.period !== 'yearly') {
    return NextResponse.json({ error: 'Invalid billing period' }, { status: 400 });
  }
  const period: BillingPeriod = body.period;
  const paddle = getPaddleClient();
  if (!paddle) {
    return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });
  }
  try {
    const quote = await createSandboxCheckoutQuote(
      paddle,
      period === 'yearly' ? 'creator_yearly' : 'creator_monthly',
      getTrustedPaddleCountry(request.headers),
    );
    return NextResponse.json(quote, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PaddlePriceLookupError) {
      console.error('Paddle sandbox price lookup failed', { statusCode: error.statusCode });
    } else {
      console.error('Paddle sandbox quote validation failed', {
        reason: error instanceof PaddlePriceMismatchError
          ? error.reason
          : 'unexpected_quote_error',
      });
    }
    return NextResponse.json({ error: 'Paddle sandbox quote is not configured' }, { status: 503 });
  }
}
