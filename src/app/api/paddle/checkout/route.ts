import crypto from 'crypto';
import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import {
  assertSandboxPriceMatches,
  describeCheckoutCreateFailure,
  getPaddleCheckoutUrl,
  getPaddleClient,
  getPaddleEnvironment,
  getTrustedPaddleCountry,
  isPaddleCheckoutEnabled,
  PaddleCheckoutCreateError,
  PaddlePriceLookupError,
  PaddlePriceMismatchError,
  PaddleBillingProvider,
  toPaddleHandoffUrl,
  verifySandboxQuoteToken,
} from '@/lib/billing/paddle';
import {
  ActiveBillingSubscriptionError,
  clearEndedBillingSubscription,
  hashCheckoutConsent,
  reserveCheckout,
  UnresolvedCheckoutReservationError,
} from '@/lib/billing/operations';
import {
  expireStaleUnclaimedCheckoutReservations,
  failUnclaimedReservation,
  recoverCheckoutReservation,
  requestPaidCheckoutReconciliation,
  type CheckoutRecovery,
} from '@/lib/billing/reservations';
import { getBillingReadiness } from '@/lib/billing/readiness';
import { getPrisma } from '@/lib/db/prisma';
import { rateLimitDistributed } from '@/lib/rate-limit';
import { readBoundedBody } from '@/lib/request-body';
import type { CheckoutRequest } from '@/lib/billing/contracts';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

const CHECKOUT_RATE_LIMIT_MAX = 20;
const CHECKOUT_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_CHECKOUT_BODY_BYTES = 8_192;
const CONSENT_HASH_PATTERN = /^[0-9a-f]{64}$/;
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'paused', 'payment_failed'];

