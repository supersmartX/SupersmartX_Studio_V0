import { auth } from '@/auth';
import { after, NextRequest, NextResponse } from 'next/server';
import { getPaddleClient, getPaddleEnvironment } from '@/lib/billing/paddle';
import { reservationStatusForRemote } from '@/lib/billing/operations';
import {
  expireUnclaimedReservation,
  findReservationTransaction,
  isStaleCheckoutReservation,
  requestPaidCheckoutReconciliation,
  resumableCheckoutUrl,
} from '@/lib/billing/reservations';
import { triggerBillingWorker } from '@/lib/billing/worker-trigger';
import { getPrisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (getPaddleEnvironment() === null) {
    return NextResponse.json({ error: 'Paddle checkout recovery is unavailable' }, { status: 503 });
  }

  const reservationId = request.nextUrl.searchParams.get('reservationId')?.trim();
  if (!reservationId) return NextResponse.json({ error: 'Reservation ID is required' }, { status: 400 });

  const reservation = await getPrisma().billingReservation.findUnique({
    where: { id: reservationId },
  });
  if (!reservation || reservation.userId !== session.user.id) {
    return NextResponse.json({ error: 'Checkout reservation was not found' }, { status: 404 });
  }
  if (reservation.status === 'failed' || reservation.status === 'expired' ||
      reservation.status === 'canceled') {
    // Already terminal: re-querying Paddle would report the empty result of a
    // dead attempt as "still being reconciled".
    return NextResponse.json({
      status: 'failed',
      retryAllowed: true,
      checkoutUrl: null,
      message: 'The previous checkout attempt did not create a payment. You can start a new checkout safely.',
    }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const paddle = getPaddleClient();
  if (!paddle) return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });

  try {
    let transactionId = reservation.providerTransactionId;
    if (!transactionId) {
      const matches = await findReservationTransaction(paddle, reservation);
      if (matches === null || matches.length === 0) {
        // Only an exhausted search proves Paddle never created a transaction.
        // `null` means the search budget ran out and the outcome is unknown.
        if (matches !== null && isStaleCheckoutReservation(reservation) &&
            await expireUnclaimedReservation(reservation)) {
          return NextResponse.json({
            status: 'failed',
            retryAllowed: true,
            checkoutUrl: null,
            message: 'The previous checkout attempt expired without creating a Paddle transaction. You can start a new checkout safely.',
          }, { headers: { 'Cache-Control': 'no-store' } });
        }
        return NextResponse.json({
          status: 'pending',
          retryAllowed: false,
          message: 'Checkout creation is still being reconciled. Do not start another checkout yet.',
        }, { headers: { 'Cache-Control': 'no-store' } });
      }
      if (matches.length !== 1) {
        return NextResponse.json({
          error: 'Multiple checkout transactions require support review',
        }, { status: 409 });
      }

      const recovered = matches[0];
      const linked = await getPrisma().billingReservation.updateMany({
        where: {
          id: reservation.id,
          userId: session.user.id,
          providerTransactionId: null,
          status: { in: ['reserved', 'pending'] },
        },
        data: {
          providerTransactionId: recovered.id,
          providerOperationId: recovered.id,
          remoteStatus: recovered.status,
          status: 'pending',
        },
      });
      transactionId = linked.count === 1
        ? recovered.id
        : (await getPrisma().billingReservation.findUnique({
          where: { id: reservation.id },
          select: { providerTransactionId: true },
        }))?.providerTransactionId ?? null;
      if (!transactionId) {
        return NextResponse.json({ error: 'Checkout transaction could not be linked safely' }, { status: 409 });
      }
    }

    const transaction = await paddle.transactions.get(transactionId);
    const customData = transaction.customData ?? {};
    if (transaction.id !== transactionId ||
        customData.sup_user_id !== session.user.id ||
        customData.sup_reservation_id !== reservation.id ||
        customData.sup_plan !== reservation.plan ||
        customData.sup_consent_hash !== reservation.consentHash) {
      return NextResponse.json({ error: 'Checkout transaction attribution mismatch' }, { status: 409 });
    }

    let remoteStatus = reservationStatusForRemote(transaction.status);
    if (remoteStatus === 'failed' && transaction.subscriptionId) {
      remoteStatus = 'pending';
    }
    if (remoteStatus === 'canceled' && transaction.subscriptionId) {
      const subscription = await paddle.subscriptions.get(transaction.subscriptionId);
      if (subscription.id !== transaction.subscriptionId ||
          subscription.customerId !== transaction.customerId ||
          subscription.status !== 'canceled') {
        remoteStatus = 'pending';
      }
    }
    if (remoteStatus === 'confirmed') {
      // Paddle has confirmed the payment. Entitlement is applied by the durable
      // worker, so a reconciliation-queue outage must not make the status look
      // like an unverified/failed checkout: report awaiting_confirmation and let
      // the webhook path (or a later status poll) enqueue the same event.
      try {
        await requestPaidCheckoutReconciliation({
          reservation: {
            id: reservation.id,
            userId: reservation.userId,
            plan: reservation.plan,
            consentHash: reservation.consentHash,
          },
          transactionId: transaction.id,
          occurredAt: transaction.billedAt ? new Date(transaction.billedAt) : null,
        });
        after(triggerBillingWorker);
      } catch {
        console.error('Paid checkout reconciliation could not be queued');
      }
    }
    if (remoteStatus === 'failed' || remoteStatus === 'canceled') {
      await getPrisma().billingReservation.updateMany({
        where: {
          id: reservation.id,
          userId: session.user.id,
          providerTransactionId: transaction.id,
          status: { in: ['reserved', 'pending'] },
        },
        data: { status: remoteStatus, remoteStatus: transaction.status },
      });
    }

const checkoutUrl = resumableCheckoutUrl(transaction);
    return NextResponse.json({
      status: remoteStatus === 'confirmed' ? 'payment_received' : remoteStatus,
      retryAllowed: remoteStatus === 'failed' || remoteStatus === 'canceled',
      checkoutUrl,
      message: remoteStatus === 'confirmed'
        ? 'Payment received. Activating your plan...'
        : remoteStatus === 'pending' && transaction.status !== 'ready'
          ? 'Payment is not complete. Do not start another subscription while recovery is pending.'
          : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('Paddle checkout recovery could not verify the transaction');
    return NextResponse.json({ error: 'Checkout status is temporarily unavailable' }, { status: 503 });
  }
}
