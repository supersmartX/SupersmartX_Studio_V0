import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findLease: vi.fn(),
  findUser: vi.fn(),
  upsertAccount: vi.fn(),
  findReservation: vi.fn(),
  findActiveReservation: vi.fn(),
  createReservation: vi.fn(),
  updateReservation: vi.fn(),
  findTransaction: vi.fn(),
  createTransaction: vi.fn(),
  claimTransactionGrant: vi.fn(),
  findAccount: vi.fn(),
  updateTransaction: vi.fn(),
  findUserTransactions: vi.fn(),
  upsertAdjustment: vi.fn(),
  findAdjustments: vi.fn(),
  updateUser: vi.fn(),
  updateAccount: vi.fn(),
  updateEvent: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => {
    const tx = {
      billingEvent: {
        findFirst: mocks.findLease,
        updateMany: mocks.updateEvent,
      },
      user: {
        findUnique: mocks.findUser,
        update: mocks.updateUser,
      },
      billingAccount: {
        upsert: mocks.upsertAccount,
        findUnique: mocks.findAccount,
        update: mocks.updateAccount,
      },
      billingReservation: {
        findUnique: mocks.findReservation,
        findFirst: mocks.findActiveReservation,
        create: mocks.createReservation,
        update: mocks.updateReservation,
      },
      billingTransaction: {
        findUnique: mocks.findTransaction,
        createMany: mocks.createTransaction,
        updateMany: mocks.claimTransactionGrant,
        update: mocks.updateTransaction,
        findMany: mocks.findUserTransactions,
      },
      billingAdjustment: {
        upsert: mocks.upsertAdjustment,
        findMany: mocks.findAdjustments,
      },
    };
    return {
      ...tx,
      $transaction: vi.fn((callback: (transaction: typeof tx) => unknown) => callback(tx)),
    };
  },
}));

import {
  ActiveBillingSubscriptionError,
  acquireBillingEventLease,
  applyAdjustmentEvent,
  applyPaidBillingEvent,
  releaseBillingEventLease,
  reserveCheckout,
  UnresolvedCheckoutReservationError,
  renewBillingEventLease,
} from '@/lib/billing/operations';

const leaseInput = {
  eventId: 'evt-adjustment',
  leaseToken: 'lease-token',
  adjustmentId: 'adj-1',
  transactionId: 'txn-target',
  action: 'refund',
  actionType: 'partial',
  status: 'approved',
  amount: '100.00',
  currency: 'INR',
  updatedAt: new Date('2026-11-18T12:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createTransaction.mockResolvedValue({ count: 1 });
  mocks.claimTransactionGrant.mockResolvedValue({ count: 0 });
  mocks.findUser.mockResolvedValue({ plan: 'free', planExpiresAt: null });
  mocks.upsertAccount.mockResolvedValue({});
  mocks.findReservation.mockResolvedValue(null);
  mocks.findActiveReservation.mockResolvedValue(null);
  mocks.createReservation.mockResolvedValue({});
  mocks.updateReservation.mockResolvedValue({});
  mocks.findLease.mockResolvedValue({ eventId: 'evt-adjustment' });
  mocks.findTransaction.mockResolvedValue({ userId: 'user-1', currency: 'INR', amount: '349.00' });
  mocks.findAccount.mockResolvedValue({
    legacyPlan: 'creator_monthly',
    legacyPaidThroughAt: new Date('2026-12-01T00:00:00.000Z'),
  });
  mocks.updateTransaction.mockResolvedValue({});
  mocks.findUserTransactions.mockResolvedValue([{
    plan: 'creator_monthly',
    periodEndAt: new Date('2027-01-01T00:00:00.000Z'),
  }]);
  mocks.upsertAdjustment.mockResolvedValue({});
  mocks.findAdjustments.mockResolvedValue([{
    action: 'refund',
    actionType: 'partial',
    status: 'approved',
    updatedAt: leaseInput.updatedAt,
  }]);
  mocks.updateUser.mockResolvedValue({});
  mocks.updateAccount.mockResolvedValue({});
  mocks.updateEvent.mockResolvedValue({ count: 1 });
});

