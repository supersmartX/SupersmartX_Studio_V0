import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The reconciler is the only thing standing between "an old order exists" and
 * "charge the buyer again". These cases pin the rules that make it safe:
 *
 *  - age decides *when* an order is abandoned, never *whether* it is released;
 *  - a payment is settled through one atomic transaction, and a claim without
 *    the order's own fulfilment marker is parked for review instead of
 *    auto-granted;
 *  - an unreadable or refused gateway answer refuses the checkout (fail closed)
 *    rather than opening a second payable order.
 */

process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';

const mocks = vi.hoisted(() => ({
  findPendingOrdersForReconcile: vi.fn(),
  findPendingOrderLifecycle: vi.fn(),
  findPendingOrderClaim: vi.fn(),
  tryClaimOrderNotification: vi.fn(),
  releaseOrderNotification: vi.fn(),
  markPendingOrderFulfilled: vi.fn(),
  markPendingOrderHeld: vi.fn(),
  markPendingOrderOpen: vi.fn(),
  markPendingOrderTerminationRequested: vi.fn(),
  closePendingOrder: vi.fn(),
  recordPendingOrderProbe: vi.fn(),
  touchPendingOrder: vi.fn(),
  fulfillPaidOrder: vi.fn(),
  sendOrderReceiptOnce: vi.fn(),
  sendBillingOpsAlert: vi.fn(),
}));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    findPendingOrdersForReconcile: mocks.findPendingOrdersForReconcile,
    findPendingOrderLifecycle: mocks.findPendingOrderLifecycle,
    findPendingOrderClaim: mocks.findPendingOrderClaim,
    tryClaimOrderNotification: mocks.tryClaimOrderNotification,
    releaseOrderNotification: mocks.releaseOrderNotification,
    markPendingOrderFulfilled: mocks.markPendingOrderFulfilled,
    markPendingOrderHeld: mocks.markPendingOrderHeld,
    markPendingOrderOpen: mocks.markPendingOrderOpen,
    markPendingOrderTerminationRequested: mocks.markPendingOrderTerminationRequested,
    closePendingOrder: mocks.closePendingOrder,
    recordPendingOrderProbe: mocks.recordPendingOrderProbe,
    touchPendingOrder: mocks.touchPendingOrder,
  };
});

vi.mock('@/lib/cashfree-fulfillment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cashfree-fulfillment')>();
  return {
    ...actual,
    fulfillPaidOrder: mocks.fulfillPaidOrder,
    sendOrderReceiptOnce: mocks.sendOrderReceiptOnce,
  };
});

vi.mock('@/lib/email', () => ({ sendBillingOpsAlert: mocks.sendBillingOpsAlert }));

import { reconcileUserCheckout, reconcileOrder, releaseHeldOrder } from '@/lib/pending-order-reconcile';
import type { PendingOrderLifecycleRow } from '@/lib/db';

const USER_ID = 'user_reconcile_1';
const CTX = { requestId: 'req-1', source: 'checkout' as const };

function row(overrides: Partial<PendingOrderLifecycleRow> = {}): PendingOrderLifecycleRow {
  return {
    orderId: 'sxs-1',
    userId: USER_ID,
    plan: 'creator_monthly',
    amount: 349,
    currency: 'INR',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    status: 'open',
    closedAt: null,
    closeReason: null,
    heldAt: null,
    holdReason: null,
    fulfilledAt: null,
    lastCheckedAt: null,
    probeCount: 0,
    firstProbedAt: null,
    terminationSentAt: null,
    ...overrides,
  };
}

function useRows(...rows: PendingOrderLifecycleRow[]) {
  mocks.findPendingOrdersForReconcile.mockResolvedValue(rows);
  mocks.findPendingOrderLifecycle.mockImplementation(
    async (orderId: string) => rows.find((candidate) => candidate.orderId === orderId) ?? null,
  );
}

type GatewayHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

function stubGateway(handler: GatewayHandler) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function orderBody(orderStatus: string, overrides: Record<string, unknown> = {}) {
  return {
    order_id: 'sxs-1',
    order_status: orderStatus,
    order_amount: 349,
    order_currency: 'INR',
    payment_session_id: 'ps-1',
    ...overrides,
  };
}