// A repeated Subscribe is answered from the existing reservation instead of
// creating a second provider transaction. Customer-facing text never mentions
// reservations, transaction states or the provider.
function checkoutRecoveryResponse(recovery: CheckoutRecovery): NextResponse | null {
  if (recovery.kind === 'resume') {
    return NextResponse.json({
      reservationId: recovery.reservationId,
      providerOperationId: recovery.transactionId,
      transactionId: recovery.transactionId,
      checkoutUrl: recovery.checkoutUrl,
      resumed: true,
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  if (recovery.kind === 'awaiting_payment') {
    // Provider state may already hold money, but checkout creation is not
    // proof of entitlement. Keep the original transaction protected while
    // reconciliation completes; never present this as payment success.
    return NextResponse.json({
      state: 'payment_verification_pending',
      reservationId: recovery.reservationId,
      retryAllowed: false,
      checkoutUrl: null,
      transactionId: recovery.transactionId,
      remoteStatus: recovery.remoteStatus,
      message: 'A previous checkout is still being verified. No new payment was started.',
    }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  if (recovery.kind === 'pending') {
    return NextResponse.json({
      error: 'We are still confirming your previous checkout. Please check its status before trying again.',
      reservationId: recovery.reservationId,
    }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
  }
  return null;
}

async function enqueuePaidReconciliation(recovery: CheckoutRecovery): Promise<void> {
  if (recovery.kind !== 'awaiting_payment') return;
  if (recovery.remoteStatus !== 'paid' && recovery.remoteStatus !== 'completed') return;
  try {
    await requestPaidCheckoutReconciliation({
      reservation: {
        id: recovery.reservationId,
        userId: recovery.userId,
        plan: recovery.plan,
        consentHash: recovery.consentHash,
      },
      transactionId: recovery.transactionId,
    });
  } catch {
    console.error('Paid checkout reconciliation could not be queued');
  }
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = await rateLimitDistributed(`paddle-checkout:${session.user.id}`, CHECKOUT_RATE_LIMIT_MAX, CHECKOUT_RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many checkout attempts. Please try again later.' },
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

  const raw = await readBoundedBody(request, MAX_CHECKOUT_BODY_BYTES);
  if (raw === null) {
    return NextResponse.json({ error: 'Checkout request is too large' }, { status: 413 });
  }
  let body: Partial<CheckoutRequest> | null = null;
  try {
    body = JSON.parse(raw) as Partial<CheckoutRequest> | null;
  } catch {
    body = null;
  }
  if (!body || (body.plan !== 'creator_monthly' && body.plan !== 'creator_yearly') ||
      body.consentVersion !== '2' || typeof body.currency !== 'string' ||
      typeof body.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0 ||
      typeof body.period !== 'string' || typeof body.quoteToken !== 'string' ||
      body.quoteToken.length > 4096 ||
      typeof body.consentHash !== 'string' || !CONSENT_HASH_PATTERN.test(body.consentHash)) {
    return NextResponse.json({ error: 'Invalid checkout consent' }, { status: 400 });
  }
  const quote = verifySandboxQuoteToken(body.quoteToken);
  if (!quote || quote.country !== getTrustedPaddleCountry(request.headers) ||
      quote.plan !== body.plan || quote.period !== body.period ||
      quote.amount !== body.amount || quote.currency !== body.currency) {
    return NextResponse.json({ error: 'Checkout quote no longer matches server pricing' }, { status: 409 });
  }
  const consent = body as CheckoutRequest;
  const consentHash = hashCheckoutConsent(consent);
  if (body.consentHash !== consentHash) {
    return NextResponse.json({ error: 'Checkout consent changed' }, { status: 409 });
  }

  const paddle = getPaddleClient();
  if (!paddle) return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });
  const readiness = getBillingReadiness();
  if (!readiness.ready) {
    console.error('Paddle checkout blocked because billing fulfilment is not ready', {
      issues: readiness.issues,
    });
    return NextResponse.json({
      error: 'Paddle checkout is unavailable while payment fulfilment is being verified',
    }, { status: 503 });
  }
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
  if (!getPaddleCheckoutUrl()) {
    return NextResponse.json({ error: 'Paddle payment page is not configured' }, { status: 503 });
  }
  try {
    const account = await getPrisma().billingAccount.findUnique({
      where: { userId: session.user.id },
      select: {
        providerSubscriptionId: true,
        providerCustomerId: true,
        paidThroughAt: true,
      },
    });
    if (account?.providerSubscriptionId &&
        (!account.paidThroughAt || account.paidThroughAt <= new Date())) {
      const oldSubscription = await paddle.subscriptions.get(account.providerSubscriptionId);
      if (oldSubscription.id !== account.providerSubscriptionId ||
          oldSubscription.customerId !== account.providerCustomerId ||
          !['canceled', 'expired'].includes(oldSubscription.status)) {
        return NextResponse.json({
          error: 'Your existing subscription is still being verified. Please try again shortly.',
        }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
      const cleared = await clearEndedBillingSubscription({
        userId: session.user.id,
        subscriptionId: account.providerSubscriptionId,
      });
      if (!cleared) {
        return NextResponse.json({
          error: 'Your existing subscription is still being verified. Please try again shortly.',
        }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      }
    }
  } catch {
    console.error('Paddle subscription expiry could not be verified');
    return NextResponse.json({
      error: 'Your existing subscription is still being verified. Please try again shortly.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  // A valid subscription takes precedence over any stale checkout reservation.
  // Keep the database guard in reserveCheckout as the concurrency authority.
  try {
    const account = await getPrisma().billingAccount.findUnique({
      where: { userId: session.user.id },
      select: {
        providerSubscriptionId: true,
        plan: true,
        status: true,
        nextChargeAt: true,
        paidThroughAt: true,
        cancelAtPeriodEnd: true,
      },
    });
    if (account?.providerSubscriptionId &&
        (ACTIVE_SUBSCRIPTION_STATUSES.includes(account.status) ||
          Boolean(account.paidThroughAt && account.paidThroughAt > new Date()))) {
      return NextResponse.json({
        state: ['past_due', 'payment_failed'].includes(account.status)
          ? 'payment_action_required'
          : 'active_subscription',
        subscription: {
          plan: account.plan,
          status: account.status,
          nextChargeAt: account.nextChargeAt?.toISOString() ?? null,
          paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
          cancelAtPeriodEnd: account.cancelAtPeriodEnd,
        },
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
  } catch {
    console.error('Paddle subscription state lookup failed');
    return NextResponse.json({
      error: 'Your subscription status could not be checked. Please try again shortly.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const reconciled = await expireStaleUnclaimedCheckoutReservations({
      userId: session.user.id,
      paddle,
    });
    if (reconciled.expired.length > 0 || reconciled.linked.length > 0) {
      console.warn('Reconciled stale Paddle checkout reservations', {
        expired: reconciled.expired.length,
        linked: reconciled.linked.length,
      });
    }
  } catch {
    // Reconciliation is an optimisation: reserveCheckout still blocks on a
    // stale row, and the status endpoint can expire it on demand.
    console.error('Stale Paddle checkout reservation reconciliation failed');
  }

  // Reuse an existing checkout whenever it can still take payment. This is what
  // makes a repeated Subscribe idempotent: the customer returns to the same
  // transaction, and Paddle never receives a second create call.
  let recovery: CheckoutRecovery = { kind: 'none' };
  try {
    recovery = await recoverCheckoutReservation({ userId: session.user.id, paddle });
  } catch {
    console.error('Paddle checkout recovery lookup failed');
  }
  const recovered = checkoutRecoveryResponse(recovery);
  if (recovered) {
    await enqueuePaidReconciliation(recovery);
    return recovered;
  }
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
      return NextResponse.json({
        state: ['past_due', 'payment_failed'].includes(error.subscription.status)
          ? 'payment_action_required'
          : 'active_subscription',
        subscription: error.subscription,
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof UnresolvedCheckoutReservationError) {
      // A concurrent request may have finished linking its transaction between
      // our recovery pass and the reservation gate, so try once more before
      // falling back to a blocking answer.
      let conflicted: CheckoutRecovery = { kind: 'none' };
      try {
        conflicted = await recoverCheckoutReservation({ userId: session.user.id, paddle });
      } catch {
        console.error('Paddle checkout conflict recovery lookup failed');
      }
      const conflictResponse = checkoutRecoveryResponse(conflicted);
      if (conflictResponse) {
        await enqueuePaidReconciliation(conflicted);
        return conflictResponse;
      }
      return NextResponse.json({
        error: 'An unresolved checkout already exists. Check its status before starting another.',
        reservationId: error.reservationId,
      }, { status: 409 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The partial unique index remains the concurrency authority. If another
      // request won the race between the lookup and insert, recover whatever it
      // created so a double click resumes that checkout instead of duplicating.
      let conflicted: CheckoutRecovery = { kind: 'none' };
      try {
        conflicted = await recoverCheckoutReservation({ userId: session.user.id, paddle });
      } catch {
        console.error('Paddle checkout conflict recovery lookup failed');
      }
      const conflictResponse = checkoutRecoveryResponse(conflicted);
      if (conflictResponse) {
        await enqueuePaidReconciliation(conflicted);
        return conflictResponse;
      }
      let existingReservation: { id: string } | null = null;
      try {
        existingReservation = await getPrisma().billingReservation.findFirst({
          where: { userId: session.user.id, status: { in: ['reserved', 'pending'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        });
      } catch {
        console.error('Paddle checkout conflict recovery fallback lookup failed');
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
  } catch (error) {
    const failure = error instanceof PaddleCheckoutCreateError
      ? error.failure
      : describeCheckoutCreateFailure(error);
    console.error('Paddle checkout create failed', {
      kind: failure.kind,
      reason: failure.reason,
      status: failure.status,
      fields: failure.fields,
      reservationId,
    });
    if (failure.kind === 'rejected') {
      // Paddle refused before creating anything, so releasing the reservation
      // is exact: the retry cannot duplicate a live checkout. If the release
      // does not land, fall through to the blocking reply so the reservation
      // is not silently presented as retryable.
      let released = false;
      try {
        released = await failUnclaimedReservation({ id: reservationId, userId: session.user.id });
      } catch {
        console.error('Paddle rejected checkout reservation could not be released', { reservationId });
      }
      if (released) {
        return NextResponse.json({
          error: 'Paddle declined this checkout attempt. No payment was taken, so you can try again.',
          reason: failure.reason,
          retryAllowed: true,
        }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
      }
    }
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
  const checkoutUrl = result.checkoutUrl && result.transactionId
    ? toPaddleHandoffUrl(result.checkoutUrl, result.transactionId)
    : null;
  if (!checkoutUrl) {
    console.error('Paddle checkout transaction has no safe handoff URL', {
      reservationId,
      transactionId: result.transactionId,
      returnedCheckoutUrl: Boolean(result.checkoutUrl),
    });
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
    checkoutUrl,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
