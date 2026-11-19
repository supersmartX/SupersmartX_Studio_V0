import { auth } from '@/auth';
import { NextRequest, NextResponse } from 'next/server';
import { getPaddleClient, getPaddleEnvironment, isSafePaddleCheckoutUrl } from '@/lib/billing/paddle';
import { reservationStatusForRemote } from '@/lib/billing/operations';
import { getPrisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const RECOVERY_PAGE_SIZE = 100;
const RECOVERY_MAX_PAGES = 5;
const CHECKOUT_CREATE_WINDOW_MS = 15 * 60_000;

async function findReservationTransaction(reservation: {
  id: string;
  userId: string;
  plan: string;
  consentHash: string;
  createdAt: Date;
}, paddle: NonNullable<ReturnType<typeof getPaddleClient>>) {
  const createdAtEnd = new Date(Math.min(
    Date.now(),
    reservation.createdAt.getTime() + CHECKOUT_CREATE_WINDOW_MS,
  ));
  const collection = paddle.transactions.list({
    'createdAt[GTE]': reservation.createdAt.toISOString(),
    'createdAt[LTE]': createdAtEnd.toISOString(),
    perPage: RECOVERY_PAGE_SIZE,
  });
  const matches = [];

  for (let page = 0; page < RECOVERY_MAX_PAGES; page += 1) {
    const transactions = await collection.next();
    matches.push(...transactions.filter((transaction) => {
      const customData = transaction.customData ?? {};
      return customData.sup_reservation_id === reservation.id &&
        customData.sup_user_id === reservation.userId &&
        customData.sup_plan === reservation.plan &&
        customData.sup_consent_hash === reservation.consentHash;
    }));
    if (!collection.hasMore) return matches;
  }

  return null;
}

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (getPaddleEnvironment() !== 'sandbox') {
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
  const paddle = getPaddleClient();
  if (!paddle) return NextResponse.json({ error: 'Paddle is not configured' }, { status: 503 });

  try {
    let transactionId = reservation.providerTransactionId;
    if (!transactionId) {
      const matches = await findReservationTransaction(reservation, paddle);
      if (matches === null || matches.length === 0) {
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

    const checkoutUrl = transaction.status === 'ready' &&
      typeof transaction.checkout?.url === 'string' &&
      isSafePaddleCheckoutUrl(transaction.checkout.url)
      ? transaction.checkout.url
      : null;
    return NextResponse.json({
      status: remoteStatus === 'confirmed' ? 'awaiting_confirmation' : remoteStatus,
      retryAllowed: remoteStatus === 'failed' || remoteStatus === 'canceled',
      checkoutUrl,
      message: remoteStatus === 'confirmed'
        ? 'Payment was received and is awaiting secure confirmation.'
        : remoteStatus === 'pending' && transaction.status !== 'ready'
          ? 'Payment is not complete. Do not start another subscription while recovery is pending.'
        : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('Paddle checkout recovery could not verify the transaction');
    return NextResponse.json({ error: 'Checkout status is temporarily unavailable' }, { status: 503 });
  }
}