function gatewayReturns(status: string) {
  return stubGateway(() =>
    new Response(JSON.stringify(orderBody(status)), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CASHFREE_APP_ID = 'test-app-id';
  process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
  process.env.CASHFREE_ENV = 'sandbox';

  mocks.findPendingOrderClaim.mockResolvedValue({ claimed: false, entitled: false });
  mocks.tryClaimOrderNotification.mockResolvedValue(true);
  mocks.releaseOrderNotification.mockResolvedValue(undefined);
  mocks.markPendingOrderFulfilled.mockResolvedValue(true);
  mocks.markPendingOrderHeld.mockResolvedValue(true);
  mocks.markPendingOrderOpen.mockResolvedValue(true);
  mocks.markPendingOrderTerminationRequested.mockResolvedValue(true);
  mocks.closePendingOrder.mockResolvedValue(true);
  mocks.recordPendingOrderProbe.mockResolvedValue({ probeCount: 1, firstProbedAt: new Date() });
  mocks.touchPendingOrder.mockResolvedValue(undefined);
  mocks.fulfillPaidOrder.mockResolvedValue({ ok: true, state: 'fulfilled', expiresAt: new Date(Date.now() + 86_400_000) });
  mocks.sendOrderReceiptOnce.mockResolvedValue(true);
  mocks.sendBillingOpsAlert.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('reconcileUserCheckout — live orders', () => {
  it('blocks while a young ACTIVE order exists, without closing it', async () => {
    useRows(row({ status: 'open', createdAt: minutesAgo(1) }));
    stubGateway(() =>
      new Response(JSON.stringify(orderBody('ACTIVE')), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(409);
    expect(result.block.body).toMatchObject({
      code: 'pending_order_open',
      orderId: 'sxs-1',
      paymentSessionId: 'ps-1',
      amount: 349,
      currency: 'INR',
      plan: 'creator_monthly',
      status: 'ACTIVE',
    });
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
    expect(mocks.markPendingOrderHeld).not.toHaveBeenCalled();
  });

  it('terminates an abandoned ACTIVE order and releases only once Cashfree confirms', async () => {
    useRows(row({ status: 'open', createdAt: minutesAgo(16) }));
    let killed = false;
    const fetchMock = stubGateway((_url, init) => {
      if (init.method === 'PATCH') {
        killed = true;
        return new Response(JSON.stringify(orderBody('TERMINATED')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // The first read is the staleness probe; later reads are the
      // post-termination poll, which must see the order gone.
      const status = killed ? 'TERMINATED' : 'ACTIVE';
      return new Response(JSON.stringify(orderBody(status)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result).toEqual({ ok: true });
    const terminateCall = fetchMock.mock.calls.find((call) => call[1]?.method === 'PATCH');
    expect(terminateCall).toBeDefined();
    expect(JSON.parse(String(terminateCall?.[1]?.body))).toEqual({ order_status: 'TERMINATED' });
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'gateway_terminated', ['open']);
  });

  it('fails closed and alerts when Cashfree refuses the termination', async () => {
    useRows(row({ status: 'open', createdAt: minutesAgo(16) }));
    stubGateway((_url, init) =>
      init.method === 'PATCH'
        ? new Response('refused', { status: 400 })
        : new Response(JSON.stringify(orderBody('ACTIVE')), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(503);
    expect(result.block.body.code).toBe('pending_order_unconfirmed');
    // A refusal is never a licence to create a replacement.
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
    expect(mocks.sendBillingOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('keeps blocking while a termination is accepted but unconfirmed', async () => {
    useRows(row({ status: 'open', createdAt: minutesAgo(16) }));
    stubGateway((_url, init) =>
      new Response(JSON.stringify(orderBody(init.method === 'PATCH' ? 'TERMINATION_REQUESTED' : 'ACTIVE')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(409);
    expect(result.block.body).toMatchObject({ code: 'pending_order_terminating', retryAfterSeconds: 45 });
    expect(mocks.markPendingOrderTerminationRequested).toHaveBeenCalledWith('sxs-1');
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('continues to block a terminal-requested order until it is really terminal', async () => {
    useRows(row({ status: 'termination_requested', terminationSentAt: minutesAgo(2) }));
    gatewayReturns('ACTIVE');

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('pending_order_terminating');
  });

  it('closes a termination_requested order once Cashfree says TERMINATED', async () => {
    useRows(row({ status: 'termination_requested', terminationSentAt: minutesAgo(2) }));
    gatewayReturns('TERMINATED');

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'gateway_terminated', [
      'termination_requested',
    ]);
  });

  it('closes an EXPIRED order without touching the entitlement', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('EXPIRED');

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'gateway_expired', ['open']);
    expect(mocks.fulfillPaidOrder).not.toHaveBeenCalled();
  });

  it('refuses new checkout when a created order is missing from the gateway', async () => {
    useRows(row({ status: 'open' }));
    stubGateway(() => new Response('', { status: 404 }));

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('pending_order_unconfirmed');
    // A 404 for an order we recorded a create for contradicts the record.
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('refuses new checkout on an unrecognised order_status', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('FAILED');

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('pending_order_unconfirmed');
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });
});

describe('reconcileUserCheckout — reservations with unknown create outcomes', () => {
  it('does not probe a reservation that is still inside the grace window', async () => {
    useRows(row({ status: 'creating', createdAt: minutesAgo(0.5) }));
    const fetchMock = stubGateway(() => new Response('', { status: 200 }));

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('pending_order_creating');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the reservation after a single 404', async () => {
    useRows(row({ status: 'creating', createdAt: minutesAgo(3) }));
    stubGateway(() => new Response('', { status: 404 }));
    mocks.recordPendingOrderProbe.mockResolvedValue({ probeCount: 1, firstProbedAt: new Date() });

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('pending_order_creating');
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('releases an orphan only after three spaced, confirmed 404s', async () => {
    useRows(row({ status: 'creating', createdAt: minutesAgo(3) }));
    stubGateway(() => new Response('', { status: 404 }));
    mocks.recordPendingOrderProbe.mockResolvedValue({
      probeCount: 3,
      firstProbedAt: new Date(Date.now() - 31_000),
    });

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'orphaned_no_gateway_record', [
      'creating',
      'unverified',
    ]);
  });

  it('adopts a reservation whose create actually landed, and blocks a second checkout', async () => {
    useRows(row({ status: 'creating', createdAt: minutesAgo(3) }));
    gatewayReturns('ACTIVE');

    // Adoption only repairs the local row: the gateway order is live, so this
    // attempt must be told to resume it rather than create a second payable one.
    const result = await reconcileUserCheckout(USER_ID, CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(409);
    expect(result.block.body).toMatchObject({ code: 'pending_order_open', orderId: 'sxs-1' });
    expect(mocks.markPendingOrderOpen).toHaveBeenCalledWith('sxs-1');
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('settles a reservation that landed as PAID instead of adopting it as open', async () => {
    useRows(row({ status: 'creating', createdAt: minutesAgo(3) }));
    gatewayReturns('PAID');

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.fulfillPaidOrder).toHaveBeenCalledTimes(1);
    expect(mocks.markPendingOrderOpen).not.toHaveBeenCalled();
    // The settlement transaction writes the marker itself; the reconciler does
    // not re-mark the row afterwards.
    expect(mocks.markPendingOrderFulfilled).not.toHaveBeenCalled();
    expect(mocks.sendOrderReceiptOnce).toHaveBeenCalledTimes(1);
  });

  it('closes a historical row it terminates under the status the row really has', async () => {
    useRows(row({ status: 'unverified', createdAt: minutesAgo(600) }));
    let killed = false;
    stubGateway((_url, init) => {
      if (init.method === 'PATCH') {
        killed = true;
        return new Response(JSON.stringify(orderBody('TERMINATED')), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const status = killed ? 'TERMINATED' : 'ACTIVE';
      return new Response(JSON.stringify(orderBody(status)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    // A close scoped to `open` would match no row here and leave the historical
    // order permanently unclassified while the gateway has already killed it.
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'gateway_terminated', [
      'unverified',
    ]);
  });

  it('requires the same evidence for a historical unverified row', async () => {
    useRows(row({ status: 'unverified', createdAt: minutesAgo(600) }));
    stubGateway(() => new Response('', { status: 404 }));
    mocks.recordPendingOrderProbe.mockResolvedValue({
      probeCount: 3,
      firstProbedAt: new Date(Date.now() - 31_000),
    });

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'orphaned_no_gateway_record', [
      'creating',
      'unverified',
    ]);
  });
});

describe('reconcileUserCheckout — settlement and holds', () => {
  it('settles a paid order through the one fulfilment transaction', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('PAID');

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.fulfillPaidOrder).toHaveBeenCalledTimes(1);
    expect(mocks.fulfillPaidOrder).toHaveBeenCalledWith(
      { orderId: 'sxs-1', userId: USER_ID, plan: 'creator_monthly', amount: 349, currency: 'INR' },
      expect.objectContaining({ order_id: 'sxs-1', order_status: 'PAID' }),
    );
    // Claim, grant and marker are no longer three reconciler steps.
    expect(mocks.markPendingOrderFulfilled).not.toHaveBeenCalled();
    expect(mocks.sendOrderReceiptOnce).toHaveBeenCalledTimes(1);
  });

  it('reports an order another path already fulfilled without granting a second term', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('PAID');
    // The settlement found the claim and its marker committed by the webhook.
    mocks.fulfillPaidOrder.mockResolvedValue({
      ok: true,
      state: 'already_fulfilled',
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    // The transaction decides; the reconciler neither re-marks nor re-grants.
    expect(mocks.fulfillPaidOrder).toHaveBeenCalledTimes(1);
    expect(mocks.markPendingOrderFulfilled).not.toHaveBeenCalled();
  });

  it('parks a claimed-but-unentitled order for review instead of granting it', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('PAID');
    // The settlement found a claim whose grant/marker never committed.
    mocks.fulfillPaidOrder.mockResolvedValue({ ok: false, state: 'in_progress' });

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(409);
    expect(result.block.body).toMatchObject({
      code: 'paid_order_pending_review',
      status: 'PAID',
      retryAfterSeconds: 300,
      supportReference: 'sxs-1',
    });
    expect(mocks.markPendingOrderHeld).toHaveBeenCalledWith('sxs-1', 'claim_unentitled');
    expect(mocks.sendBillingOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('holds the order when fulfilment rejects it, with no claim left to release', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('PAID');
    mocks.fulfillPaidOrder.mockResolvedValue({
      ok: false,
      state: 'rejected',
      reason: 'amount_mismatch',
      expected: 349,
      received: 1,
    });

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('paid_order_pending_review');
    expect(mocks.markPendingOrderHeld).toHaveBeenCalledWith('sxs-1', 'fulfilment_rejected');
    expect(mocks.sendBillingOpsAlert).toHaveBeenCalledTimes(1);
  });

  it('holds the order when the settlement transaction throws, with nothing left behind', async () => {
    useRows(row({ status: 'open' }));
    gatewayReturns('PAID');
    mocks.fulfillPaidOrder.mockRejectedValue(new Error('db down'));

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('paid_order_pending_review');
    expect(mocks.markPendingOrderHeld).toHaveBeenCalledWith('sxs-1', 'fulfilment_failed');
  });

  it('voids a hold only on a gateway-confirmed unpaid terminal state', async () => {
    useRows(row({ status: 'held_review', holdReason: 'fulfilment_rejected' }));
    gatewayReturns('EXPIRED');

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.closePendingOrder).toHaveBeenCalledWith('sxs-1', 'hold_void_unpaid', ['held_review']);
  });

  it('keeps a hold while the order is still active at the gateway', async () => {
    useRows(row({ status: 'held_review', holdReason: 'fulfilment_rejected' }));
    gatewayReturns('ACTIVE');

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('paid_order_pending_review');
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('self-heals a claim_unentitled hold once the entitlement corroborates the claim', async () => {
    useRows(row({ status: 'held_review', holdReason: 'claim_unentitled' }));
    mocks.findPendingOrderClaim.mockResolvedValue({ claimed: true, entitled: true });

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.markPendingOrderFulfilled).toHaveBeenCalledWith('sxs-1');
    expect(mocks.closePendingOrder).not.toHaveBeenCalled();
  });

  it('settles a held order that turns out to be paid', async () => {
    useRows(row({ status: 'held_review', holdReason: 'fulfilment_failed' }));
    gatewayReturns('PAID');

    expect(await reconcileUserCheckout(USER_ID, CTX)).toEqual({ ok: true });
    expect(mocks.fulfillPaidOrder).toHaveBeenCalledTimes(1);
  });
});

describe('reconcileUserCheckout — pass-level safety', () => {
  it('refuses when there is more reconcilable history than one pass handles', async () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      row({ orderId: `sxs-${index}`, status: 'closed' }),
    );
    useRows(...rows);
    const fetchMock = stubGateway(() => new Response('', { status: 500 }));

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(503);
    expect(result.block.body.code).toBe('reconciliation_incomplete');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when a reconciliation step throws', async () => {
    useRows(row({ status: 'open' }));
    mocks.findPendingOrderLifecycle.mockRejectedValue(new Error('connection lost'));

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.httpStatus).toBe(503);
    expect(result.block.body.code).toBe('pending_order_unconfirmed');
  });

  it('reports a live order in preference to a later hold', async () => {
    useRows(
      row({ orderId: 'sxs-held', status: 'held_review', holdReason: 'fulfilment_failed', createdAt: minutesAgo(30) }),
      row({ orderId: 'sxs-live', status: 'open', createdAt: minutesAgo(1) }),
    );
    stubGateway((url) =>
      new Response(JSON.stringify(orderBody(url.endsWith('sxs-live') ? 'ACTIVE' : 'PAID')), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    mocks.findPendingOrderClaim.mockResolvedValue({ claimed: false, entitled: false });

    const result = await reconcileUserCheckout(USER_ID, CTX);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.block.body.code).toBe('pending_order_open');
    expect(result.block.body.orderId).toBe('sxs-live');
  });
});

describe('reconcileOrder', () => {
  it('returns null for an order it cannot find', async () => {
    mocks.findPendingOrderLifecycle.mockResolvedValue(null);
    expect(await reconcileOrder('sxs-missing', CTX)).toBeNull();
  });

  it('does nothing to a settled row', async () => {
    mocks.findPendingOrderLifecycle.mockResolvedValue(row({ status: 'fulfilled' }));
    const fetchMock = stubGateway(() => new Response('', { status: 200 }));

    const outcome = await reconcileOrder('sxs-1', CTX);

    expect(outcome?.state).toBe('fulfilled');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('releaseHeldOrder — the operator is not exempt from exactly-once', () => {
  const OPS_CTX = { requestId: 'req-ops', source: 'ops' as const };

  it('does not write a second term for an order another path already fulfilled', async () => {
    useRows(row({ status: 'held_review', holdReason: 'fulfilment_failed' }));
    gatewayReturns('PAID');
    // The claim and the evidence it produced are both present: the webhook (or
    // a return trip) granted the term, and only the status write is missing.
    mocks.findPendingOrderClaim.mockResolvedValue({ claimed: true, entitled: true });

    const result = await releaseHeldOrder({
      orderId: 'sxs-1',
      resolution: 'fulfilled_manually',
      ctx: OPS_CTX,
    });

    expect(result).toEqual({ ok: true, orderId: 'sxs-1', status: 'fulfilled' });
    expect(mocks.fulfillPaidOrder).not.toHaveBeenCalled();
    expect(mocks.markPendingOrderFulfilled).toHaveBeenCalledWith('sxs-1');
  });

  it('refuses to grant a claimed order whose entitlement never landed', async () => {
    useRows(row({ status: 'held_review', holdReason: 'claim_unentitled' }));
    gatewayReturns('PAID');
    mocks.findPendingOrderClaim.mockResolvedValue({ claimed: true, entitled: false });

    const result = await releaseHeldOrder({
      orderId: 'sxs-1',
      resolution: 'fulfilled_manually',
      ctx: OPS_CTX,
    });

    expect(result).toMatchObject({ ok: false, error: 'claim_unentitled' });
    expect(mocks.fulfillPaidOrder).not.toHaveBeenCalled();
    expect(mocks.markPendingOrderFulfilled).not.toHaveBeenCalled();
  });

  it('returns a rejection without releasing anything, because the transaction rolled back', async () => {
    useRows(row({ status: 'held_review', holdReason: 'fulfilment_failed' }));
    gatewayReturns('PAID');
    mocks.findPendingOrderClaim.mockResolvedValue({ claimed: false, entitled: false });
    mocks.fulfillPaidOrder.mockResolvedValue({
      ok: false,
      state: 'rejected',
      reason: 'amount_mismatch',
      expected: 349,
      received: 1,
    });

    const result = await releaseHeldOrder({
      orderId: 'sxs-1',
      resolution: 'fulfilled_manually',
      ctx: OPS_CTX,
    });

    expect(result).toMatchObject({ ok: false, error: 'fulfilment_amount_mismatch' });
    // A rejection never claims, so there is nothing to release or mark.
    expect(mocks.markPendingOrderFulfilled).not.toHaveBeenCalled();
  });

  it('propagates a failed settlement without releasing anything', async () => {
    useRows(row({ status: 'held_review', holdReason: 'fulfilment_failed' }));
    gatewayReturns('PAID');
    mocks.findPendingOrderClaim.mockResolvedValue({ claimed: false, entitled: false });
    mocks.fulfillPaidOrder.mockRejectedValue(new Error('db down'));

    // The settlement transaction rolled back atomically: the order keeps its
    // hold and remains releasable once the database is healthy again.
    await expect(
      releaseHeldOrder({ orderId: 'sxs-1', resolution: 'fulfilled_manually', ctx: OPS_CTX }),
    ).rejects.toThrow('db down');
    expect(mocks.markPendingOrderFulfilled).not.toHaveBeenCalled();
  });
});
