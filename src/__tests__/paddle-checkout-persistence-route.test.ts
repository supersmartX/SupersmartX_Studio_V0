import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Prisma } from '@prisma/client';

const paddleErrors = vi.hoisted(() => {
  class PaddleCheckoutCreateError extends Error {
    constructor(readonly failure: {
      kind: 'rejected' | 'uncertain';
      reason: string;
      status: number | null;
      fields: { field: string; message: string }[];
    }) {
      super('Paddle checkout create failed');
      this.name = 'PaddleCheckoutCreateError';
    }
  }
  return { PaddleCheckoutCreateError };
});

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  reserveCheckout: vi.fn(),
  findActiveReservation: vi.fn(),
  findAccount: vi.fn(),
  updateReservation: vi.fn(),
  createSandboxCheckout: vi.fn(),
  sweepReservations: vi.fn(),
  failReservation: vi.fn(),
  recoverCheckoutReservation: vi.fn(),
  requestPaidCheckoutReconciliation: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => ({
    billingReservation: {
      update: mocks.updateReservation,
      findFirst: mocks.findActiveReservation,
    },
    billingAccount: {
      findUnique: mocks.findAccount,
    },
  }),
}));
vi.mock('@/lib/billing/operations', () => ({
  ActiveBillingSubscriptionError: class ActiveBillingSubscriptionError extends Error {},
  UnresolvedCheckoutReservationError: class UnresolvedCheckoutReservationError extends Error {
    constructor(readonly reservationId: string) {
      super('An unresolved checkout already exists');
    }
  },
  hashCheckoutConsent: () => 'a'.repeat(64),
  reserveCheckout: mocks.reserveCheckout,
}));
vi.mock('@/lib/billing/reservations', () => ({
  expireStaleUnclaimedCheckoutReservations: mocks.sweepReservations,
  failUnclaimedReservation: mocks.failReservation,
  recoverCheckoutReservation: mocks.recoverCheckoutReservation,
  requestPaidCheckoutReconciliation: mocks.requestPaidCheckoutReconciliation,
}));
vi.mock('@/lib/billing/paddle', () => ({
  assertSandboxPriceMatches: vi.fn().mockResolvedValue({ id: 'pri-1', productId: 'pro-1' }),
  describeCheckoutCreateFailure: (error: unknown) => ({
    kind: 'uncertain' as const,
    reason: error instanceof Error ? error.name : 'unknown_error',
    status: null,
    fields: [],
  }),
  getPaddleCheckoutUrl: () => 'https://checkout.paddle.com/checkout',
  getPaddleClient: () => ({}),
  getPaddleEnvironment: () => 'sandbox',
  getTrustedPaddleCountry: () => 'IN',
  isPaddleCheckoutEnabled: () => true,
  toPaddleHandoffUrl: (url: string, transactionId: string) => `${url}?_ptxn=${transactionId}`,
  PaddleCheckoutCreateError: paddleErrors.PaddleCheckoutCreateError,
  PaddlePriceLookupError: class PaddlePriceLookupError extends Error {},
  PaddlePriceMismatchError: class PaddlePriceMismatchError extends Error {},
  PaddleBillingProvider: class {
    createSandboxCheckout(input: unknown) {
      return mocks.createSandboxCheckout(input);
    }
  },
  verifySandboxQuoteToken: () => ({
    country: 'IN',
    plan: 'creator_monthly',
    period: 'monthly',
    amount: 349,
    currency: 'INR',
    productId: 'pro-1',
    priceId: 'pri-1',
  }),
}));

import { POST } from '@/app/api/paddle/checkout/route';

const consent = {
  plan: 'creator_monthly',
  period: 'monthly',
  amount: 349,
  currency: 'INR',
  consentVersion: '2',
  quoteToken: 'signed-quote',
  consentHash: 'a'.repeat(64),
};

function request() {
  return new NextRequest('http://localhost/api/paddle/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(consent),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PADDLE_API_KEY', 'pdl_sdbx_test_key');
  vi.stubEnv('PADDLE_WEBHOOK_SECRET', 'whsec_test');
  vi.stubEnv('CRON_SECRET', 'cron_test');
  vi.stubEnv('PADDLE_CLIENT_TOKEN', 'test_client_token');
  mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
  mocks.reserveCheckout.mockResolvedValue(undefined);
  mocks.findActiveReservation.mockResolvedValue(null);
  mocks.findAccount.mockResolvedValue(null);
  mocks.updateReservation.mockResolvedValue(undefined);
  mocks.sweepReservations.mockResolvedValue({ expired: [], linked: [] });
  mocks.failReservation.mockResolvedValue(true);
  mocks.recoverCheckoutReservation.mockResolvedValue({ kind: 'none' });
  mocks.requestPaidCheckoutReconciliation.mockResolvedValue({ duplicate: false });
});

