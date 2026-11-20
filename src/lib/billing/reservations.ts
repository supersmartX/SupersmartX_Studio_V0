import type { Paddle } from '@paddle/paddle-node-sdk';
import { getPrisma } from '@/lib/db/prisma';

// A Paddle transaction is created immediately after the reservation row, so a
// successful create is always inside this window. Recovery must not widen it:
// the window is what proves an old reservation has no provider object.
export const RESERVATION_CREATE_WINDOW_MS = 15 * 60_000;

// Quotes expire after 15 minutes. After another 5 minutes an unlinked
// reservation cannot belong to a checkout the customer is still completing.
export const RESERVATION_STALE_AFTER_MS = 20 * 60_000;

const RECOVERY_PAGE_SIZE = 100;
const RECOVERY_MAX_PAGES = 5;

export interface CheckoutReservationLike {
  id: string;
  userId: string;
  plan: string;
  consentHash: string;
  createdAt: Date;
  status: string;
  providerTransactionId: string | null;
}

type PaddleTransaction = Awaited<ReturnType<Paddle['transactions']['get']>>;
type TransactionSource = Pick<Paddle, 'transactions'>;

export function isStaleCheckoutReservation(
  reservation: Pick<CheckoutReservationLike, 'createdAt' | 'status' | 'providerTransactionId'>,
  now = new Date(),
): boolean {
  return (reservation.status === 'reserved' || reservation.status === 'pending') &&
    reservation.providerTransactionId === null &&
    now.getTime() - reservation.createdAt.getTime() >= RESERVATION_STALE_AFTER_MS;
}

/**
 * Finds the transactions Paddle created for this reservation. `null` means the
 * search could not be completed (more pages than the recovery budget); callers
 * must not treat that as proof that no transaction exists.
 */
export async function findReservationTransaction(
  paddle: TransactionSource,
  reservation: CheckoutReservationLike,
  now = new Date(),
): Promise<PaddleTransaction[] | null> {
  const createdAtEnd = new Date(Math.min(
    now.getTime(),
    reservation.createdAt.getTime() + RESERVATION_CREATE_WINDOW_MS,
  ));
  const collection = paddle.transactions.list({
    'createdAt[GTE]': reservation.createdAt.toISOString(),
    'createdAt[LTE]': createdAtEnd.toISOString(),
    perPage: RECOVERY_PAGE_SIZE,
  });
  const matches: PaddleTransaction[] = [];

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

/**
 * Marks one unclaimed reservation terminal. The predicates are the concurrency
 * guard: a transaction linked by another request, or a status already changed,
 * makes this a no-op instead of overwriting newer evidence.
 */
export async function expireUnclaimedReservation(
  reservation: Pick<CheckoutReservationLike, 'id' | 'userId'>,
): Promise<boolean> {
  const expired = await getPrisma().billingReservation.updateMany({
    where: {
      id: reservation.id,
      userId: reservation.userId,
      status: { in: ['reserved', 'pending'] },
      providerTransactionId: null,
    },
    data: { status: 'expired' },
  });
  return expired.count === 1;
}

/**
 * Releases one unclaimed reservation Paddle refused outright, so the customer
 * can retry immediately instead of waiting for the staleness sweep.
 */
export async function failUnclaimedReservation(
  reservation: Pick<CheckoutReservationLike, 'id' | 'userId'>,
  remoteStatus = 'provider_rejected',
): Promise<boolean> {
  const failed = await getPrisma().billingReservation.updateMany({
    where: {
      id: reservation.id,
      userId: reservation.userId,
      status: { in: ['reserved', 'pending'] },
      providerTransactionId: null,
    },
    data: { status: 'failed', remoteStatus },
  });
  return failed.count === 1;
}

/**
 * Reconciles every stale, unlinked reservation for one user before a new
 * checkout is reserved.
 *
 * - A matching Paddle transaction is linked so its hosted page stays usable.
 * - A reservation Paddle never saw is marked `expired`, which removes it from
 *   the uniqueness gate without deleting history.
 * - If Paddle cannot be reached, or the search is ambiguous, the row is left
 *   untouched: blocking is safer than orphaning a live transaction.
 */
export async function expireStaleUnclaimedCheckoutReservations(input: {
  userId: string;
  paddle: TransactionSource;
  now?: Date;
}): Promise<{ expired: string[]; linked: string[] }> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - RESERVATION_STALE_AFTER_MS);
  const stale = await getPrisma().billingReservation.findMany({
    where: {
      userId: input.userId,
      status: { in: ['reserved', 'pending'] },
      providerTransactionId: null,
      createdAt: { lte: cutoff },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      userId: true,
      plan: true,
      consentHash: true,
      createdAt: true,
      status: true,
      providerTransactionId: true,
    },
  });

  const expired: string[] = [];
  const linked: string[] = [];
  for (const reservation of stale) {
    let matches: PaddleTransaction[] | null;
    try {
      matches = await findReservationTransaction(input.paddle, reservation, now);
    } catch {
      continue;
    }
    if (matches === null || matches.length > 1) continue;
    if (matches.length === 1) {
      const transaction = matches[0];
      const linkedCount = await getPrisma().billingReservation.updateMany({
        where: {
          id: reservation.id,
          userId: reservation.userId,
          status: { in: ['reserved', 'pending'] },
          providerTransactionId: null,
        },
        data: {
          providerTransactionId: transaction.id,
          providerOperationId: transaction.id,
          remoteStatus: transaction.status,
          status: 'pending',
        },
      });
      if (linkedCount.count === 1) linked.push(reservation.id);
      continue;
    }
    if (await expireUnclaimedReservation(reservation)) expired.push(reservation.id);
  }

  return { expired, linked };
}