describe('Paddle billing operations', () => {
  it('does not claim entitlement twice for the same provider transaction', async () => {
    mocks.findLease.mockResolvedValue({
      eventId: 'evt-paid-duplicate',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
    });
    mocks.findUser.mockResolvedValue({
      plan: 'creator_monthly',
      planExpiresAt: new Date('2026-12-18T00:00:00.000Z'),
    });
    mocks.findAccount.mockResolvedValue({
      userId: 'user-1',
      providerSubscriptionId: 'sub-1',
      providerCustomerId: 'ctm-1',
      paidThroughAt: new Date('2026-12-18T00:00:00.000Z'),
      legacyPaidThroughAt: null,
      legacyPlan: null,
      plan: 'creator_monthly',
      status: 'active',
      lastEventAt: null,
    });
    mocks.findTransaction.mockResolvedValue({
      id: 'billing-txn-1',
      userId: 'user-1',
      entitlementGrantedAt: new Date('2026-11-18T12:00:00.000Z'),
    });
    mocks.createTransaction.mockResolvedValue({ count: 0 });

    await applyPaidBillingEvent({
      eventId: 'evt-paid-duplicate',
      leaseToken: 'lease-token',
      reservationId: null,
      userId: 'user-1',
      plan: 'creator_monthly',
      providerTransactionId: 'txn-paid-duplicate',
      providerSubscriptionId: 'sub-1',
      providerCustomerId: 'ctm-1',
      amount: '349.00',
      currency: 'INR',
      paidAt: new Date('2026-11-18T12:00:00.000Z'),
      periodStartAt: new Date('2026-11-18T12:00:00.000Z'),
      periodEndAt: new Date('2026-12-18T00:00:00.000Z'),
      nextChargeAt: new Date('2026-12-18T00:00:00.000Z'),
    });

    expect(mocks.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.arrayContaining([
        expect.objectContaining({ providerTransactionId: 'txn-paid-duplicate' }),
      ]),
      skipDuplicates: true,
    }));
    expect(mocks.claimTransactionGrant).not.toHaveBeenCalled();
  });

  it('records a partial refund without revoking the paid term', async () => {
    await applyAdjustmentEvent(leaseInput);

    expect(mocks.upsertAdjustment).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        amount: '100.00',
        currency: 'INR',
        actionType: 'partial',
      }),
    }));
    expect(mocks.updateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'paid',
        refundedAt: leaseInput.updatedAt,
      }),
    }));
    expect(mocks.updateUser).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        plan: 'creator_monthly',
        planExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
      },
    }));
  });

  it('removes only a fully refunded transaction and preserves other paid coverage', async () => {
    mocks.findAdjustments.mockResolvedValue([{
      action: 'refund',
      actionType: 'full',
      status: 'approved',
      updatedAt: leaseInput.updatedAt,
    }]);
    mocks.findUserTransactions.mockResolvedValue([{
      plan: 'creator_yearly',
      periodEndAt: new Date('2027-06-01T00:00:00.000Z'),
    }]);

    await applyAdjustmentEvent({ ...leaseInput, actionType: 'full' });

    expect(mocks.updateTransaction).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'refunded' }),
    }));
    expect(mocks.updateUser).toHaveBeenCalledWith(expect.objectContaining({
      data: {
        plan: 'creator_yearly',
        planExpiresAt: new Date('2027-06-01T00:00:00.000Z'),
      },
    }));
  });

  it('moves an event to manual review after the bounded retry limit', async () => {
    mocks.findLease.mockResolvedValue({ attemptCount: 9 });

    await releaseBillingEventLease('evt-failing', 'lease-token', 'failed', 'provider_unavailable');

    expect(mocks.updateEvent).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'review',
        lastError: 'provider_unavailable',
        processedAt: expect.any(Date),
      }),
    }));
  });

  it('does not let an expired lease renew or release after fencing', async () => {
    mocks.findLease.mockResolvedValue(null);
    mocks.updateEvent.mockResolvedValue({ count: 0 });

    await expect(renewBillingEventLease(
      'evt-expired',
      'stale-token',
      new Date(Date.now() + 60_000),
    )).resolves.toBe(false);
    await expect(releaseBillingEventLease('evt-expired', 'stale-token', 'failed')).resolves.toBe(false);

    expect(mocks.updateEvent).toHaveBeenCalledTimes(1);
    expect(mocks.updateEvent).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        eventId: 'evt-expired',
        status: 'processing',
        leaseToken: 'stale-token',
        leasedUntil: expect.objectContaining({ gt: expect.any(Date) }),
      }),
    }));
  });

  it('atomically claims an event only when its lease is available', async () => {
    mocks.updateEvent.mockResolvedValue({ count: 1 });

    await expect(acquireBillingEventLease(
      'evt-new',
      'worker-1',
      'lease-1',
      new Date(Date.now() + 60_000),
    )).resolves.toBe(true);

    expect(mocks.updateEvent).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        eventId: 'evt-new',
        status: { in: ['received', 'processing', 'failed'] },
      }),
      data: expect.objectContaining({
        status: 'processing',
        leaseOwner: 'worker-1',
        leaseToken: 'lease-1',
      }),
    }));
  });

  it('does not enroll an account with an active Paddle subscription again', async () => {
    mocks.findAccount.mockResolvedValue({
      userId: 'user-1',
      providerSubscriptionId: 'sub-existing',
      status: 'active',
      legacyPlan: 'free',
      legacyPaidThroughAt: null,
      paidThroughAt: new Date('2027-01-01T00:00:00.000Z'),
    });

    await expect(reserveCheckout({
      userId: 'user-1',
      reservationId: 'reservation-new',
      plan: 'creator_monthly',
      period: 'monthly',
      amount: 349,
      currency: 'INR',
      consentVersion: '1',
      consentHash: 'consent-hash',
    })).rejects.toBeInstanceOf(ActiveBillingSubscriptionError);
    expect(mocks.createReservation).not.toHaveBeenCalled();
  });

  it('returns the existing reservation identity instead of attempting a duplicate checkout', async () => {
    mocks.findActiveReservation.mockResolvedValue({ id: 'reservation-in-progress' });

    await expect(reserveCheckout({
      userId: 'user-1',
      reservationId: 'reservation-new',
      plan: 'creator_monthly',
      period: 'monthly',
      amount: 349,
      currency: 'INR',
      consentVersion: '1',
      consentHash: 'consent-hash',
    })).rejects.toEqual(expect.objectContaining({
      name: 'UnresolvedCheckoutReservationError',
      reservationId: 'reservation-in-progress',
    } satisfies Partial<UnresolvedCheckoutReservationError>));
    expect(mocks.createReservation).not.toHaveBeenCalled();
  });
});
