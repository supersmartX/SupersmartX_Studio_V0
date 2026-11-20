import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db/prisma';
import { getPaddleClient } from '@/lib/billing/paddle';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const prisma = getPrisma();
  const account = await prisma.billingAccount.findUnique({ where: { userId: session.user.id } });
  const transactions = await prisma.billingTransaction.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  let paymentMethodUpdateUrl: string | null = null;
  if (account?.providerSubscriptionId && ['past_due', 'payment_failed'].includes(account.status)) {
    try {
      const subscription = await getPaddleClient()?.subscriptions.get(account.providerSubscriptionId);
      const candidate = subscription?.managementUrls?.updatePaymentMethod;
      if (subscription?.id === account.providerSubscriptionId &&
          subscription.customerId === account.providerCustomerId && typeof candidate === 'string') {
        const url = new URL(candidate);
        if (url.protocol === 'https:' && !url.username && !url.password && !url.hash &&
            (url.hostname === 'paddle.com' || url.hostname.endsWith('.paddle.com'))) {
          paymentMethodUpdateUrl = url.toString();
        }
      }
    } catch {
      console.error('Paddle payment-method recovery link is unavailable');
    }
  }
  return NextResponse.json({
    account: account ? {
      plan: account.plan,
      status: account.status,
      paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
      nextChargeAt: account.nextChargeAt?.toISOString() ?? null,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      canceledAt: account.canceledAt?.toISOString() ?? null,
      paymentMethodUpdateUrl,
    } : null,
    transactions: transactions.map((tx) => ({
      id: tx.providerTransactionId,
      status: tx.status,
      amount: Number(tx.amount),
      currency: tx.currency,
      paidAt: tx.paidAt?.toISOString() ?? null,
      refundedAt: tx.refundedAt?.toISOString() ?? null,
      disputedAt: tx.disputedAt?.toISOString() ?? null,
      createdAt: tx.createdAt.toISOString(),
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
