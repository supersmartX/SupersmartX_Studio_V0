import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { getPrisma } from '@/lib/db/prisma';

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
  return NextResponse.json({
    account: account ? {
      plan: account.plan,
      status: account.status,
      paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
      nextChargeAt: account.nextChargeAt?.toISOString() ?? null,
      cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      canceledAt: account.canceledAt?.toISOString() ?? null,
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