describe('Paddle checkout persistence recovery', () => {
  it('does not present a recovered paid transaction as a new payment success', async () => {
    mocks.recoverCheckoutReservation.mockResolvedValue({
      kind: 'awaiting_payment',
      reservationId: 'reservation-paid',
      transactionId: 'txn-paid',
      userId: 'user-1',
      plan: 'creator_monthly',
      consentHash: 'a'.repeat(64),
      remoteStatus: 'paid',
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      state: 'payment_verification_pending',
      reservationId: 'reservation-paid',
      transactionId: 'txn-paid',
      retryAllowed: false,
      checkoutUrl: null,
    });
    expect(body.status).not.toBe('payment_received');
    expect(mocks.createSandboxCheckout).not.toHaveBeenCalled();
    expect(mocks.requestPaidCheckoutReconciliation).toHaveBeenCalledWith({
      reservation: {
        id: 'reservation-paid',
        userId: 'user-1',
        plan: 'creator_monthly',
        consentHash: 'a'.repeat(64),
      },
      transactionId: 'txn-paid',
    });
  });

  it('returns the existing reservation ID after the per-user uniqueness gate rejects a concurrent checkout', async () => {
    mocks.reserveCheckout.mockRejectedValue(new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`user_id`)',
      { code: 'P2002', clientVersion: '6.19.3', meta: { target: ['user_id'] } },
    ));
    mocks.findActiveReservation.mockResolvedValue({ id: 'reservation-existing' });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: 'An unresolved checkout already exists. Check its status before starting another.',
      reservationId: 'reservation-existing',
    });
    expect(mocks.createSandboxCheckout).not.toHaveBeenCalled();
  });

  it('returns the reservation ID when provider creation is uncertain and recording that uncertainty fails', async () => {
    mocks.createSandboxCheckout.mockRejectedValue(new Error('provider timeout'));
    mocks.updateReservation.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.reservationId).toEqual(expect.any(String));
    expect(body.error).toMatch(/check its status/i);
    expect(mocks.reserveCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.failReservation).not.toHaveBeenCalled();
  });

  it('releases the reservation when Paddle definitively declines the checkout', async () => {
    mocks.createSandboxCheckout.mockRejectedValue(new paddleErrors.PaddleCheckoutCreateError({
      kind: 'rejected',
      reason: 'request_error/checkout_url_invalid',
      status: 400,
      fields: [{ field: 'checkout.url', message: 'Not an approved domain' }],
    }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      retryAllowed: true,
      reason: 'request_error/checkout_url_invalid',
    });
    expect(body.error).toMatch(/no payment was taken/i);
    expect(mocks.failReservation).toHaveBeenCalledWith({ id: expect.any(String), userId: 'user-1' });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
    expect(mocks.reserveCheckout).toHaveBeenCalledTimes(1);
  });

  it('keeps blocking when a declined reservation cannot be released', async () => {
    mocks.failReservation.mockResolvedValue(false);
    mocks.createSandboxCheckout.mockRejectedValue(new paddleErrors.PaddleCheckoutCreateError({
      kind: 'rejected',
      reason: 'request_error/checkout_url_invalid',
      status: 400,
      fields: [],
    }));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.reservationId).toEqual(expect.any(String));
    expect(mocks.updateReservation).toHaveBeenCalledWith(expect.objectContaining({
      data: { status: 'pending', remoteStatus: 'provider_create_uncertain' },
    }));
  });

  it('returns the reservation ID when Paddle created a transaction but local linking fails', async () => {
    mocks.reserveCheckout
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('database unavailable'));
    mocks.createSandboxCheckout.mockResolvedValue({
      providerOperationId: 'txn-1',
      transactionId: 'txn-1',
      checkoutUrl: 'https://checkout.paddle.com/checkout/txn-1',
      status: 'created',
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.reservationId).toEqual(expect.any(String));
    expect(body.error).toMatch(/check its status/i);
    expect(mocks.reserveCheckout).toHaveBeenCalledTimes(2);
    expect(mocks.createSandboxCheckout).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      reservationId: body.reservationId,
    }));
  });

  it('refuses to start a checkout when the webhook worker secret is missing', async () => {
    vi.stubEnv('CRON_SECRET', '');

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error).toMatch(/fulfilment/i);
    expect(mocks.reserveCheckout).not.toHaveBeenCalled();
    expect(mocks.createSandboxCheckout).not.toHaveBeenCalled();
  });

  it('refuses to start a checkout when Paddle webhooks cannot be verified', async () => {
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', '');

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(mocks.reserveCheckout).not.toHaveBeenCalled();
  });

  it('clears stale reservations before reserving the next checkout', async () => {
    mocks.sweepReservations.mockResolvedValue({ expired: ['reservation-stale'], linked: [] });
    mocks.createSandboxCheckout.mockResolvedValue({
      providerOperationId: 'txn-1',
      transactionId: 'txn-1',
      checkoutUrl: 'https://checkout.paddle.com/checkout/txn-1',
      status: 'created',
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.sweepReservations).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
    }));
    expect(mocks.reserveCheckout).toHaveBeenCalledTimes(2);
  });
});
