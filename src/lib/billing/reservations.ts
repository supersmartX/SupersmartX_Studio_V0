import type { Paddle } from '@paddle/paddle-node-sdk';
import { getPrisma } from '@/lib/db/prisma';
import { receiveBillingEvent } from './operations';
import { isSafePaddleCheckoutUrl } from './paddle';

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
type CheckoutProvider = Pick<Paddle, 'transactions' | 'subscriptions'>;

export type CheckoutRecovery =
  | { kind: 'none' }
  | { kind: 'resume'; reservationId: string; transactionId: string; checkoutUrl: string }
  | {
    kind: 'awaiting_payment';
    reservationId: string;
    transactionId: string;
    userId: string;
    plan: string;
    consentHash: string;
    remoteStatus: string;
  }
  | { kind: 'pending'; reservationId: string }
  | { kind: 'released'; reservationId: string };

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

/**
 * The checkout URL a customer can still return to. Only `draft` and `ready`
 * are open checkout states: a draft transaction is Paddle's normal first stage
 * for an API-created checkout, and Paddle promotes it to `ready` as the
 * customer supplies details. Every other status is final or potentially paid.
 */
export function resumableCheckoutUrl(transaction: PaddleTransaction): string | null {
  if (transaction.status !== 'draft' && transaction.status !== 'ready') return null;
  const url = transaction.checkout?.url;
  return typeof url === 'string' && isSafePaddleCheckoutUrl(url) ? url : null;
}

function hasReservationAttribution(
  reservation: CheckoutReservationLike,
  transaction: PaddleTransaction,
): boolean {
  const customData = transaction.customData ?? {};
  return customData.sup_user_id === reservation.userId &&
    customData.sup_reservation_id === reservation.id &&
    customData.sup_plan === reservation.plan &&
    customData.sup_consent_hash === reservation.consentHash;
}

async function linkTransaction(
  reservation: CheckoutReservationLike,
  transaction: PaddleTransaction,
): Promise<boolean> {
  const linked = await getPrisma().billingReservation.updateMany({
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
  return linked.count === 1;
}

async function canceledTransactionIsFinal(
  paddle: CheckoutProvider,
  transaction: PaddleTransaction,
): Promise<boolean> {
  if (!transaction.subscriptionId) return true;
  const subscription = await paddle.subscriptions.get(transaction.subscriptionId);
  return subscription.id === transaction.subscriptionId &&
    subscription.customerId === transaction.customerId &&
    subscription.status === 'canceled';
}

/**
 * Decides what one open reservation means for the customer. The answer is
 * deliberately conservative:
 *
 * - `resume` only for an attributed draft/ready transaction with an approved
 *   checkout URL, so a returning customer continues the same payment.
 * - `awaiting_payment` for any status that may already hold money.
 * - `released` only when Paddle proves the attempt cannot be paid: no
 *   transaction was ever created, or the transaction is canceled with no live
 *   subscription. A paid, billed, past-due, draft or ready transaction is never
 *   expired or released.
 * - `pending` when Paddle cannot be reached, matches are ambiguous, or
 *   attribution fails. Blocking is safer than orphaning a live transaction.
 */
export async function reconcileCheckoutReservation(input: {
  reservation: CheckoutReservationLike;
  paddle: CheckoutProvider;
  now?: Date;
}): Promise<CheckoutRecovery> {
  const { reservation, paddle } = input;
  const now = input.now ?? new Date();
  const pending: CheckoutRecovery = { kind: 'pending', reservationId: reservation.id };
  let transaction: PaddleTransaction | null = null;

  if (reservation.providerTransactionId) {
    try {
      transaction = await paddle.transactions.get(reservation.providerTransactionId);
    } catch {
      return pending;
    }
    if (transaction.id !== reservation.providerTransactionId ||
        !hasReservationAttribution(reservation, transaction)) {
      return pending;
    }
  } else {
    let matches: PaddleTransaction[] | null;
    try {
      matches = await findReservationTransaction(paddle, reservation, now);
    } catch {
      return pending;
    }
    if (matches === null || matches.length > 1) return pending;
    if (matches.length === 0) {
      if (!isStaleCheckoutReservation(reservation, now)) return pending;
      return await expireUnclaimedReservation(reservation)
        ? { kind: 'released', reservationId: reservation.id }
        : pending;
    }
    transaction = matches[0];
    if (!await linkTransaction(reservation, transaction)) return pending;
  }

  const checkoutUrl = resumableCheckoutUrl(transaction);
  if (checkoutUrl) {
    return {
      kind: 'resume',
      reservationId: reservation.id,
      transactionId: transaction.id,
      checkoutUrl,
    };
  }

  if (transaction.status === 'paid' || transaction.status === 'completed') {
    return {
      kind: 'awaiting_payment',
      reservationId: reservation.id,
      transactionId: transaction.id,
      userId: reservation.userId,
      plan: reservation.plan,
      consentHash: reservation.consentHash,
      remoteStatus: transaction.status,
    };
  }

  if (transaction.status === 'canceled') {
    let final = false;
    try {
      final = await canceledTransactionIsFinal(paddle, transaction);
    } catch {
      final = false;
    }
    if (final) {
      const released = await getPrisma().billingReservation.updateMany({
        where: {
          id: reservation.id,
          userId: reservation.userId,
          providerTransactionId: transaction.id,
          status: { in: ['reserved', 'pending'] },
        },
        data: { status: 'canceled', remoteStatus: transaction.status },
      });
      if (released.count === 1) {
        return { kind: 'released', reservationId: reservation.id };
      }
    }
  }

  return pending;
}

/** Resolves the user's single open checkout, if any. */
export async function recoverCheckoutReservation(input: {
  userId: string;
  paddle: CheckoutProvider;
  now?: Date;
}): Promise<CheckoutRecovery> {
  const reservation = await getPrisma().billingReservation.findFirst({
    where: { userId: input.userId, status: { in: ['reserved', 'pending'] } },
    orderBy: { createdAt: 'desc' },
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
  if (!reservation) return { kind: 'none' };
  return reconcileCheckoutReservation({ reservation, paddle: input.paddle, now: input.now });
}

/**
 * Enqueues a durable `transaction.completed` event for a payment Paddle already
 * confirms, so a dropped or delayed webhook still reaches the existing
 * entitlement path. The worker re-fetches the transaction and re-validates
 * amounts, attribution and the quote before granting anything, so this never
 * marks a transaction paid without provider evidence.
 */
export async function requestPaidCheckoutReconciliation(input: {
  reservation: Pick<CheckoutReservationLike, 'id' | 'userId' | 'plan' | 'consentHash'>;
  transactionId: string;
  occurredAt?: Date | null;
}): Promise<{ duplicate: boolean }> {
  const eventId = `reconcile:${input.transactionId}`;
  const eventType = 'transaction.completed';
  return receiveBillingEvent({
    eventId,
    eventType,
    occurredAt: input.occurredAt ?? null,
    payload: {
      eventId,
      eventType,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      data: {
        id: input.transactionId,
        customData: {
          sup_user_id: input.reservation.userId,
          sup_reservation_id: input.reservation.id,
          sup_plan: input.reservation.plan,
          sup_consent_hash: input.reservation.consentHash,
        },
      },
    },
  });
}
