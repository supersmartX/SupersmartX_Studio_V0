import crypto from 'crypto';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { getPaddleClient, isPaddleCheckoutEnabled, PaddleBillingProvider } from '@/lib/billing/paddle';
import { recordCancellationRequest } from '@/lib/billing/operations';
import { getPrisma } from '@/lib/db/prisma';
import { rateLimitDistributed } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

const CANCEL_RATE_LIMIT_MAX = 10;
const CANCEL_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = await rateLimitDistributed(`paddle-cancel:${session.user.id}`, CANCEL_RATE_LIMIT_MAX, CANCEL_RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many cancellation attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    );
  }
  if (!isPaddleCheckoutEnabled()) {
    return NextResponse.json({ error: 'Paddle cancellation is unavailable' }, { status: 503 });
  }
  const prisma = getPrisma();
  const account = await prisma.billingAccount.findUnique({ where: { userId: session.user.id } });
  if (!account?.providerSubscriptionId || account.status !== 'active' ||
      !account.paidThroughAt || account.paidThroughAt <= new Date()) {
    return NextResponse.json({ error: 'No eligible active Paddle subscription' }, { status: 404 });
  }
  if (account.cancelAtPeriodEnd) {
    return NextResponse.json({
      status: 'cancellation_requested',
      paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
    });
  }

  const unresolved = await prisma.billingOperation.findFirst({
    where: {
      userId: session.user.id,
      resourceId: account.providerSubscriptionId,
      operation: 'cancel_at_period_end',
      status: { in: ['pending', 'uncertain'] },
    },
  });
  if (unresolved) {
    return NextResponse.json({
      status: 'cancellation_pending_reconciliation',
      operationId: unresolved.id,
      paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
    }, { status: 202 });
  }

  const paddle = getPaddleClient();
  if (!paddle) return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });
  const operationId = crypto.randomUUID();
  await prisma.billingOperation.create({
    data: {
      id: operationId,
      userId: session.user.id,
      operation: 'cancel_at_period_end',
      resourceId: account.providerSubscriptionId,
      status: 'pending',
      payloadJson: JSON.stringify({ effectiveFrom: 'next_billing_period' }),
    },
  });
  try {
    const subscription = await new PaddleBillingProvider(paddle).cancelAtPeriodEnd(account.providerSubscriptionId);
    if (subscription.scheduledChange?.action !== 'cancel') {
      throw new Error('Paddle did not confirm the scheduled cancellation');
    }
  } catch {
    await prisma.billingOperation.update({
      where: { id: operationId },
      data: { status: 'uncertain', lastError: 'provider_cancellation_outcome_uncertain' },
    });
    return NextResponse.json({
      error: 'Cancellation outcome is uncertain; do not retry. The provider update will be reconciled.',
      operationId,
    }, { status: 503 });
  }
  try {
    await recordCancellationRequest({
      userId: session.user.id,
      subscriptionId: account.providerSubscriptionId,
      operationId,
    });
  } catch {
    // Paddle already scheduled the cancellation. The pending operation is the
    // recovery key; the worker's reconciliation applies it without a retry.
    console.error('Paddle cancellation was confirmed but could not be recorded', { operationId });
    return NextResponse.json({
      status: 'cancellation_pending_reconciliation',
      operationId,
      paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
    }, { status: 202 });
  }
  return NextResponse.json({
    status: 'cancellation_requested',
    paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
  });
}
