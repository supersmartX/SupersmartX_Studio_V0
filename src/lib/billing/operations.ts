import crypto from 'crypto';
import { getPrisma } from '@/lib/db/prisma';
import { classifyBillingAccount } from './accounts';
import type { CheckoutConsent } from './contracts';
import type { Prisma } from '@prisma/client';

// All billing projections for an account use the same lock before reading
// mutable coverage. Per-event leases alone do not serialize different events.
async function lockBillingUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`;
}

const MAX_BILLING_EVENT_ATTEMPTS = 10;

export class ActiveBillingSubscriptionError extends Error {
  constructor(readonly subscription: {
    plan: string;
    status: string;
    nextChargeAt: string | null;
    paidThroughAt: string | null;
    cancelAtPeriodEnd: boolean;
  }) {
    super('An active Paddle subscription already exists');
    this.name = 'ActiveBillingSubscriptionError';
  }
}

export class UnresolvedCheckoutReservationError extends Error {
  constructor(readonly reservationId: string) {
    super('An unresolved checkout already exists');
    this.name = 'UnresolvedCheckoutReservationError';
  }
}

export class ReviewEventError extends Error {
  constructor(readonly code: string) {
    super(`Review required: ${code}`);
    this.name = 'ReviewEventError';
  }
}

export class ProviderCustomerIdConflictError extends Error {
  constructor() {
    super('Provider customer ID conflict with active subscription');
    this.name = 'ProviderCustomerIdConflictError';
  }
}

export function isNewerBillingEvent(occurredAt: Date | null, lastEventAt: Date | null): boolean {
  if (!lastEventAt) return true;
  return occurredAt !== null && occurredAt >= lastEventAt;
}

export function isFullApprovedEntitlementReversal(input: {
  action: string;
  actionType: string;
  status: string;
}): boolean {
  return input.actionType === 'full' && input.status === 'approved' &&
    (input.action === 'refund' || input.action === 'chargeback');
}

export function hashCheckoutConsent(consent: Omit<CheckoutConsent, 'consentHash'>): string {
  const canonical = {
    plan: consent.plan,
    period: consent.period,
    amount: consent.amount,
    currency: consent.currency,
    consentVersion: consent.consentVersion,
    ...(consent.consentVersion === '2' ? { quoteToken: consent.quoteToken } : {}),
  };
  return crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function reservationStatusForRemote(status: string): 'confirmed' | 'pending' | 'failed' | 'canceled' {
  if (status === 'completed' || status === 'paid') return 'confirmed';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';
  if (status === 'failed') return 'failed';
  return 'pending';
}

export async function reserveCheckout(input: CheckoutConsent & {
  userId: string;
  reservationId: string;
  providerOperationId?: string;
  providerTransactionId?: string | null;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { plan: true, planExpiresAt: true },
    });
    if (!user) throw new Error('Checkout account was not found');
    const baseline = classifyBillingAccount({
      plan: user.plan,
      planExpiresAt: user.planExpiresAt?.toISOString() ?? null,
    });

    await tx.billingAccount.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        plan: baseline.plan,
        status: baseline.status,
        legacyPlan: user.plan,
        legacyPaidThroughAt: user.planExpiresAt,
        paidThroughAt: baseline.paidThroughAt,
      },
      update: {},
    });

    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId } });
    if (account && !account.legacyPlan && !account.legacyPaidThroughAt) {
      await tx.billingAccount.update({
        where: { userId: input.userId },
        data: { legacyPlan: user.plan, legacyPaidThroughAt: user.planExpiresAt },
      });
    }

    const reservation = await tx.billingReservation.findUnique({ where: { id: input.reservationId } });
    if (reservation) {
      if (reservation.userId !== input.userId ||
          reservation.plan !== input.plan ||
          reservation.period !== input.period ||
          reservation.currency !== input.currency ||
          reservation.consentHash !== input.consentHash) {
        throw new Error('Checkout reservation does not match the confirmed consent');
      }
      await tx.billingReservation.update({
        where: { id: input.reservationId },
        data: {
          providerOperationId: input.providerOperationId,
          providerTransactionId: input.providerTransactionId,
          status: reservation.status === 'reserved' ? 'pending' : reservation.status,
        },
      });
      return;
    }

    const activeProviderStatuses = ['active', 'trialing', 'past_due', 'paused', 'payment_failed'];
    if (account?.providerSubscriptionId &&
        (activeProviderStatuses.includes(account.status) ||
          Boolean(account.paidThroughAt && account.paidThroughAt > new Date()))) {
      throw new ActiveBillingSubscriptionError({
        plan: account.plan,
        status: account.status,
        nextChargeAt: account.nextChargeAt?.toISOString() ?? null,
        paidThroughAt: account.paidThroughAt?.toISOString() ?? null,
        cancelAtPeriodEnd: account.cancelAtPeriodEnd,
      });
    }

    const unresolvedReservation = await tx.billingReservation.findFirst({
      where: { userId: input.userId, status: { in: ['reserved', 'pending'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (unresolvedReservation) {
      throw new UnresolvedCheckoutReservationError(unresolvedReservation.id);
    }

    await tx.billingReservation.create({
      data: {
        id: input.reservationId,
        userId: input.userId,
        plan: input.plan,
        period: input.period,
        currency: input.currency,
        consentHash: input.consentHash,
        status: 'reserved',
        providerOperationId: input.providerOperationId,
        providerTransactionId: input.providerTransactionId,
      },
    });
  });
}

/**
 * Retire only the current pointer to a provider subscription that Paddle has
 * independently confirmed terminal. The transaction ledger remains intact;
 * this permits a later enrollment to bind a new subscription without making
 * future paid grants conflict with an expired subscription ID.
 */
export async function clearEndedBillingSubscription(input: {
  userId: string;
  subscriptionId: string;
  now?: Date;
}): Promise<boolean> {
  const prisma = getPrisma();
  const now = input.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId } });
    if (!account || account.providerSubscriptionId !== input.subscriptionId ||
        account.paidThroughAt && account.paidThroughAt > now) return false;
    const updated = await tx.billingAccount.updateMany({
      where: {
        userId: input.userId,
        providerSubscriptionId: input.subscriptionId,
        OR: [{ paidThroughAt: null }, { paidThroughAt: { lte: now } }],
      },
      data: {
        providerCustomerId: null,
        providerSubscriptionId: null,
        cancelAtPeriodEnd: false,
        nextChargeAt: null,
        status: 'expired',
      },
    });
    return updated.count === 1;
  });
}

export async function receiveBillingEvent(input: {
  eventId: string;
  eventType: string;
  payload: unknown;
  occurredAt?: Date | null;
}): Promise<{ duplicate: boolean }> {
  const prisma = getPrisma();
  const result = await prisma.billingEvent.createMany({
    data: [{
      eventId: input.eventId,
      eventType: input.eventType,
      payloadJson: JSON.stringify(input.payload),
      userId: null,
      occurredAt: input.occurredAt ?? null,
      status: 'received',
    }],
    skipDuplicates: true,
  });
  return { duplicate: result.count === 0 };
}

export async function acquireBillingEventLease(
  eventId: string,
  leaseOwner: string,
  leaseToken: string,
  leaseUntil: Date,
  now = new Date(),
): Promise<boolean> {
  const prisma = getPrisma();
  const result = await prisma.billingEvent.updateMany({
    where: {
      eventId,
      status: { in: ['received', 'processing', 'failed'] },
      nextAttemptAt: { lte: now },
      OR: [
        { leaseOwner: null },
        { leasedUntil: null },
        { leasedUntil: { lt: now } },
      ],
    },
    data: {
      status: 'processing',
      leaseOwner,
      leaseToken,
      leasedUntil: leaseUntil,
    },
  });
  return result.count === 1;
}

export async function renewBillingEventLease(
  eventId: string,
  leaseToken: string,
  leaseUntil: Date,
  now = new Date(),
): Promise<boolean> {
  const prisma = getPrisma();
  const result = await prisma.billingEvent.updateMany({
    where: {
      eventId,
      status: 'processing',
      leaseToken,
      leasedUntil: { gt: now },
    },
    data: { leasedUntil: leaseUntil },
  });
  return result.count === 1;
}

export async function releaseBillingEventLease(
  eventId: string,
  leaseToken: string,
  outcome: 'processed' | 'failed' | 'ignored' | 'review',
  error?: string,
): Promise<boolean> {
  const prisma = getPrisma();
  const now = new Date();
  const leaseWhere = {
    eventId,
    status: 'processing',
    leaseToken,
    leasedUntil: { gt: now },
  };
  const event = await prisma.billingEvent.findFirst({
    where: leaseWhere,
    select: { attemptCount: true },
  });
  if (!event) return false;
  const delayMinutes = Math.min(60, 2 ** Math.min(event.attemptCount, 6));
  const exhausted = outcome === 'failed' && event.attemptCount + 1 >= MAX_BILLING_EVENT_ATTEMPTS;
  const finalOutcome = exhausted ? 'review' : outcome;
  const result = await prisma.billingEvent.updateMany({
    where: leaseWhere,
    data: {
      status: finalOutcome,
      processedAt: finalOutcome === 'processed' || finalOutcome === 'ignored' || finalOutcome === 'review'
        ? new Date()
        : null,
      nextAttemptAt: outcome === 'failed'
        ? new Date(Date.now() + delayMinutes * 60_000)
        : new Date(),
      lastError: error ?? null,
      attemptCount: { increment: 1 },
      leaseOwner: null,
      leaseToken: null,
      leasedUntil: null,
    },
  });
  return result.count === 1;
}

export async function markBillingEventProcessed(eventId: string, leaseToken: string): Promise<boolean> {
  const prisma = getPrisma();
  const result = await prisma.billingEvent.updateMany({
    where: { eventId, status: 'processing', leaseToken, leasedUntil: { gt: new Date() } },
    data: {
      status: 'processed',
      processedAt: new Date(),
      attemptCount: { increment: 1 },
      leaseOwner: null,
      leaseToken: null,
      leasedUntil: null,
      lastError: null,
    },
  });
  return result.count === 1;
}

export async function applyPaidBillingEvent(input: {
  eventId: string;
  leaseToken: string;
  reservationId?: string | null;
  userId: string;
  plan: 'creator_monthly' | 'creator_yearly';
  providerTransactionId: string;
  providerSubscriptionId: string;
  providerCustomerId: string;
  amount: string;
  currency: string;
  paidAt: Date;
  periodStartAt: Date;
  periodEndAt: Date;
  nextChargeAt: Date | null;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const event = await tx.billingEvent.findFirst({
      where: {
        eventId: input.eventId,
        status: 'processing',
        leaseToken: input.leaseToken,
        leasedUntil: { gt: new Date() },
      },
      select: { occurredAt: true },
    });
    if (!event) throw new Error('Billing event lease was lost');

    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { plan: true, planExpiresAt: true },
    });
    if (!user) throw new Error('Paid event account does not exist');

    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId } });
    if (!account) throw new Error('Paid event billing account does not exist');
    if ((account.providerSubscriptionId && account.providerSubscriptionId !== input.providerSubscriptionId) ||
        (account.providerCustomerId && account.providerCustomerId !== input.providerCustomerId)) {
      throw new Error('Paid event provider ownership mismatch');
    }

    // Check if another user already has this providerCustomerId
    const otherAccount = await tx.billingAccount.findFirst({
      where: {
        providerCustomerId: input.providerCustomerId,
        userId: { not: input.userId },
      },
      select: { userId: true, providerSubscriptionId: true, status: true, paidThroughAt: true },
    });
    if (otherAccount) {
      // If the other account has an active subscription, this is a conflict requiring review
      const otherUser = await tx.user.findUnique({
        where: { id: otherAccount.userId },
        select: { plan: true, planExpiresAt: true },
      });
      const otherIsActive = otherUser && otherUser.plan !== 'free' &&
        otherUser.planExpiresAt && otherUser.planExpiresAt > new Date();
      if (otherIsActive) {
        throw new ProviderCustomerIdConflictError();
      }
      // Other account is expired/free - lock the other user to serialize with their entitlement renewals
      // Then revalidate that the account is still expired before clearing provider IDs
      await lockBillingUser(tx, otherAccount.userId);
      const revalidatedOtherAccount = await tx.billingAccount.findUnique({ where: { userId: otherAccount.userId } });
      if (revalidatedOtherAccount) {
        const revalidatedOtherUser = await tx.user.findUnique({
          where: { id: otherAccount.userId },
          select: { plan: true, planExpiresAt: true },
        });
        const otherStillInactive = revalidatedOtherUser && (revalidatedOtherUser.plan === 'free' ||
          !revalidatedOtherUser.planExpiresAt || revalidatedOtherUser.planExpiresAt <= new Date());
        if (otherStillInactive) {
          await tx.billingAccount.update({
            where: { userId: otherAccount.userId },
            data: { providerCustomerId: null, providerSubscriptionId: null },
          });
        }
      }
    }

    await tx.billingTransaction.createMany({
      data: [{
        id: crypto.randomUUID(),
        providerTransactionId: input.providerTransactionId,
        userId: input.userId,
        providerSubscriptionId: input.providerSubscriptionId,
        plan: input.plan,
        status: 'paid',
        amount: input.amount,
        currency: input.currency,
        paidAt: input.paidAt,
        periodStartAt: input.periodStartAt,
        periodEndAt: input.periodEndAt,
        payloadJson: JSON.stringify({ eventId: input.eventId }),
      }],
      skipDuplicates: true,
    });
    const transaction = await tx.billingTransaction.findUnique({
      where: { providerTransactionId: input.providerTransactionId },
      select: { id: true, userId: true, entitlementGrantedAt: true },
    });
    if (!transaction || transaction.userId !== input.userId) {
      throw new Error('Paid transaction ownership mismatch');
    }

    let paidThroughAt = account.paidThroughAt;
    const claimed = transaction.entitlementGrantedAt
      ? { count: 0 }
      : await tx.billingTransaction.updateMany({
        where: { id: transaction.id, entitlementGrantedAt: null },
        data: { entitlementGrantedAt: new Date() },
      });
    if (claimed.count === 1) {
      const currentCoverage = [
        account.paidThroughAt,
        account.legacyPaidThroughAt,
        user.planExpiresAt,
      ].filter((value): value is Date => value !== null);
      const currentPaidThrough = currentCoverage.reduce((latest, value) =>
        value > latest ? value : latest,
      input.paidAt);
      currentCoverage.push(input.periodEndAt);
      paidThroughAt = currentCoverage.reduce((latest, value) =>
        value > latest ? value : latest,
      );
      await tx.user.update({
        where: { id: input.userId },
        data: {
          plan: input.periodEndAt >= currentPaidThrough ? input.plan : user.plan,
          planExpiresAt: paidThroughAt,
        },
      });
    }

    const isNewerEvent = isNewerBillingEvent(event.occurredAt, account.lastEventAt);
    const paidTermIsCurrent = input.periodEndAt >= [
      account.paidThroughAt,
      account.legacyPaidThroughAt,
      user.planExpiresAt,
    ].filter((value): value is Date => value !== null).reduce(
      (latest, value) => value > latest ? value : latest,
      input.paidAt,
    );
    await tx.billingAccount.update({
      where: { userId: input.userId },
      data: {
        plan: claimed.count === 1 && paidTermIsCurrent ? input.plan : account.plan,
        status: claimed.count === 1 && isNewerEvent ? 'active' : account.status,
        paidThroughAt,
        nextChargeAt: isNewerEvent ? input.nextChargeAt : account.nextChargeAt,
        providerCustomerId: input.providerCustomerId,
        providerSubscriptionId: input.providerSubscriptionId,
        ...(isNewerEvent ? { lastEventId: input.eventId, lastEventAt: event.occurredAt } : {}),
      },
    });
    if (input.reservationId) {
      const reservationUpdate = await tx.billingReservation.updateMany({
        where: {
          id: input.reservationId,
          userId: input.userId,
          plan: input.plan,
          OR: [
            { providerTransactionId: null },
            { providerTransactionId: input.providerTransactionId },
          ],
        },
        data: {
          status: 'confirmed',
          providerTransactionId: input.providerTransactionId,
          remoteStatus: 'paid',
        },
      });
      if (reservationUpdate.count !== 1) throw new Error('Checkout reservation does not match paid transaction');
    }

    const marked = await tx.billingEvent.updateMany({
      where: {
        eventId: input.eventId,
        status: 'processing',
        leaseToken: input.leaseToken,
        leasedUntil: { gt: new Date() },
      },
      data: {
        status: 'processed',
        processedAt: new Date(),
        userId: input.userId,
        attemptCount: { increment: 1 },
        leaseOwner: null,
        leaseToken: null,
        leasedUntil: null,
        lastError: null,
      },
    });
    if (marked.count !== 1) throw new Error('Billing event lease was lost before commit');
  });
}

export async function applyFailedPaymentEvent(input: {
  eventId: string;
  leaseToken: string;
  userId: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  occurredAt: Date | null;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const lease = await tx.billingEvent.findFirst({
      where: {
        eventId: input.eventId,
        status: 'processing',
        leaseToken: input.leaseToken,
        leasedUntil: { gt: new Date() },
      },
    });
    if (!lease) throw new Error('Billing event lease was lost');
    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId } });
    if (!account) throw new Error('Failed payment billing account does not exist');
    if ((account.providerSubscriptionId && account.providerSubscriptionId !== input.providerSubscriptionId) ||
        (account.providerCustomerId && input.providerCustomerId &&
          account.providerCustomerId !== input.providerCustomerId)) {
      throw new Error('Failed payment provider ownership mismatch');
    }
    const isNewerEvent = isNewerBillingEvent(input.occurredAt, account.lastEventAt);
    if (isNewerEvent) {
      await tx.billingAccount.update({
        where: { userId: input.userId },
        data: {
          status: 'payment_failed',
          ...(input.providerSubscriptionId ? { providerSubscriptionId: input.providerSubscriptionId } : {}),
          ...(input.providerCustomerId ? { providerCustomerId: input.providerCustomerId } : {}),
          lastEventId: input.eventId,
          lastEventAt: input.occurredAt,
        },
      });
    }
    const marked = await tx.billingEvent.updateMany({
      where: { eventId: input.eventId, status: 'processing', leaseToken: input.leaseToken, leasedUntil: { gt: new Date() } },
      data: {
        status: 'processed',
        processedAt: new Date(),
        userId: input.userId,
        attemptCount: { increment: 1 },
        leaseOwner: null,
        leaseToken: null,
        leasedUntil: null,
        lastError: null,
      },
    });
    if (marked.count !== 1) throw new Error('Billing event lease was lost before commit');
  });
}

export async function applySubscriptionSnapshot(input: {
  eventId: string;
  leaseToken: string;
  userId: string;
  subscriptionId: string;
  customerId: string;
  status: string;
  nextChargeAt: Date | null;
  cancelAtPeriodEnd: boolean;
  occurredAt: Date | null;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const lease = await tx.billingEvent.findFirst({
      where: {
        eventId: input.eventId,
        status: 'processing',
        leaseToken: input.leaseToken,
        leasedUntil: { gt: new Date() },
      },
    });
    if (!lease) throw new Error('Billing event lease was lost');
    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId } });
    if (!account) throw new Error('Subscription billing account does not exist');
    if ((account.providerSubscriptionId && account.providerSubscriptionId !== input.subscriptionId) ||
        (account.providerCustomerId && account.providerCustomerId !== input.customerId)) {
      throw new Error('Subscription provider ownership mismatch');
    }

    const isNewerEvent = isNewerBillingEvent(input.occurredAt, account.lastEventAt);
    // A provider snapshot that predates a locally confirmed cancellation must not
    // clear it. The route records `completedAt` under the same user lock, so the
    // comparison is against a committed write, not a racing read.
    const keepLocalCancellation = !input.cancelAtPeriodEnd && account.cancelAtPeriodEnd &&
      Boolean(await tx.billingOperation.findFirst({
        where: {
          userId: input.userId,
          resourceId: input.subscriptionId,
          operation: 'cancel_at_period_end',
          status: 'completed',
          completedAt: { gte: input.occurredAt ?? new Date() },
        },
        select: { id: true },
      }));
    if (isNewerEvent) {
      // Check if another user already has this providerCustomerId
      // This must be inside isNewerEvent to prevent outdated events from clearing another account's provider IDs
      const otherAccount = await tx.billingAccount.findFirst({
        where: {
          providerCustomerId: input.customerId,
          userId: { not: input.userId },
        },
        select: { userId: true, providerSubscriptionId: true, status: true, paidThroughAt: true },
      });
      if (otherAccount) {
        // If the other account has an active subscription, this is a conflict requiring review
        const otherUser = await tx.user.findUnique({
          where: { id: otherAccount.userId },
          select: { plan: true, planExpiresAt: true },
        });
        const otherIsActive = otherUser && otherUser.plan !== 'free' &&
          otherUser.planExpiresAt && otherUser.planExpiresAt > new Date();
        if (otherIsActive) {
          throw new ProviderCustomerIdConflictError();
        }
        // Other account is expired/free - lock and revalidate before clearing their provider IDs
        await lockBillingUser(tx, otherAccount.userId);
        const revalidatedOtherAccount = await tx.billingAccount.findUnique({ where: { userId: otherAccount.userId } });
        if (revalidatedOtherAccount) {
          const revalidatedOtherUser = await tx.user.findUnique({
            where: { id: otherAccount.userId },
            select: { plan: true, planExpiresAt: true },
          });
          const otherStillInactive = revalidatedOtherUser && (revalidatedOtherUser.plan === 'free' ||
            !revalidatedOtherUser.planExpiresAt || revalidatedOtherUser.planExpiresAt <= new Date());
          if (otherStillInactive) {
            await tx.billingAccount.update({
              where: { userId: otherAccount.userId },
              data: { providerCustomerId: null, providerSubscriptionId: null },
            });
          }
        }
      }

      await tx.billingAccount.update({
        where: { userId: input.userId },
        data: {
          providerSubscriptionId: input.subscriptionId,
          providerCustomerId: input.customerId,
          status: input.status,
          nextChargeAt: input.nextChargeAt,
          cancelAtPeriodEnd: keepLocalCancellation ? true : input.cancelAtPeriodEnd,
          lastEventId: input.eventId,
          lastEventAt: input.occurredAt,
        },
      });
      if (input.cancelAtPeriodEnd || input.status === 'canceled') {
        await tx.billingOperation.updateMany({
          where: {
            resourceId: input.subscriptionId,
            operation: 'cancel_at_period_end',
            status: { in: ['pending', 'uncertain'] },
          },
          data: { status: 'completed', completedAt: new Date(), lastError: null },
        });
      }
    }
    const marked = await tx.billingEvent.updateMany({
      where: { eventId: input.eventId, status: 'processing', leaseToken: input.leaseToken, leasedUntil: { gt: new Date() } },
      data: {
        status: 'processed',
        processedAt: new Date(),
        userId: input.userId,
        attemptCount: { increment: 1 },
        leaseOwner: null,
        leaseToken: null,
        leasedUntil: null,
        lastError: null,
      },
    });
    if (marked.count !== 1) throw new Error('Billing event lease was lost before commit');
  });
}

export async function completeReconciledCancellation(input: {
  operationId: string;
  userId: string;
  subscriptionId: string;
  cancelAtPeriodEnd: boolean;
  status: string;
  canceledAt: Date | null;
}): Promise<boolean> {
  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const completed = await tx.billingOperation.updateMany({
      where: { id: input.operationId, status: { in: ['pending', 'uncertain'] } },
      data: { status: 'completed', completedAt: new Date(), lastError: null },
    });
    if (completed.count !== 1) return false;
    await tx.billingAccount.updateMany({
      where: { userId: input.userId, providerSubscriptionId: input.subscriptionId },
      data: {
        cancelAtPeriodEnd: input.cancelAtPeriodEnd,
        status: input.status,
        ...(input.canceledAt ? { canceledAt: input.canceledAt } : {}),
      },
    });
    return true;
  });
}

export async function recordCancellationRequest(input: {
  userId: string;
  subscriptionId: string;
  operationId: string;
  requestedAt?: Date;
}): Promise<void> {
  const prisma = getPrisma();
  const requestedAt = input.requestedAt ?? new Date();
  await prisma.$transaction(async (tx) => {
    await lockBillingUser(tx, input.userId);
    const operation = await tx.billingOperation.findFirst({
      where: {
        id: input.operationId,
        userId: input.userId,
        resourceId: input.subscriptionId,
        operation: 'cancel_at_period_end',
        status: 'pending',
      },
      select: { id: true },
    });
    if (!operation) throw new Error('Cancellation operation is not pending');
    const account = await tx.billingAccount.findUnique({ where: { userId: input.userId } });
    if (!account || account.providerSubscriptionId !== input.subscriptionId) {
      throw new Error('Cancellation subscription ownership mismatch');
    }
    await tx.billingOperation.update({
      where: { id: input.operationId },
      data: { status: 'completed', completedAt: requestedAt, lastError: null },
    });
    await tx.billingAccount.update({
      where: { userId: input.userId },
      data: {
        cancelAtPeriodEnd: true,
        ...(isNewerBillingEvent(requestedAt, account.lastEventAt)
          ? { lastEventId: `operation:${input.operationId}`, lastEventAt: requestedAt }
          : {}),
      },
    });
  });
}

export async function applyAdjustmentEvent(input: {
  eventId: string;
  leaseToken: string;
  adjustmentId: string;
  transactionId: string;
  action: string;
  actionType: string;
  status: string;
  amount: string;
  currency: string;
  updatedAt: Date;
  occurredAt?: Date | null;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    const lease = await tx.billingEvent.findFirst({
      where: {
        eventId: input.eventId,
        status: 'processing',
        leaseToken: input.leaseToken,
        leasedUntil: { gt: new Date() },
      },
    });
    if (!lease) throw new Error('Billing event lease was lost');
    const transaction = await tx.billingTransaction.findUnique({
      where: { providerTransactionId: input.transactionId },
    });
    if (!transaction?.userId) throw new Error('Adjustment transaction is not attributed');
    await lockBillingUser(tx, transaction.userId);
    const account = await tx.billingAccount.findUnique({ where: { userId: transaction.userId } });
    if (!account) throw new Error('Adjustment billing account does not exist');

    const action = input.action.toLowerCase();
    if (!/^\d+(?:\.\d{1,2})?$/.test(input.amount) || Number(input.amount) < 0 ||
        Number(input.amount) > Number(transaction.amount) ||
        input.currency !== transaction.currency) {
      throw new Error('Adjustment amount or currency is invalid');
    }
    await tx.billingAdjustment.upsert({
      where: { providerAdjustmentId: input.adjustmentId },
      create: {
        providerAdjustmentId: input.adjustmentId,
        transactionId: input.transactionId,
        action,
        actionType: input.actionType,
        status: input.status,
        amount: input.amount,
        currency: input.currency,
        updatedAt: input.updatedAt,
      },
      update: {
        transactionId: input.transactionId,
        action,
        actionType: input.actionType,
        status: input.status,
        amount: input.amount,
        currency: input.currency,
        updatedAt: input.updatedAt,
      },
    });

    const activeAdjustments = await tx.billingAdjustment.findMany({
      where: {
        transactionId: input.transactionId,
        status: 'approved',
        action: { in: ['refund', 'chargeback'] },
      },
      select: { action: true, actionType: true, status: true, updatedAt: true },
    });
    const hasRefund = activeAdjustments.some((adjustment) =>
      adjustment.action === 'refund' && isFullApprovedEntitlementReversal(adjustment));
    const hasChargeback = activeAdjustments.some((adjustment) =>
      adjustment.action === 'chargeback' && isFullApprovedEntitlementReversal(adjustment));
    const hasAnyRefund = activeAdjustments.some((adjustment) => adjustment.action === 'refund');
    const hasAnyChargeback = activeAdjustments.some((adjustment) => adjustment.action === 'chargeback');
    await tx.billingTransaction.update({
      where: { providerTransactionId: input.transactionId },
      data: {
        status: hasRefund ? 'refunded' : hasChargeback ? 'disputed' : 'paid',
        refundedAt: hasAnyRefund
          ? activeAdjustments.filter((adjustment) => adjustment.action === 'refund')
            .reduce((latest, adjustment) => adjustment.updatedAt > latest ? adjustment.updatedAt : latest, input.updatedAt)
          : null,
        disputedAt: hasAnyChargeback
          ? activeAdjustments.filter((adjustment) => adjustment.action === 'chargeback')
            .reduce((latest, adjustment) => adjustment.updatedAt > latest ? adjustment.updatedAt : latest, input.updatedAt)
          : null,
      },
    });

    const remaining = await tx.billingTransaction.findMany({
      where: { userId: transaction.userId, status: 'paid', periodEndAt: { not: null } },
      orderBy: { periodEndAt: 'desc' },
      select: { plan: true, periodEndAt: true },
    });
    const legacyExpiry = account.legacyPaidThroughAt;
    const paidTerm = remaining.find((item) => item.periodEndAt !== null);
    const legacyIsLater = Boolean(legacyExpiry && (!paidTerm?.periodEndAt || legacyExpiry >= paidTerm.periodEndAt));
    const paidThroughAt = legacyIsLater ? legacyExpiry : paidTerm?.periodEndAt ?? legacyExpiry;
    const plan = legacyIsLater
      ? account.legacyPlan || 'free'
      : paidTerm?.plan || account.legacyPlan || 'free';
    const active = Boolean(paidThroughAt && paidThroughAt > new Date());
    const adjustmentAt = input.occurredAt ?? input.updatedAt;
    const isNewerEvent = isNewerBillingEvent(adjustmentAt, account.lastEventAt);

    await tx.user.update({
      where: { id: transaction.userId },
      data: {
        plan: active ? plan : 'free',
        planExpiresAt: paidThroughAt,
      },
    });
    await tx.billingAccount.update({
      where: { userId: transaction.userId },
      data: {
        paidThroughAt,
        // Coverage is always recomputed from the attributed transactions, but a
        // delayed adjustment must not overwrite a newer subscription lifecycle
        // state (for example a cancellation recorded after this refund).
        ...(isNewerEvent ? {
          plan: active ? plan : 'free',
          status: active ? 'active' : 'expired',
          lastEventId: input.eventId,
          lastEventAt: adjustmentAt,
        } : {}),
      },
    });
    const marked = await tx.billingEvent.updateMany({
      where: { eventId: input.eventId, status: 'processing', leaseToken: input.leaseToken, leasedUntil: { gt: new Date() } },
      data: {
        status: 'processed',
        processedAt: new Date(),
        userId: transaction.userId,
        attemptCount: { increment: 1 },
        leaseOwner: null,
        leaseToken: null,
        leasedUntil: null,
        lastError: null,
      },
    });
    if (marked.count !== 1) throw new Error('Billing event lease was lost before commit');
  });
}
