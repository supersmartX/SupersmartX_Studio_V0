import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  reserveCheckout: vi.fn(),
  updateReservation: vi.fn(),
  createSandboxCheckout: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => ({ billingReservation: { update: mocks.updateReservation } }),
}));
vi.mock('@/lib/billing/operations', () => ({
  ActiveBillingSubscriptionError: class ActiveBillingSubscriptionError extends Error {},
  hashCheckoutConsent: () => 'consent-hash',
  reserveCheckout: mocks.reserveCheckout,
}));
vi.mock('@/lib/billing/paddle', () => ({
  assertSandboxPriceMatches: vi.fn().mockResolvedValue({ id: 'pri-1', productId: 'pro-1' }),
  getPaddleClient: () => ({}),
  getPaddleEnvironment: () => 'sandbox',
  getTrustedPaddleCountry: () => 'IN',
  isPaddleCheckoutEnabled: () => true,
  isSafePaddleCheckoutUrl: () => true,
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
  consentHash: 'consent-hash',
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
  mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
  mocks.reserveCheckout.mockResolvedValue(undefined);
  mocks.updateReservation.mockResolvedValue(undefined);
});

describe('Paddle checkout persistence recovery', () => {
  it('returns the reservation ID when provider creation is uncertain and recording that uncertainty fails', async () => {
    mocks.createSandboxCheckout.mockRejectedValue(new Error('provider timeout'));
    mocks.updateReservation.mockRejectedValue(new Error('database unavailable'));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.reservationId).toEqual(expect.any(String));
    expect(body.error).toMatch(/check its status/i);
    expect(mocks.reserveCheckout).toHaveBeenCalledTimes(1);
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
});
