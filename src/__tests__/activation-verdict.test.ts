/* Activation is decided by one thing: the answering order's own fulfilment
 * record.
 *
 * This suite pins the server half of W8. The data layer is mocked so the
 * contract can be exercised without a database — the database-backed half lives
 * in payment-fulfillment.test.ts.
 *
 * The failure this closes: a renewal starts from a session that already reads
 * `creator_*`, so a client (or a verification path) that treats the session as
 * proof of payment confirms purchases that never happened. `verify` therefore
 * reports the plan and expiry of the order it was asked about, and reports
 * `activated` from its own record before ever touching Cashfree — otherwise a
 * settled order would depend on the gateway being reachable.
 *
 * A settlement *claim* is not that record. Claim, grant and the order's
 * `fulfilled_at` marker commit together, so a claim with no marker is the crash
 * window: it is answered `pending`, never `activated`, and never emails a
 * receipt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';
process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';

const h = vi.hoisted(() => {
  const day = 86_400_000;
  return {
    /** A live entitlement the account already holds (the renewal case). */
    heldUntil: new Date(Date.now() + 30 * day).toISOString(),
    /** The expiry the settlement transaction stores for the purchased term. */
    grantedUntil: new Date(Date.now() + 365 * day).toISOString(),
    /** Does the order carry a committed fulfilment marker? */
    fulfilled: false,
    /** Does the order carry a claim row with no marker (the crash window)? */
    claimOnly: false,
    /** Would this caller win the settlement claim? */
    claimWon: true,
    /** Forces the settlement's mid-flight answer, for the concurrent-writer race. */
    settlement: null as null | 'claim_without_grant',
    /** Would the receipt claim be won? */
    notifyWon: true,
    owner: {} as Record<string, unknown>,
  };
});

const HELD_UNTIL = h.heldUntil;
const GRANTED_UNTIL = h.grantedUntil;

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => ({ user: { id: 'user_1', email: 'buyer@example.com' } })),
}));

vi.mock('@/lib/db', () => ({
  findPendingOrder: vi.fn(async (orderId: string) => ({
    orderId,
    userId: 'user_1',
    plan: 'creator_monthly',
    amount: 349,
    currency: 'INR',
  })),
  findUserById: vi.fn(async () => h.owner),
  // Exact-marker evidence: a marker can only exist with its claim, and the
  // claim alone is not proof of a grant.
  findPendingOrderClaim: vi.fn(async () => ({
    claimed: h.fulfilled || h.claimOnly,
    entitled: h.fulfilled,
  })),
  settleFulfilledOrder: vi.fn(async () => {
    if (h.settlement === 'claim_without_grant') return { state: 'claim_without_grant' as const };
    if (h.fulfilled) {
      return {
        state: 'already_fulfilled' as const,
        expiresAt: (h.owner.planExpiresAt as string | undefined) ?? null,
        fulfilledAt: new Date().toISOString(),
      };
    }
    if (!h.claimWon) {
      // A concurrent delivery committed between this caller's read and write.
      h.fulfilled = true;
      return {
        state: 'already_fulfilled' as const,
        expiresAt: (h.owner.planExpiresAt as string | undefined) ?? null,
        fulfilledAt: new Date().toISOString(),
      };
    }
    h.fulfilled = true;
    h.owner = { ...h.owner, planExpiresAt: h.grantedUntil };
    return { state: 'fulfilled' as const, expiresAt: h.grantedUntil, fulfilledAt: new Date().toISOString() };
  }),
  tryClaimOrderNotification: vi.fn(async () => h.notifyWon),
  releaseOrderNotification: vi.fn(async () => {}),
}));

vi.mock('@/lib/email', () => ({
  sendPaymentConfirmationEmail: vi.fn(async () => true),
  sendAdminNotification: vi.fn(async () => true),
}));

import { POST as verifyPOST } from '@/app/api/cashfree/verify/route';
import { sendPaymentConfirmationEmail } from '@/lib/email';
import { settleFulfilledOrder } from '@/lib/db';

const ORDER = 'order_verdict_1';

function verifyRequest(orderId = ORDER, extra = '') {
  return new NextRequest(
    `http://localhost/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}${extra}`,
    { method: 'POST' },
  );
}

