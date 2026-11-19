import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  findEvents: vi.fn(),
  findAccount: vi.fn(),
  findReservation: vi.fn(),
  findOperations: vi.fn(),
  findTransaction: vi.fn(),
  acquire: vi.fn(),
  renew: vi.fn(),
  release: vi.fn(),
  applyPaid: vi.fn(),
  applyFailed: vi.fn(),
  applySubscription: vi.fn(),
  applyAdjustment: vi.fn(),
  transactionGet: vi.fn(),
  subscriptionGet: vi.fn(),
  priceConfiguration: vi.fn(),
  adjustmentList: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => ({
    billingEvent: { findMany: mocks.findEvents },
    billingAccount: { findUnique: mocks.findAccount },
    billingReservation: { findUnique: mocks.findReservation },
    billingTransaction: { findUnique: mocks.findTransaction },
    billingOperation: { findMany: mocks.findOperations },
  }),
}));

vi.mock('@/lib/billing/operations', () => ({
  acquireBillingEventLease: mocks.acquire,
  renewBillingEventLease: mocks.renew,
  applyAdjustmentEvent: mocks.applyAdjustment,
  applyFailedPaymentEvent: mocks.applyFailed,
  applyPaidBillingEvent: mocks.applyPaid,
  applySubscriptionSnapshot: mocks.applySubscription,
  releaseBillingEventLease: mocks.release,
}));

vi.mock('@/lib/billing/paddle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/paddle')>();
  return {
    ...actual,
    getPaddleClient: () => ({
      transactions: { get: mocks.transactionGet },
      subscriptions: { get: mocks.subscriptionGet },
      adjustments: { list: mocks.adjustmentList },
    }),
    getPaddlePriceConfiguration: mocks.priceConfiguration,
    isAuthoritativelyPaid: (status: string) => ['paid', 'completed', 'billed'].includes(status),
  };
});

import { GET } from '@/app/api/internal/paddle/worker/route';

function request(secret = 'worker-secret') {
  return new NextRequest('http://localhost/api/internal/paddle/worker', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'worker-secret');
  mocks.findEvents.mockResolvedValue([]);
  mocks.acquire.mockResolvedValue(true);
  mocks.release.mockResolvedValue(true);
  mocks.findAccount.mockResolvedValue(null);
  mocks.findReservation.mockResolvedValue(null);
  mocks.findOperations.mockResolvedValue([]);
  mocks.findTransaction.mockResolvedValue(null);
  mocks.priceConfiguration.mockReturnValue({
    priceId: 'pri-monthly',
    amount: 7.99,
    currency: 'USD',
    period: 'monthly',
  });
  mocks.renew.mockResolvedValue(true);
});

