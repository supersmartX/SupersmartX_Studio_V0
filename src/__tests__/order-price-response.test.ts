import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The browser's region comes from a third-party IP lookup with a week-long
 * cache; the server's comes from the platform geo header. The order response
 * therefore has to carry the amount and currency Cashfree was actually given,
 * so the checkout sheet can refuse to charge a price the customer never saw.
 *
 * These cases pin that contract — including the two ways the two sides
 * legitimately disagree (a VPN, an unknown country) — without a database.
 */

process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';
process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUserById: vi.fn(),
  findUserByEmail: vi.fn(),
  ensureOAuthUser: vi.fn(),
  acquireCheckoutLock: vi.fn(),
  releaseCheckoutLock: vi.fn(),
  reservePendingOrder: vi.fn(),
  markPendingOrderOpen: vi.fn(),
  closePendingOrder: vi.fn(),
  reconcileUserCheckout: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth, findUserByEmail: mocks.findUserByEmail }));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    findUserById: mocks.findUserById,
    findUserByEmail: mocks.findUserByEmail,
    ensureOAuthUser: mocks.ensureOAuthUser,
    acquireCheckoutLock: mocks.acquireCheckoutLock,
    releaseCheckoutLock: mocks.releaseCheckoutLock,
    reservePendingOrder: mocks.reservePendingOrder,
    markPendingOrderOpen: mocks.markPendingOrderOpen,
    closePendingOrder: mocks.closePendingOrder,
  };
});

vi.mock('@/lib/pending-order-reconcile', () => ({
  reconcileUserCheckout: mocks.reconcileUserCheckout,
}));

import { POST as orderPOST } from '@/app/api/cashfree/order/route';

const USER_ID = 'user_price_1';

function orderRequest(opts: {
  plan?: string;
  country?: string;
  currency?: string;
  headers?: Record<string, string>;
} = {}) {
  return new NextRequest('http://localhost/api/cashfree/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
    body: JSON.stringify({
      plan: opts.plan ?? 'creator_monthly',
      country: opts.country,
      currency: opts.currency,
      name: 'Buyer',
      email: 'buyer@example.test',
      phone: '+919999999999',
    }),
  });
}

function stubCashfreeOrder() {
  const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) =>
    new Response(
      JSON.stringify({ order_id: 'sxs-created', order_status: 'ACTIVE', payment_session_id: 'ps-created' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The amount/currency actually sent to Cashfree for this request. */
function chargedAmount(fetchMock: ReturnType<typeof stubCashfreeOrder>) {
  const init = fetchMock.mock.calls[0]?.[1];
  const payload = JSON.parse(String(init?.body ?? '{}'));
  return { amount: payload.order_amount, currency: payload.order_currency };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CASHFREE_APP_ID = 'test-app-id';
  process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
  process.env.CASHFREE_ENV = 'sandbox';
  process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';
  // The route's per-IP limiter lives on globalThis and survives between files.
  const g = globalThis as unknown as { __rateLimitMap?: Map<string, unknown> };
  g.__rateLimitMap?.clear();

  mocks.auth.mockResolvedValue({ user: { id: USER_ID } });
  mocks.findUserById.mockResolvedValue({ id: USER_ID, email: 'buyer@example.test', plan: 'free' });
  mocks.findUserByEmail.mockResolvedValue(undefined);
  mocks.ensureOAuthUser.mockResolvedValue(undefined);
  mocks.acquireCheckoutLock.mockResolvedValue(true);
  mocks.releaseCheckoutLock.mockResolvedValue(undefined);
  mocks.reservePendingOrder.mockResolvedValue(undefined);
  mocks.markPendingOrderOpen.mockResolvedValue(true);
  mocks.closePendingOrder.mockResolvedValue(true);
  mocks.reconcileUserCheckout.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/cashfree/order — authoritative amount and currency', () => {
  it('reports the price it charged for the client’s region (dev fallback)', async () => {
    const fetchMock = stubCashfreeOrder();

    const res = await orderPOST(orderRequest({ country: 'IN', currency: 'INR' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amount: 349, currency: 'INR', country: 'IN' });
    expect(chargedAmount(fetchMock)).toEqual({ amount: 349, currency: 'INR' });
    expect(mocks.reservePendingOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 349,
        currency: 'INR',
        plan: 'creator_monthly',
        orderId: expect.stringMatching(/^sxs-creator_monthly-/),
      }),
    );
  });

  it('reports the default region for a country it cannot place', async () => {
    const fetchMock = stubCashfreeOrder();

    const res = await orderPOST(orderRequest({ country: 'ZZ', currency: 'USD' }));

    expect(res.status).toBe(200);
    // No usable region on either side → the server's default table prices it,
    // and the response says so, so a US-quoting sheet sees no discrepancy.
    expect(await res.json()).toMatchObject({ amount: 7.99, currency: 'USD', country: null });
    expect(chargedAmount(fetchMock)).toEqual({ amount: 7.99, currency: 'USD' });
  });

  it('reports the geo header’s price over a contradictory client region (VPN / location disagreement)', async () => {
    const fetchMock = stubCashfreeOrder();
    vi.stubEnv('NODE_ENV', 'production');

    const res = await orderPOST(
      orderRequest({
        country: 'US',
        currency: 'USD',
        headers: { 'x-vercel-ip-country': 'IN' },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amount: 349, currency: 'INR', country: 'IN' });
    expect(chargedAmount(fetchMock)).toEqual({ amount: 349, currency: 'INR' });
  });

  it('reports the default region in production when no geo header is present', async () => {
    const fetchMock = stubCashfreeOrder();
    vi.stubEnv('NODE_ENV', 'production');

    // The sheet resolved INR because its own lookup found India; production
    // ignores a client-supplied region, so the response must say USD.
    const res = await orderPOST(orderRequest({ country: 'IN', currency: 'INR' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amount: 7.99, currency: 'USD', country: null });
    expect(chargedAmount(fetchMock)).toEqual({ amount: 7.99, currency: 'USD' });
  });

  it('reports the annual price for the resolved region', async () => {
    const fetchMock = stubCashfreeOrder();
    vi.stubEnv('NODE_ENV', 'production');

    const res = await orderPOST(
      orderRequest({
        plan: 'creator_yearly',
        headers: { 'cf-ipcountry': 'DE' },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ amount: 54.99, currency: 'EUR', country: 'DE' });
    expect(chargedAmount(fetchMock)).toEqual({ amount: 54.99, currency: 'EUR' });
  });
});
