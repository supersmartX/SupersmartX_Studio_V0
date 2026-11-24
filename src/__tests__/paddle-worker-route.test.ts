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
  completeCancellation: vi.fn(),
  updateOperation: vi.fn(),
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
    billingOperation: { findMany: mocks.findOperations, updateMany: mocks.updateOperation },
  }),
}));

vi.mock('@/lib/billing/operations', () => ({
  acquireBillingEventLease: mocks.acquire,
  renewBillingEventLease: mocks.renew,
  applyAdjustmentEvent: mocks.applyAdjustment,
  applyFailedPaymentEvent: mocks.applyFailed,
  applyPaidBillingEvent: mocks.applyPaid,
  applySubscriptionSnapshot: mocks.applySubscription,
  completeReconciledCancellation: mocks.completeCancellation,
  releaseBillingEventLease: mocks.release,
  ProviderCustomerIdConflictError: class ProviderCustomerIdConflictError extends Error {
    constructor() {
      super('Provider customer ID conflict with active subscription');
      this.name = 'ProviderCustomerIdConflictError';
    }
  },
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
  };
});

import { GET } from '@/app/api/internal/paddle/worker/route';
import { createSandboxCheckoutQuote } from '@/lib/billing/paddle';

function request(secret = 'worker-secret') {
  return new NextRequest('http://localhost/api/internal/paddle/worker', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  });
}

function paidDetails(currency: string, subtotal: string, tax: string, total: string) {
  const amounts = { subtotal, discount: '0', tax, total };
  return {
    totals: {
      ...amounts,
      currencyCode: currency,
      credit: '0',
      creditToBalance: '0',
      balance: '0',
      grandTotal: total,
      grandTotalTax: tax,
    },
    lineItems: [{ quantity: 1, unitTotals: amounts, totals: amounts }],
  };
}