/** Cashfree's read of the order, as fetchCashfreeOrder consumes it. */
function cashfreeOrder(body: Record<string, unknown>) {
  const spy = vi.fn(async () => ({ ok: true, json: async () => body }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

beforeEach(() => {
  h.fulfilled = false;
  h.claimOnly = false;
  h.claimWon = true;
  h.settlement = null;
  h.notifyWon = true;
  h.owner = {
    id: 'user_1',
    email: 'buyer@example.com',
    name: 'Buyer',
    plan: 'creator_monthly',
    planExpiresAt: h.heldUntil,
  };
  vi.mocked(settleFulfilledOrder).mockClear();
  vi.mocked(sendPaymentConfirmationEmail).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('an already-fulfilled order is answered from its own record', () => {
  it('reports activated without asking Cashfree', async () => {
    h.fulfilled = true;
    const fetchSpy = vi.fn(async () => {
      throw new Error('Cashfree unreachable');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await verifyPOST(verifyRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'activated',
      orderId: ORDER,
      plan: 'creator_monthly',
      expiresAt: HELD_UNTIL,
    });
    // The whole point: a settled order does not depend on the gateway.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(settleFulfilledOrder).not.toHaveBeenCalled();
  });

  it('still sends the receipt, at most once, from stored facts', async () => {
    h.fulfilled = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Cashfree unreachable');
    }));

    await verifyPOST(verifyRequest());

    expect(sendPaymentConfirmationEmail).toHaveBeenCalledTimes(1);
  });

  it('names the order plan, never the plan in the return URL', async () => {
    h.fulfilled = true;
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Cashfree unreachable');
    }));

    const res = await verifyPOST(verifyRequest(ORDER, '&payment=success&plan=creator_yearly'));
    const body = (await res.json()) as { plan?: string };
    expect(body.plan).toBe('creator_monthly');
  });
});

describe('an unfulfilled order is decided by Cashfree, and answered in the same shape', () => {
  it('fulfils a paid order and returns the expiry it stored', async () => {
    cashfreeOrder({
      order_id: ORDER,
      order_status: 'PAID',
      order_amount: 349,
      order_currency: 'INR',
    });

    const res = await verifyPOST(verifyRequest());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'activated',
      orderId: ORDER,
      plan: 'creator_monthly',
      expiresAt: GRANTED_UNTIL,
    });
  });

  it('reports a still-open order as pending, with no plan attached', async () => {
    cashfreeOrder({ order_id: ORDER, order_status: 'ACTIVE', order_amount: 349, order_currency: 'INR' });

    const res = await verifyPOST(verifyRequest());
    const body = (await res.json()) as { status?: string; plan?: string };

    expect(body.status).toBe('pending');
    expect(body.plan).toBeUndefined();
  });

  it('reports a terminal order as failed and writes nothing', async () => {
    cashfreeOrder({ order_id: ORDER, order_status: 'EXPIRED', order_amount: 349, order_currency: 'INR' });

    const res = await verifyPOST(verifyRequest());
    const body = (await res.json()) as { status?: string; plan?: string; orderStatus?: string };

    expect(body.status).toBe('failed');
    expect(body.orderStatus).toBe('EXPIRED');
    expect(body.plan).toBeUndefined();
    // Nothing is claimed, granted or marked for an order that can never pay.
    expect(settleFulfilledOrder).not.toHaveBeenCalled();
  });

  it('answers activated when another path committed first, with the stored expiry', async () => {
    h.claimWon = false;
    cashfreeOrder({ order_id: ORDER, order_status: 'PAID', order_amount: 349, order_currency: 'INR' });

    const res = await verifyPOST(verifyRequest());
    const body = (await res.json()) as { status?: string; orderId?: string; plan?: string; expiresAt?: string };

    expect(body).toMatchObject({
      status: 'activated',
      orderId: ORDER,
      plan: 'creator_monthly',
      expiresAt: HELD_UNTIL,
    });
    // The settlement told us the order was already fulfilled; the verdict is
    // still built from stored facts, not from the settlement's return value.
    expect(settleFulfilledOrder).toHaveBeenCalledTimes(1);
    // A winner that never emailed still gets the receipt from stored facts,
    // guarded by the notification claim so it cannot be sent twice.
    expect(sendPaymentConfirmationEmail).toHaveBeenCalledTimes(1);
  });
});

describe('a claim without its fulfilment marker is never an activation', () => {
  it('answers pending from the record, without asking Cashfree or sending a receipt', async () => {
    h.claimOnly = true;
    const fetchSpy = vi.fn(async () => {
      throw new Error('Cashfree unreachable');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await verifyPOST(verifyRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'pending', orderStatus: 'ACTIVE' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(sendPaymentConfirmationEmail).not.toHaveBeenCalled();
  });

  it('answers pending when the claim appears between the read and the settlement', async () => {
    h.settlement = 'claim_without_grant';
    cashfreeOrder({ order_id: ORDER, order_status: 'PAID', order_amount: 349, order_currency: 'INR' });

    const res = await verifyPOST(verifyRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'pending', orderStatus: 'ACTIVE' });
    expect(sendPaymentConfirmationEmail).not.toHaveBeenCalled();
  });

  it('answers pending for a fulfilled order whose entitlement is no longer live', async () => {
    // Fulfilled history with a revoked or lapsed grant (a refund, say) is not a
    // live activation, and the receipt must not claim access that is gone.
    h.fulfilled = true;
    h.owner = { ...h.owner, plan: 'free', planExpiresAt: null };
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('Cashfree unreachable');
    }));

    const res = await verifyPOST(verifyRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'pending', orderStatus: 'ACTIVE' });
    expect(sendPaymentConfirmationEmail).not.toHaveBeenCalled();
  });
});
