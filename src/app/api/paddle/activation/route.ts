import { auth } from '@/auth';
import { after, NextRequest, NextResponse } from 'next/server';
import { getPaddleClient, getPaddleEnvironment } from '@/lib/billing/paddle';
import { requestPaidCheckoutReconciliation } from '@/lib/billing/reservations';
import { triggerBillingWorker } from '@/lib/billing/worker-trigger';
import { getPrisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (getPaddleEnvironment() !== 'sandbox') return NextResponse.json({ error: 'Paddle activation verification is unavailable' }, { status: 503 });

  const reservationId = request.nextUrl.searchParams.get('reservationId')?.trim();
  const transactionId = request.nextUrl.searchParams.get('transactionId')?.trim();
  if (!reservationId || !transactionId) return NextResponse.json({ error: 'Checkout correlation is required' }, { status: 400 });

  const prisma = getPrisma();
  const reservation = await prisma.billingReservation.findUnique({ where: { id: reservationId } });
  if (!reservation || reservation.userId !== session.user.id) return NextResponse.json({ error: 'Checkout reservation was not found' }, { status: 404 });
  if (reservation.providerTransactionId && reservation.providerTransactionId !== transactionId) return NextResponse.json({ error: 'Checkout transaction correlation mismatch' }, { status: 409 });

  const paddle = getPaddleClient();
  if (!paddle) return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });

  try {
    const transaction = await paddle.transactions.get(transactionId);
    const customData = transaction.customData ?? {};
    if (transaction.id !== transactionId || customData.sup_user_id !== session.user.id ||
        customData.sup_reservation_id !== reservationId || customData.sup_plan !== reservation.plan ||
        customData.sup_consent_hash !== reservation.consentHash) {
      return NextResponse.json({ error: 'Checkout transaction attribution mismatch' }, { status: 409 });
    }

    if (transaction.status === 'paid' || transaction.status === 'completed') {
      await requestPaidCheckoutReconciliation({
        reservation: { id: reservation.id, userId: reservation.userId, plan: reservation.plan, consentHash: reservation.consentHash },
        transactionId,
        occurredAt: transaction.billedAt ? new Date(transaction.billedAt) : null,
      });
      after(triggerBillingWorker);
    }

    const ledger = await prisma.billingTransaction.findUnique({
      where: { providerTransactionId: transactionId },
      select: { userId: true, plan: true, entitlementGrantedAt: true, periodEndAt: true },
    });
    if (ledger?.userId === session.user.id && ledger.plan === reservation.plan && ledger.entitlementGrantedAt && ledger.periodEndAt && ledger.periodEndAt > new Date()) {
      return NextResponse.json({ status: 'activated', orderId: transactionId, plan: ledger.plan, expiresAt: ledger.periodEndAt.toISOString() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (String(transaction.status) === 'failed' || String(transaction.status) === 'canceled' || String(transaction.status) === 'cancelled') {
      return NextResponse.json({ status: 'failed', orderId: transactionId }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ status: 'pending', orderId: transactionId }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('Paddle activation verification unavailable', { reservationId, transactionId });
    return NextResponse.json({ status: 'pending', orderId: transactionId }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
