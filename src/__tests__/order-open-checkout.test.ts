import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The checkout route is now a reservation protocol, not a create-then-record:
 *
 *   lock → reconcile → reserve → create → open → release
 *
 * These cases pin the two properties that make that ordering safe — nothing is
 * sent to Cashfree before its order id exists in the database, and a create
 * whose outcome is unknown is never retried with a replacement order — plus the
 * exit paths (blocked reconciliation, definite rejection, contention) and the
 * unconditional lock release.
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
    // The real error class is kept so the route's `instanceof` check means
    // something; only the I/O is replaced.
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
import { PendingOrderConflictError } from '@/lib/db';

const USER_ID = 'user_checkout_1';

function orderRequest() {
  return new NextRequest('http://localhost/api/cashfree/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      plan: 'creator_monthly',
      country: 'IN',
      currency: 'INR',
      name: 'Buyer',
      email: 'buyer@example.test',
      phone: '+919999999999',
    }),
  });
}

function stubCreate(echoOrderId?: string) {
  // Cashfree echoes the `order_id` it was created with; passing a value here
  // simulates the anomalous case where the echo disagrees with the reservation.
  const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) => {
    const sent = JSON.parse(String(_init?.body ?? '{}')) as { order_id?: string };
    const orderId = echoOrderId ?? sent.order_id ?? 'sxs-any';
    return new Response(
      JSON.stringify({ order_id: orderId, order_status: 'ACTIVE', payment_session_id: 'ps-created' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function createdPayload(fetchMock: ReturnType<typeof stubCreate>) {
  const init = fetchMock.mock.calls[0]?.[1] as { body?: string } | undefined;
  return JSON.parse(String(init?.body ?? '{}'));
}

function block(httpStatus: 409 | 503, code: string) {
  return {
    ok: false,
    block: {
      httpStatus,
      body: {
        error: 'An earlier checkout is still open.',
        code,
        retryAfterSeconds: 60,
        orderId: 'sxs-open-1',
        paymentSessionId: 'ps-open-1',
        amount: 349,
        currency: 'INR',
        plan: 'creator_monthly',
        status: 'ACTIVE',
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CASHFREE_APP_ID = 'test-app-id';
  process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
  process.env.CASHFREE_ENV = 'sandbox';
  process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';
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

describe('POST /api/cashfree/order — reserve before create', () => {
  it('reserves the order id under the per-user lock before calling Cashfree', async () => {
    const fetchMock = stubCreate();

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(200);
    expect(mocks.acquireCheckoutLock).toHaveBeenCalledWith(USER_ID, expect.any(String), 60_000);
    expect(mocks.reconcileUserCheckout).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ source: 'checkout' }),
    );

    const reserved = mocks.reservePendingOrder.mock.calls[0][0];
    expect(reserved).toMatchObject({
      userId: USER_ID,
      plan: 'creator_monthly',
      amount: 349,
      currency: 'INR',
    });
    expect(reserved.orderId).toMatch(/^sxs-creator_monthly-/);

    // The same id is what the gateway sees: that equality is what makes a
    // crashed create probeable instead of unknowable.
    expect(createdPayload(fetchMock).order_id).toBe(reserved.orderId);
    expect(mocks.reservePendingOrder.mock.invocationCallOrder[0]).toBeLessThan(
      fetchMock.mock.invocationCallOrder[0],
    );

    expect(mocks.markPendingOrderOpen).toHaveBeenCalledWith(reserved.orderId);

    const body = await res.json();
    expect(body).toMatchObject({
      orderId: reserved.orderId,
      paymentSessionId: 'ps-created',
      amount: 349,
      currency: 'INR',
      country: 'IN',
    });
  });

  it('releases the lock after a successful order and after every refusal', async () => {
    stubCreate();
    await orderPOST(orderRequest());
    expect(mocks.releaseCheckoutLock).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.acquireCheckoutLock.mockResolvedValue(true);
    mocks.findUserById.mockResolvedValue({ id: USER_ID, email: 'buyer@example.test', plan: 'free' });
    mocks.releaseCheckoutLock.mockResolvedValue(undefined);
    mocks.reconcileUserCheckout.mockResolvedValue(block(409, 'pending_order_open'));

    await orderPOST(orderRequest());
    expect(mocks.releaseCheckoutLock).toHaveBeenCalledTimes(1);
  });

  it('releases the lock even when reconciliation throws', async () => {
    mocks.reconcileUserCheckout.mockRejectedValue(new Error('db down'));

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(500);
    expect(mocks.releaseCheckoutLock).toHaveBeenCalledTimes(1);
    expect(mocks.reservePendingOrder).not.toHaveBeenCalled();
  });

  it('creates nothing when reconciliation refuses', async () => {
    const fetchMock = stubCreate();
    mocks.reconcileUserCheckout.mockResolvedValue(block(409, 'pending_order_open'));

    const res = await orderPOST(orderRequest());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toMatchObject({
      code: 'pending_order_open',
      orderId: 'sxs-open-1',
      paymentSessionId: 'ps-open-1',
      amount: 349,
      currency: 'INR',
      retryAfterSeconds: 60,
    });
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.reservePendingOrder).not.toHaveBeenCalled();
  });

  it('passes a held-order refusal through without weakening it', async () => {
    stubCreate();
    const held = block(409, 'paid_order_pending_review');
    held.block.body.status = 'PAID';
    held.block.body.retryAfterSeconds = 300;
    mocks.reconcileUserCheckout.mockResolvedValue(held);

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'paid_order_pending_review',
      status: 'PAID',
      orderId: 'sxs-open-1',
    });
    expect(mocks.reservePendingOrder).not.toHaveBeenCalled();
  });
});

describe('POST /api/cashfree/order — create outcomes', () => {
  it('closes the reservation when Cashfree definitely rejects the request', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ message: 'customer_phone is invalid' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    const res = await orderPOST(orderRequest());
    const reserved = mocks.reservePendingOrder.mock.calls[0][0];

    expect(res.status).toBe(400);
    expect(mocks.closePendingOrder).toHaveBeenCalledWith(
      reserved.orderId,
      'gateway_rejected_create',
      ['creating'],
    );
    expect(mocks.markPendingOrderOpen).not.toHaveBeenCalled();
  });

  it('keeps the reservation when the create outcome is unknown, and creates no replacement', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await orderPOST(orderRequest());
    const reserved = mocks.reservePendingOrder.mock.calls[0][0];

    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The row stays `creating`: its id is the handle the orphan probe resolves.
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
    expect(mocks.markPendingOrderOpen).not.toHaveBeenCalled();
    expect(mocks.reservePendingOrder).toHaveBeenCalledTimes(1);
    expect(reserved.orderId).toBeTruthy();
  });

  it('treats a 5xx create as unknown rather than a rejection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream failed', { status: 502 })),
    );

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(503);
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('reports contention when the unique index rejects the reservation', async () => {
    const fetchMock = stubCreate();
    mocks.reservePendingOrder.mockRejectedValue(new PendingOrderConflictError());

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'checkout_in_progress' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports contention when another request holds the checkout lock', async () => {
    const fetchMock = stubCreate();
    mocks.acquireCheckoutLock.mockResolvedValue(false);

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'checkout_in_progress' });
    expect(mocks.reconcileUserCheckout).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing was acquired, so nothing is released.
    expect(mocks.releaseCheckoutLock).not.toHaveBeenCalled();
  });

  it('still returns the session when the row was settled before the open write', async () => {
    stubCreate();
    mocks.markPendingOrderOpen.mockResolvedValue(false);

    const res = await orderPOST(orderRequest());

    expect(res.status).toBe(200);
    const reserved = mocks.reservePendingOrder.mock.calls[0][0];
    expect(await res.json()).toMatchObject({
      orderId: reserved.orderId,
      paymentSessionId: 'ps-created',
    });
  });
});
