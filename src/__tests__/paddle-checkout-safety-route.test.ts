import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  priceGet: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/billing/paddle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/billing/paddle')>();
  return {
    ...actual,
    getPaddleClient: () => ({ prices: { get: mocks.priceGet } }),
  };
});

import { POST as quotePOST } from '@/app/api/paddle/quote/route';
import { POST as checkoutPOST } from '@/app/api/paddle/checkout/route';
import { createSandboxCheckoutQuote } from '@/lib/billing/paddle';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
  mocks.priceGet.mockResolvedValue({
    id: 'pri_monthly',
    productId: 'pro_creator',
    type: 'standard',
    status: 'active',
    unitPrice: { currencyCode: 'USD', amount: '799' },
    trialPeriod: null,
    billingCycle: { interval: 'month', frequency: 1 },
    quantity: { minimum: 1, maximum: 999999 },
    taxMode: 'location',
    unitPriceOverrides: [{
      countryCodes: ['IN'],
      unitPrice: { currencyCode: 'INR', amount: '34900' },
    }],
  });
  vi.stubEnv('PADDLE_LIVE_CHECKOUT_DISABLED', 'true');
  vi.stubEnv('AUTH_SECRET', 'checkout-route-test-secret');
});

describe('Paddle checkout safety gates', () => {
  it('allows Sandbox quote requests while live checkout remains disabled', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');

    const response = await quotePOST(new Request('http://localhost/api/paddle/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-vercel-ip-country': 'US' },
      body: JSON.stringify({
        period: 'monthly',
        country: 'IN',
        amount: 1,
        currency: 'INR',
        priceId: 'client-controlled-price',
      }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      country: 'US',
      amount: 7.99,
      currency: 'USD',
    });
  });

  it('rejects client amount, currency and trusted-country mismatches before reserving checkout', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    const quote = await createSandboxCheckoutQuote({
      prices: { get: mocks.priceGet },
    } as unknown as import('@paddle/paddle-node-sdk').Paddle, 'creator_monthly', 'IN');
    const consent = {
      plan: 'creator_monthly',
      period: 'monthly',
      amount: quote.amount,
      currency: quote.currency,
      consentVersion: '2',
      quoteToken: quote.quoteToken,
      consentHash: 'a'.repeat(64),
    };
    const post = (body: Record<string, unknown>, country = 'IN') =>
      checkoutPOST(new NextRequest('http://localhost/api/paddle/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-vercel-ip-country': country,
        },
        body: JSON.stringify(body),
      }));

    expect((await post({ ...consent, amount: 350 })).status).toBe(409);
    expect((await post({ ...consent, currency: 'USD' })).status).toBe(409);
    expect((await post(consent, 'US')).status).toBe(409);
  });

  it('passes Sandbox checkout consent validation instead of the live-disable 503', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');

    const response = await checkoutPOST(new NextRequest('http://localhost/api/paddle/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'creator_monthly' }),
    }));

    expect(response.status).toBe(400);
  });

  it('rejects oversized checkout bodies without creating a reservation', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');

    const response = await checkoutPOST(new NextRequest('http://localhost/api/paddle/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'creator_monthly', padding: 'x'.repeat(9_000) }),
    }));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: 'Checkout request is too large' });
  });

  it('rate limits repeated checkout attempts per user', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    mocks.auth.mockResolvedValue({ user: { id: 'user-checkout-rate-limit' } });

    const post = () => checkoutPOST(new NextRequest('http://localhost/api/paddle/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'creator_monthly' }),
    }));

    for (let attempt = 0; attempt < 20; attempt++) {
      expect((await post()).status).toBe(400);
    }
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('rate limits repeated quote requests per user', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    mocks.auth.mockResolvedValue({ user: { id: 'user-quote-rate-limit' } });

    const post = () => quotePOST(new Request('http://localhost/api/paddle/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: 'monthly' }),
    }));

    for (let attempt = 0; attempt < 60; attempt++) {
      expect((await post()).status).toBe(200);
    }
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toMatch(/^\d+$/);
  });

  it('fails closed for live environment while the safety flag is true', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');

    const response = await quotePOST(new Request('http://localhost/api/paddle/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: 'monthly' }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'Live Paddle checkout is disabled' });
  });
});
