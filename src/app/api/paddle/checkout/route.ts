import crypto from 'crypto';
import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  assertSandboxPriceMatches,
  getPaddleClient,
  getPaddleEnvironment,
  getTrustedPaddleCountry,
  isPaddleCheckoutEnabled,
  isSafePaddleCheckoutUrl,
  PaddlePriceLookupError,
  PaddlePriceMismatchError,
  PaddleBillingProvider,
  verifySandboxQuoteToken,
} from '@/lib/billing/paddle';
import {
  ActiveBillingSubscriptionError,
  hashCheckoutConsent,
  reserveCheckout,
  UnresolvedCheckoutReservationError,
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
      body.consentVersion !== '2' || typeof body.currency !== 'string' ||
      typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 ||
      typeof body.period !== 'string' || typeof body.quoteToken !== 'string' ||
      typeof body.consentHash !== 'string') {
    return NextResponse.json({ error: 'Invalid checkout consent' }, { status: 400 });
  }
  const quote = verifySandboxQuoteToken(body.quoteToken);
  if (!quote || quote.country !== getTrustedPaddleCountry(request.headers) ||
      quote.plan !== body.plan || quote.period !== body.period ||
      quote.amount !== body.amount || quote.currency !== body.currency) {
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
    const price = await assertSandboxPriceMatches(paddle, body.plan);
    if (price.productId !== quote.productId || price.id !== quote.priceId) {
      throw new PaddlePriceMismatchError('price_identity');
    }
  } catch (error) {
    if (error instanceof PaddlePriceLookupError) {
      console.error('Paddle sandbox price lookup failed', { statusCode: error.statusCode });
      return NextResponse.json({
        error: 'Paddle sandbox price verification is temporarily unavailable',
      }, { status: 503 });
    }
    console.error('Paddle sandbox price validation failed', {
      reason: error instanceof PaddlePriceMismatchError
        ? error.reason
        : 'unexpected_verification_error',
    });
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
    if (error instanceof UnresolvedCheckoutReservationError) {
      return NextResponse.json({
        error: 'An unresolved checkout already exists. Check its status before starting another.',
        reservationId: error.reservationId,
      }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The partial unique index remains the concurrency authority. If another
      // request won the race between the lookup and insert, return that
      // reservation so the customer can recover it instead of getting stuck.
      let existingReservation: { id: string } | null = null;
      try {
        existingReservation = await getPrisma().billingReservation.findFirst({
          where: { userId: session.user.id, status: { in: ['reserved', 'pending'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
      } catch {
        console.error('Paddle checkout conflict recovery lookup failed');
      }
      return NextResponse.json({
        error: 'An unresolved checkout already exists. Check its status before starting another.',
        ...(existingReservation ? { reservationId: existingReservation.id } : {}),
      }, { status: 409 });
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
    try {
      await getPrisma().billingReservation.update({
        where: { id: reservationId },
        data: { status: 'pending', remoteStatus: 'provider_create_uncertain' },
      });
    } catch {
      // The reservation was committed before contacting Paddle. Keep its ID
      // available to the customer so the recovery endpoint can reconcile it.
      console.error('Paddle checkout uncertainty could not be persisted', { reservationId });
    }
    return NextResponse.json({
      error: 'Checkout creation outcome is uncertain. Check its status before trying again.',
      reservationId,
    }, { status: 503 });
  }
  try {
    await reserveCheckout({
      ...consent,
      consentHash,
      userId: session.user.id,
      reservationId,
      providerOperationId: result.providerOperationId,
      providerTransactionId: result.transactionId,
    });
  } catch {
    // Paddle may already have created the transaction. Do not return an
    // unhandled 500 or ask the customer to create another transaction: the
    // committed reservation is the recovery key for matching its metadata.
    console.error('Paddle checkout transaction link persistence failed', { reservationId });
    return NextResponse.json({
      error: 'Checkout was created but its status could not be saved. Check its status before trying again.',
      reservationId,
    }, { status: 503 });
  }
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