function regionalPrice(input: {
  id: string;
  baseAmount: string;
  interval: 'month' | 'year';
  indiaAmount: string;
}) {
  return {
    id: input.id,
    productId: 'pro_creator',
    type: 'standard',
    status: 'active',
    unitPrice: { currencyCode: 'USD', amount: input.baseAmount },
    trialPeriod: null,
    billingCycle: { interval: input.interval, frequency: 1 },
    quantity: { minimum: 1, maximum: 999999 },
    taxMode: 'location',
    unitPriceOverrides: [{
      countryCodes: ['IN'],
      unitPrice: { currencyCode: 'INR', amount: input.indiaAmount },
    }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CRON_SECRET', 'worker-secret');
  vi.stubEnv('PADDLE_ENVIRONMENT', '');
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
  mocks.updateOperation.mockResolvedValue({ count: 1 });
});

describe('Paddle durable webhook worker', () => {
  it('ignores invoice issuance and retries paid transactions awaiting a subscription', async () => {
    const event = (eventType: string) => [{ eventId: 'evt-processing', occurredAt: new Date(),
      payloadJson: JSON.stringify({ eventType, data: { id: 'txn-processing' } }) }];
    mocks.findEvents.mockResolvedValue(event('transaction.billed'));
    await GET(request());
    expect(mocks.transactionGet).not.toHaveBeenCalled();
    expect(mocks.applyPaid).not.toHaveBeenCalled();
    mocks.findEvents.mockResolvedValue(event('transaction.paid'));
    mocks.transactionGet.mockResolvedValue({ id: 'txn-processing', status: 'paid', customerId: 'ctm-1', subscriptionId: null });
    await GET(request());
    expect(mocks.release).toHaveBeenLastCalledWith('evt-processing', expect.any(String), 'failed', 'provider_or_persistence_error');
    expect(mocks.applyPaid).not.toHaveBeenCalled();
  });

  it.each(['valid', 'foreign-customer', 'wrong-consent', 'not-enrolled'] as const)(
    'checks a renewal with an expired initial quote: %s', async (scenario) => {
      vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
      vi.stubEnv('AUTH_SECRET', 'renewal-test-secret');
      vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri-monthly');
      vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
      vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
      const enrolledAt = new Date('2026-09-01T12:00:00Z');
      const price = regionalPrice({ id: 'pri-monthly', baseAmount: '799', interval: 'month', indiaAmount: '34900' });
      const quote = await createSandboxCheckoutQuote({ prices: { get: vi.fn().mockResolvedValue(price) } } as never,
        'creator_monthly', 'US', enrolledAt);
      const customData = { sup_user_id: 'user-1', sup_plan: 'creator_monthly', sup_reservation_id: 'res-1',
        sup_consent_version: '2', sup_consent_hash: 'consent', sup_quote_token: quote.quoteToken };
      const original = { id: 'txn-original', status: 'completed', subscriptionId: 'sub-1',
        customerId: scenario === 'foreign-customer' ? 'ctm-other' : 'ctm-1',
        createdAt: enrolledAt.toISOString(), customData: { ...customData,
          sup_consent_hash: scenario === 'wrong-consent' ? 'other' : 'consent' } };
      const renewal = { id: 'txn-renewal', origin: 'subscription_recurring', status: 'completed',
        subscriptionId: 'sub-1', customerId: 'ctm-1', createdAt: '2026-10-01T12:00:00Z',
        billedAt: '2026-10-01T12:00:00Z', customData: { sup_user_id: 'user-1', sup_plan: 'creator_monthly', sup_reservation_id: 'res-1', sup_consent_hash: 'consent' }, currencyCode: 'USD', address: { countryCode: 'US' },
        items: [{ quantity: 1, price }], details: paidDetails('USD', '799', '0', '799'),
        billingPeriod: { startsAt: '2026-10-01T12:00:00Z', endsAt: '2026-11-01T12:00:00Z' } };
      mocks.findEvents.mockResolvedValue([{ eventId: 'evt-renewal', occurredAt: new Date('2026-10-01T12:00:00Z'),
        payloadJson: JSON.stringify({ eventType: 'transaction.completed', data: renewal }) }]);
      mocks.findAccount.mockResolvedValue(scenario === 'not-enrolled' ? null : {
        userId: 'user-1', providerSubscriptionId: 'sub-1', providerCustomerId: 'ctm-1', plan: 'creator_monthly' });
      mocks.findReservation.mockResolvedValue({ id: 'res-1', userId: 'user-1', plan: 'creator_monthly',
        period: 'monthly', currency: 'USD', consentHash: 'consent', providerTransactionId: 'txn-original' });
      mocks.transactionGet.mockImplementation((id: string) => Promise.resolve(id === 'txn-original' ? original : renewal));
      mocks.subscriptionGet.mockResolvedValue({ id: 'sub-1', customerId: 'ctm-1', customData,
        nextBilledAt: '2026-11-01T12:00:00Z', currentBillingPeriod: renewal.billingPeriod });
      await GET(request());
      if (scenario === 'valid') {
        expect(mocks.applyPaid).toHaveBeenCalledWith(expect.objectContaining({
          providerTransactionId: 'txn-renewal', reservationId: undefined,
          periodEndAt: new Date('2026-11-01T12:00:00Z'),
        }));
        expect(mocks.release).not.toHaveBeenCalled();
      } else {
        expect(mocks.applyPaid).not.toHaveBeenCalled();
        expect(mocks.release).toHaveBeenCalled();
      }
    },
  );

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

  it('does not process a duplicate webhook event when another worker owns its lease', async () => {
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-duplicate',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventId: 'evt-duplicate',
        eventType: 'transaction.paid',
        data: { id: 'txn-duplicate' },
      }),
    }]);
    mocks.acquire.mockResolvedValue(false);

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(mocks.transactionGet).not.toHaveBeenCalled();
    expect(mocks.applyPaid).not.toHaveBeenCalled();
  });

  it('drains more than one batch in a single invocation', async () => {
    const batch = (start: number, count: number) => Array.from({ length: count }, (_, index) => ({
      eventId: `evt-drain-${start + index}`,
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
      payloadJson: JSON.stringify({
        eventType: 'customer.updated',
        data: { id: `ctm-${start + index}` },
      }),
    }));
    mocks.findEvents
      .mockResolvedValueOnce(batch(0, 8))
      .mockResolvedValueOnce(batch(8, 3));

    const response = await GET(request());
    const body = await response.json();

    expect(body).toMatchObject({ ignored: 11, leased: 11 });
    expect(mocks.release).toHaveBeenCalledTimes(11);
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
      period: 'monthly',
      currency: 'USD',
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
      details: paidDetails('USD', '799', '0', '799'),
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

  it('grants a paid transaction with valid location tax and records the actual total', async () => {
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
      details: paidDetails('USD', '799', '64', '863'),
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
      period: 'monthly',
      currency: 'USD',
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

    expect(mocks.applyPaid).toHaveBeenCalledWith(expect.objectContaining({
      amount: '863',
      currency: 'USD',
    }));
    expect(mocks.release).not.toHaveBeenCalledWith(
      'evt-taxed',
      expect.any(String),
      'review',
      expect.any(String),
    );
  });

  it.each([
    {
      plan: 'creator_monthly' as const,
      period: 'monthly' as const,
      country: 'IN',
      amount: 349,
      currency: 'INR',
      priceId: 'pri-monthly',
      baseAmount: '799',
      indiaAmount: '34900',
      interval: 'month' as const,
      totalMinor: '34900',
    },
    {
      plan: 'creator_yearly' as const,
      period: 'yearly' as const,
      country: 'IN',
      amount: 2899,
      currency: 'INR',
      priceId: 'pri-yearly',
      baseAmount: '6599',
      indiaAmount: '289900',
      interval: 'year' as const,
      totalMinor: '289900',
    },
    {
      plan: 'creator_monthly' as const,
      period: 'monthly' as const,
      country: 'US',
      amount: 7.99,
      currency: 'USD',
      priceId: 'pri-monthly',
      baseAmount: '799',
      indiaAmount: '34900',
      interval: 'month' as const,
      totalMinor: '799',
    },
    {
      plan: 'creator_yearly' as const,
      period: 'yearly' as const,
      country: 'US',
      amount: 65.99,
      currency: 'USD',
      priceId: 'pri-yearly',
      baseAmount: '6599',
      indiaAmount: '289900',
      interval: 'year' as const,
      totalMinor: '6599',
    },
  ])('verifies a $currency $period quote against the paid transaction', async (priceConfig) => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('AUTH_SECRET', 'worker-test-quote-secret');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri-monthly');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_YEARLY', 'pri-yearly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_YEARLY', '65.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    mocks.priceConfiguration.mockReturnValue({
      priceId: priceConfig.priceId,
      amount: priceConfig.plan === 'creator_monthly' ? 7.99 : 65.99,
      currency: 'USD',
      period: priceConfig.period,
    });

    const price = regionalPrice({
      id: priceConfig.priceId,
      baseAmount: priceConfig.baseAmount,
      interval: priceConfig.interval,
      indiaAmount: priceConfig.indiaAmount,
    });
    const quote = await createSandboxCheckoutQuote({
      prices: { get: vi.fn().mockResolvedValue(price) },
    } as never, priceConfig.plan, priceConfig.country);
    const createdAt = new Date();
    const periodEnd = new Date(createdAt);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + (priceConfig.period === 'monthly' ? 1 : 12));
    const consentHash = `consent-${priceConfig.plan}-${priceConfig.country}`;
    const customData = {
      sup_user_id: 'user-1',
      sup_plan: priceConfig.plan,
      sup_consent_hash: consentHash,
      sup_consent_version: '2',
      sup_reservation_id: 'reservation-1',
      sup_quote_token: quote.quoteToken,
    };
    const data = {
      id: 'txn-regional',
      status: 'paid',
      subscriptionId: 'sub-1',
      customerId: 'ctm-1',
      createdAt: createdAt.toISOString(),
      billedAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      address: { countryCode: priceConfig.country },
      currencyCode: priceConfig.currency,
      customData,
      items: [{
        quantity: 1,
        price,
      }],
      billingPeriod: {
        startsAt: createdAt.toISOString(),
        endsAt: periodEnd.toISOString(),
      },
      details: paidDetails(
        priceConfig.currency,
        priceConfig.totalMinor,
        '0',
        priceConfig.totalMinor,
      ),
    };
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-regional',
      occurredAt: createdAt,
      payloadJson: JSON.stringify({
        eventId: 'evt-regional',
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
      plan: priceConfig.plan,
      period: priceConfig.period,
      currency: priceConfig.currency,
      consentHash,
      providerTransactionId: null,
    });
    mocks.transactionGet.mockResolvedValue(data);
    mocks.subscriptionGet.mockResolvedValue({
      id: 'sub-1',
      customerId: 'ctm-1',
      status: 'active',
      customData: null,
      currentBillingPeriod: data.billingPeriod,
      nextBilledAt: periodEnd.toISOString(),
    });

    await GET(request());

    expect(mocks.applyPaid).toHaveBeenCalledWith(expect.objectContaining({
      plan: priceConfig.plan,
      currency: priceConfig.currency,
      amount: priceConfig.totalMinor,
      reservationId: 'reservation-1',
    }));
    expect(mocks.release).not.toHaveBeenCalledWith(
      'evt-regional',
      expect.any(String),
      'review',
      expect.any(String),
    );

    const wrongCountryData = {
      ...data,
      id: 'txn-wrong-country',
      address: { countryCode: priceConfig.country === 'IN' ? 'US' : 'IN' },
    };
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-wrong-country',
      occurredAt: createdAt,
      payloadJson: JSON.stringify({
        eventId: 'evt-wrong-country',
        eventType: 'transaction.paid',
        data: wrongCountryData,
      }),
    }]);
    mocks.transactionGet.mockResolvedValue(wrongCountryData);
    await GET(request());
    expect(mocks.applyPaid).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith(
      'evt-wrong-country',
      expect.any(String),
      'review',
      'transaction_country_mismatch',
    );

    const wrongCurrencyData = {
      ...data,
      id: 'txn-wrong-currency',
      currencyCode: priceConfig.currency === 'INR' ? 'USD' : 'INR',
    };
    mocks.findEvents.mockResolvedValue([{
      eventId: 'evt-wrong-currency',
      occurredAt: createdAt,
      payloadJson: JSON.stringify({
        eventId: 'evt-wrong-currency',
        eventType: 'transaction.paid',
        data: wrongCurrencyData,
      }),
    }]);
    mocks.transactionGet.mockResolvedValue(wrongCurrencyData);
    await GET(request());
    expect(mocks.applyPaid).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledWith(
      'evt-wrong-currency',
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

  it('completes a pending cancellation once Paddle confirms the scheduled change', async () => {
    mocks.findOperations.mockResolvedValue([
      { id: 'operation-1', userId: 'user-1', resourceId: 'sub-1' },
    ]);
    mocks.subscriptionGet.mockResolvedValue({
      id: 'sub-1',
      status: 'active',
      scheduledChange: { action: 'cancel', effectiveAt: '2026-12-01T00:00:00.000Z' },
      canceledAt: null,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ cancellationsReconciled: 1 });
    expect(mocks.completeCancellation).toHaveBeenCalledWith({
      operationId: 'operation-1',
      userId: 'user-1',
      subscriptionId: 'sub-1',
      cancelAtPeriodEnd: true,
      status: 'active',
      canceledAt: null,
    });
  });

  it('fails a pending cancellation Paddle reports as active without a scheduled change', async () => {
    mocks.findOperations.mockResolvedValue([
      { id: 'operation-2', userId: 'user-1', resourceId: 'sub-1' },
    ]);
    mocks.subscriptionGet.mockResolvedValue({
      id: 'sub-1',
      status: 'active',
      scheduledChange: null,
      canceledAt: null,
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ cancellationsReconciled: 1 });
    expect(mocks.completeCancellation).not.toHaveBeenCalled();
    expect(mocks.updateOperation).toHaveBeenCalledWith({
      where: { id: 'operation-2', status: { in: ['pending', 'uncertain'] } },
      data: { status: 'failed', lastError: 'provider_confirms_cancellation_not_scheduled' },
    });
  });
});