describe('Paddle durable webhook worker', () => {
  it('rejects unauthorized invocations', async () => {
    const response = await GET(request('wrong-secret'));
    expect(response.status).toBe(401);
    expect(mocks.findEvents).not.toHaveBeenCalled();
  });

  it('moves unpaid transaction events to review without granting access', async () => {
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-unpaid',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-unpaid',
        eventType: 'transaction.paid',
        data: { id: 'txn-unpaid' },
      }),
    }]);
    mocks.transactionGet.mockResolvedValue({
      id: 'txn-unpaid',
      status: 'ready',
      subscriptionId: 'sub-1',
      customerId: 'ctm-1',
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.release).toHaveBeenCalledWith(
      'evt-unpaid',
      expect.any(String),
      'review',
      'transaction_not_paid',
    );
    expect(mocks.applyPaid).not.toHaveBeenCalled();
  });

  it('does not interpret subscription.activated IDs as transaction IDs', async () => {
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-subscription',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-subscription',
        eventType: 'subscription.activated',
        data: { id: 'sub-1' },
      }),
    }]);
    mocks.findAccount.mockImplementation(({ where }: { where: Record<string, string> }) =>
      Promise.resolve(where.providerSubscriptionId
        ? { userId: 'user-1' }
        : { userId: 'user-1', providerSubscriptionId: 'sub-1', providerCustomerId: 'ctm-1' }),
    );
    mocks.subscriptionGet.mockResolvedValue({
      id: 'sub-1',
      customerId: 'ctm-1',
      status: 'active',
      customData: null,
      nextBilledAt: '2026-12-18T00:00:00.000Z',
      scheduledChange: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.subscriptionGet).toHaveBeenCalledWith('sub-1');
    expect(mocks.transactionGet).not.toHaveBeenCalled();
    expect(mocks.applyPaid).not.toHaveBeenCalled();
    expect(mocks.applySubscription).toHaveBeenCalledWith(expect.objectContaining({
      subscriptionId: 'sub-1',
      userId: 'user-1',
      status: 'active',
    }));
  });

  it('applies a failed renewal status without attempting to grant another term', async () => {
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-failed-renewal',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-failed-renewal',
        eventType: 'transaction.payment_failed',
        data: { id: 'txn-failed-renewal' },
      }),
    }]);
    mocks.findAccount.mockResolvedValue({
      userId: 'user-1',
      providerSubscriptionId: 'sub-1',
      providerCustomerId: 'ctm-1',
    });
    mocks.transactionGet.mockResolvedValue({
      id: 'txn-failed-renewal',
      status: 'past_due',
      subscriptionId: 'sub-1',
      customerId: 'ctm-1',
      customData: null,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.applyFailed).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt-failed-renewal',
      userId: 'user-1',
      providerSubscriptionId: 'sub-1',
      providerCustomerId: 'ctm-1',
    }));
    expect(mocks.applyPaid).not.toHaveBeenCalled();
  });

  it('grants only after verifying the exact paid transaction, price, owner, and term', async () => {
    const periodStart = '2026-11-18T00:00:00.000Z';
    const periodEnd = '2026-12-18T00:00:00.000Z';
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-paid',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-paid',
        eventType: 'transaction.paid',
        data: {
          id: 'txn-paid',
          customData: {
            sup_user_id: 'user-1',
            sup_plan: 'creator_monthly',
            sup_consent_hash: 'consent-1',
            sup_reservation_id: 'reservation-1',
          },
        },
      }),
    }]);
    mocks.findAccount.mockImplementation(({ where }: { where: Record<string, string> }) =>
      Promise.resolve(where.providerSubscriptionId
        ? null
        : {
          userId: 'user-1',
          plan: 'free',
          providerSubscriptionId: null,
          providerCustomerId: null,
        }),
    );
    mocks.findReservation.mockResolvedValue({
      id: 'reservation-1',
      userId: 'user-1',
      plan: 'creator_monthly',
      consentHash: 'consent-1',
      providerTransactionId: null,
    });
    mocks.transactionGet.mockResolvedValue({
      id: 'txn-paid',
      status: 'paid',
      subscriptionId: 'sub-1',
      customerId: 'ctm-1',
      customData: {
        sup_user_id: 'user-1',
        sup_plan: 'creator_monthly',
        sup_consent_hash: 'consent-1',
        sup_reservation_id: 'reservation-1',
      },
      items: [{
        quantity: 1,
        price: {
          id: 'pri-monthly',
          unitPrice: { currencyCode: 'USD', amount: '799' },
          trialPeriod: null,
          billingCycle: { interval: 'month', frequency: 1 },
        },
      }],
      billingPeriod: { startsAt: periodStart, endsAt: periodEnd },
      details: { totals: {
        subtotal: '799',
        discount: '0',
        tax: '0',
        grandTotal: '799',
      } },
      currencyCode: 'USD',
      billedAt: '2026-11-18T12:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    });

    mocks.subscriptionGet.mockResolvedValue({
      id: 'sub-1',
      customerId: 'ctm-1',
      status: 'active',
      customData: null,
      currentBillingPeriod: { startsAt: periodStart, endsAt: periodEnd },
      nextBilledAt: periodEnd,
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.renew).toHaveBeenCalledWith('evt-paid', expect.any(String), expect.any(Date));
    expect(mocks.applyPaid).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt-paid',
      reservationId: 'reservation-1',
      userId: 'user-1',
      plan: 'creator_monthly',
      providerTransactionId: 'txn-paid',
      providerSubscriptionId: 'sub-1',
      providerCustomerId: 'ctm-1',
      amount: '799',
      currency: 'USD',
      periodStartAt: new Date(periodStart),
      periodEndAt: new Date(periodEnd),
    }));
    expect(mocks.release).not.toHaveBeenCalledWith(
      'evt-paid',
      expect.any(String),
      'review',
      expect.any(String),
    );

    mocks.priceConfiguration.mockReturnValue({
      priceId: 'pri-monthly',
      amount: 8,
      currency: 'USD',
      period: 'monthly',
    });
    await GET(request());

    expect(mocks.applyPaid).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith(
      'evt-paid',
      expect.any(String),
      'review',
      'transaction_price_mismatch',
    );
  });

  it('does not grant a paid transaction when tax or discount changes the confirmed price', async () => {
    const data = {
      id: 'txn-paid',
      status: 'paid',
      subscriptionId: 'sub-1',
      customerId: 'ctm-1',
      customData: {
        sup_user_id: 'user-1',
        sup_plan: 'creator_monthly',
        sup_consent_hash: 'consent-1',
        sup_reservation_id: 'reservation-1',
      },
      items: [{
        quantity: 1,
        price: {
          id: 'pri-monthly',
          unitPrice: { currencyCode: 'USD', amount: '799' },
          trialPeriod: null,
          billingCycle: { interval: 'month', frequency: 1 },
        },
      }],
      billingPeriod: { startsAt: '2026-11-18T00:00:00.000Z', endsAt: '2026-12-18T00:00:00.000Z' },
      details: { totals: {
        subtotal: '799',
        discount: '0',
        tax: '1',
        grandTotal: '800',
      } },
      currencyCode: 'USD',
      billedAt: '2026-11-18T12:00:00.000Z',
      updatedAt: '2026-11-18T12:00:00.000Z',
    };
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-taxed',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-taxed',
        eventType: 'transaction.paid',
        data,
      }),
    }]);
    mocks.findAccount.mockImplementation(({ where }: { where: Record<string, string> }) =>
      Promise.resolve(where.providerSubscriptionId
        ? null
        : { userId: 'user-1', plan: 'free', providerSubscriptionId: null, providerCustomerId: null }),
    );
    mocks.findReservation.mockResolvedValue({
      id: 'reservation-1',
      userId: 'user-1',
      plan: 'creator_monthly',
      consentHash: 'consent-1',
      providerTransactionId: null,
    });
    mocks.transactionGet.mockResolvedValue(data);
    mocks.subscriptionGet.mockResolvedValue({
      id: 'sub-1',
      customerId: 'ctm-1',
      status: 'active',
      customData: null,
      currentBillingPeriod: data.billingPeriod,
      nextBilledAt: data.billingPeriod.endsAt,
    });

    await GET(request());

    expect(mocks.applyPaid).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledWith(
      'evt-taxed',
      expect.any(String),
      'review',
      'paid_transaction_totals_invalid',
    );
  });

  it('records an authoritative partial refund without treating it as a full reversal', async () => {
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-adjustment',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-adjustment',
        eventType: 'adjustment.updated',
        data: { id: 'adj-1', transactionId: 'txn-1' },
      }),
    }]);
    mocks.findTransaction.mockResolvedValue({
      providerTransactionId: 'txn-1',
      userId: 'user-1',
      providerSubscriptionId: 'sub-1',
      currency: 'INR',
    });
    mocks.findAccount.mockResolvedValue({
      userId: 'user-1',
      providerCustomerId: 'ctm-1',
    });
    mocks.transactionGet.mockResolvedValue({
      id: 'txn-1',
      subscriptionId: 'sub-1',
      customerId: 'ctm-1',
    });
    mocks.adjustmentList.mockReturnValue({
      next: vi.fn().mockResolvedValue([{
        id: 'adj-1',
        transactionId: 'txn-1',
        subscriptionId: 'sub-1',
        customerId: 'ctm-1',
        action: 'refund',
        type: 'partial',
        status: 'approved',
        totals: { total: '100.00' },
        currencyCode: 'INR',
        updatedAt: '2026-11-18T12:00:00.000Z',
      }]),
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.adjustmentList).toHaveBeenCalledWith({
      id: ['adj-1'],
      transactionId: ['txn-1'],
      perPage: 1,
    });
    expect(mocks.applyAdjustment).toHaveBeenCalledWith(expect.objectContaining({
      adjustmentId: 'adj-1',
      transactionId: 'txn-1',
      action: 'refund',
      actionType: 'partial',
      status: 'approved',
      amount: '100.00',
      currency: 'INR',
    }));
  });
});
