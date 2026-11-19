import crypto from 'crypto';
import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { getPaddleClient, getPaddleEnvironment, isPaddleCheckoutEnabled, PaddleBillingProvider } from '@/lib/billing/paddle';
import { getPrisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isPaddleCheckoutEnabled()) {
    return NextResponse.json({ error: 'Paddle cancellation is unavailable' }, { status: 503 });
  }
  if (getPaddleEnvironment() !== 'sandbox') {
    return NextResponse.json({ error: 'Live Paddle subscription mutations are disabled' }, { status: 503 });
  }
  const prisma = getPrisma();
  const account = await prisma.billingAccount.findUnique({ where: { userId: session.user.id } });
  if (!account?.providerSubscriptionId) return NextResponse.json({ error: 'No Paddle subscription' }, { status: 404 });
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
  await prisma.$transaction([
    prisma.billingOperation.update({
      where: { id: operationId },
      data: { status: 'completed', completedAt: new Date() },
    }),
    prisma.billingAccount.update({
      where: { userId: session.user.id },
      data: { cancelAtPeriodEnd: true },
    }),
  ]);
  return NextResponse.json({
    status: 'cancellation_requested',
    paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
  });
}
