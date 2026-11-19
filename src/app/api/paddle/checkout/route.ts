import crypto from 'crypto';
import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  assertSandboxPriceMatches,
  getPaddleClient,
  getPaddleEnvironment,
  getSandboxQuote,
  isPaddleCheckoutEnabled,
  isSafePaddleCheckoutUrl,
  PaddleBillingProvider,
} from '@/lib/billing/paddle';
import {
  ActiveBillingSubscriptionError,
  hashCheckoutConsent,
  reserveCheckout,
} from '@/lib/billing/operations';
import { getPrisma } from '@/lib/db/prisma';
import type { CheckoutConsent } from '@/lib/billing/contracts';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPaddleCheckoutEnabled()) {
    return NextResponse.json({
      error: getPaddleEnvironment() === 'live'
        ? 'Live Paddle checkout is disabled'
        : 'Paddle checkout is unavailable',
    }, { status: 503 });
  }

  const body = await request.json().catch(() => null) as Partial<CheckoutConsent> | null;
  if (!body || (body.plan !== 'creator_monthly' && body.plan !== 'creator_yearly') ||
      body.consentVersion !== '1' || typeof body.currency !== 'string' ||
      typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 ||
      typeof body.consentHash !== 'string') {
    return NextResponse.json({ error: 'Invalid checkout consent' }, { status: 400 });
  }
  const quote = getSandboxQuote(body.plan);
  if (!quote || quote.period !== body.period || quote.amount !== body.amount || quote.currency !== body.currency) {
    return NextResponse.json({ error: 'Checkout quote no longer matches server pricing' }, { status: 409 });
  }
  const consent = body as CheckoutConsent;
  const consentHash = hashCheckoutConsent(consent);
  if (body.consentHash !== consentHash) {
    return NextResponse.json({ error: 'Checkout consent changed' }, { status: 409 });
  }

  const paddle = getPaddleClient();
  if (!paddle) return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });
  try {
    await assertSandboxPriceMatches(paddle, body.plan, body.amount, quote.currency);
  } catch {
    return NextResponse.json({ error: 'Paddle sandbox price does not match the confirmed quote' }, { status: 503 });
  }

  const provider = new PaddleBillingProvider(paddle);
  const reservationId = crypto.randomUUID();
  try {
    await reserveCheckout({
      ...consent,
      consentHash,
      userId: session.user.id,
      reservationId,
    });
  } catch (error) {
    if (error instanceof ActiveBillingSubscriptionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'An unresolved checkout already exists' }, { status: 409 });
    }
    console.error('Paddle checkout reservation failed');
    return NextResponse.json({ error: 'Checkout could not be reserved' }, { status: 500 });
  }

  let result;
  try {
    result = await provider.createSandboxCheckout({
      ...consent,
      consentHash,
      userId: session.user.id,
      reservationId,
    });
  } catch {
    await getPrisma().billingReservation.update({
      where: { id: reservationId },
      data: { status: 'pending', remoteStatus: 'provider_create_uncertain' },
    });
    return NextResponse.json({
      error: 'Checkout creation outcome is uncertain; do not retry. Support must reconcile this reservation.',
      reservationId,
    }, { status: 503 });
  }
  await reserveCheckout({
    ...consent,
    consentHash,
    userId: session.user.id,
    reservationId,
    providerOperationId: result.providerOperationId,
    providerTransactionId: result.transactionId,
  });
  if (!result.checkoutUrl || !isSafePaddleCheckoutUrl(result.checkoutUrl)) {
    return NextResponse.json({
      error: 'Paddle created a transaction without a safe checkout URL; do not retry.',
      reservationId,
      transactionId: result.transactionId,
    }, { status: 503 });
  }

  return NextResponse.json({
    reservationId,
    providerOperationId: result.providerOperationId,
    transactionId: result.transactionId,
    checkoutUrl: result.checkoutUrl,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
