import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * The operator surface is the only path that can move a held order or force a
 * reservation through the state machine, so its own contract matters as much as
 * the transitions it triggers:
 *
 *  - no secret configured is a deployment fault, answered `503`, never an
 *    unauthenticated run;
 *  - a wrong secret is `401`, and the comparison leaks nothing;
 *  - `GET` never writes, `reconcile` writes only with `dryRun: false`, and a
 *    `release` needs the literal confirmation word.
 */

const SECRET = 'test-billing-ops-secret';

const mocks = vi.hoisted(() => ({
  listPendingOrdersForOps: vi.fn(),
  countPendingOrdersByStatus: vi.fn(),
  findPendingOrderLifecycle: vi.fn(),
  buildReconciliationReport: vi.fn(),
  reconcileOrder: vi.fn(),
  releaseHeldOrder: vi.fn(),
}));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    listPendingOrdersForOps: mocks.listPendingOrdersForOps,
    countPendingOrdersByStatus: mocks.countPendingOrdersByStatus,
    findPendingOrderLifecycle: mocks.findPendingOrderLifecycle,
  };
});

vi.mock('@/lib/pending-order-reconcile', () => ({
  buildReconciliationReport: mocks.buildReconciliationReport,
  reconcileOrder: mocks.reconcileOrder,
  releaseHeldOrder: mocks.releaseHeldOrder,
}));

import { GET, POST } from '@/app/api/internal/billing/orders/route';

const ROW = {
  orderId: 'sxs-1',
  userId: 'user-1',
  plan: 'creator_monthly',
  amount: 349,
  currency: 'INR',
  createdAt: '2026-10-30T10:00:00.000Z',
  status: 'held_review',
  closedAt: '2026-10-30T10:01:00.000Z',
  closeReason: 'held_unapplied',
  heldAt: '2026-10-30T10:01:00.000Z',
  holdReason: 'claim_unentitled',
  fulfilledAt: null,
  lastCheckedAt: null,
  probeCount: 0,
  firstProbedAt: null,
  terminationSentAt: null,
  processedAt: '2026-10-30T10:00:30.000Z',
  planExpiresAt: null,
  userPlan: 'free',
};

const REPORT_ROW = {
  orderId: 'sxs-1',
  userId: 'user-1',
  plan: 'creator_monthly',
  amount: 349,
  currency: 'INR',
  status: 'held_review',
  createdAt: ROW.createdAt,
  claimed: true,
  entitled: false,
  gatewayStatus: null,
  recommendation: 'investigate_claim_unentitled',
};

function getRequest(query = '', headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return new NextRequest(`http://localhost/api/internal/billing/orders${query}`, { method: 'GET', headers });
}

function postRequest(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }) {
  return new NextRequest('http://localhost/api/internal/billing/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BILLING_OPS_SECRET', SECRET);
  vi.stubEnv('CLEANUP_SECRET', 'different-secret');

  mocks.listPendingOrdersForOps.mockResolvedValue([ROW]);
  mocks.countPendingOrdersByStatus.mockResolvedValue({ open: 2, held_review: 1 });
  mocks.findPendingOrderLifecycle.mockResolvedValue(ROW);
  mocks.buildReconciliationReport.mockResolvedValue({ rows: [REPORT_ROW], gatewayCalls: 1 });
  mocks.reconcileOrder.mockResolvedValue({ state: 'fulfilled', row: ROW });
  mocks.releaseHeldOrder.mockResolvedValue({ ok: true, orderId: 'sxs-1', status: 'fulfilled' });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('billing ops authentication', () => {
  it('answers 503 when the secret is not configured, and does no work', async () => {
    vi.stubEnv('BILLING_OPS_SECRET', '');

    const res = await GET(getRequest());

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/not configured/i) });
    expect(mocks.listPendingOrdersForOps).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong credential with 401', async () => {
    expect((await GET(getRequest('', {}))).status).toBe(401);
    expect((await GET(getRequest('', { authorization: `Bearer nope` }))).status).toBe(401);
    expect((await GET(getRequest('', { authorization: `Bearer ${SECRET}x` }))).status).toBe(401);
  });

  it('does not accept CLEANUP_SECRET as the billing credential', async () => {
    const res = await GET(getRequest('', { authorization: 'Bearer different-secret' }));
    expect(res.status).toBe(401);
  });

  it('marks every response no-store', async () => {
    const ok = await GET(getRequest());
    expect(ok.headers.get('Cache-Control')).toBe('no-store');

    const denied = await GET(getRequest('', { authorization: 'Bearer nope' }));
    expect(denied.headers.get('Cache-Control')).toBe('no-store');
  });

  it('accepts the dedicated header as an alternative to Bearer', async () => {
    const res = await GET(getRequest('', { 'x-billing-ops-secret': SECRET }));
    expect(res.status).toBe(200);
  });
});

describe('GET — read-only report', () => {
  it('reports orders, counts and recommendations without probing by default', async () => {
    const res = await GET(getRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.orders).toHaveLength(1);
    expect(body.orders[0]).toMatchObject({ orderId: 'sxs-1', recommendation: 'investigate_claim_unentitled' });
    expect(body.counts).toEqual({ open: 2, held_review: 1 });
    expect(body.gatewayCalls).toBe(1);
    expect(mocks.listPendingOrdersForOps).toHaveBeenCalledWith({
      statuses: ['creating', 'open', 'termination_requested', 'held_review', 'unverified'],
      limit: 50,
    });
    expect(mocks.buildReconciliationReport).toHaveBeenCalledWith({ rows: [ROW], probe: false });
  });

  it('honours filters, clamps the limit and opts into gateway reads explicitly', async () => {
    await GET(getRequest('?status=held_review,bogus&limit=9999&probe=1'));

    expect(mocks.listPendingOrdersForOps).toHaveBeenCalledWith({
      statuses: ['held_review'],
      limit: 200,
    });
    expect(mocks.buildReconciliationReport).toHaveBeenCalledWith({ rows: [ROW], probe: true });
  });

  it('falls back to the actionable defaults when no filter is valid', async () => {
    await GET(getRequest('?status=bogus'));

    expect(mocks.listPendingOrdersForOps).toHaveBeenCalledWith({
      statuses: ['creating', 'open', 'termination_requested', 'held_review', 'unverified'],
      limit: 50,
    });
  });
});

describe('POST — reconcile', () => {
  it('is a dry run unless explicitly asked to write', async () => {
    const res = await POST(postRequest({ action: 'reconcile', orderId: 'sxs-1' }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: true, order: { orderId: 'sxs-1' } });
    expect(mocks.reconcileOrder).not.toHaveBeenCalled();
    expect(mocks.buildReconciliationReport).toHaveBeenCalledWith({ rows: [ROW], probe: true });
  });

  it('runs the same state machine as checkout only when dryRun is false', async () => {
    mocks.findPendingOrderLifecycle
      .mockResolvedValueOnce(ROW)
      .mockResolvedValueOnce({ ...ROW, status: 'fulfilled' });

    const res = await POST(postRequest({ action: 'reconcile', orderId: 'sxs-1', dryRun: false }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ dryRun: false, state: 'fulfilled', currentStatus: 'fulfilled' });
    expect(mocks.reconcileOrder).toHaveBeenCalledWith('sxs-1', { requestId: expect.any(String), source: 'ops' });
  });

  it('rejects a missing order id', async () => {
    const res = await POST(postRequest({ action: 'reconcile' }));
    expect(res.status).toBe(400);
  });

  it('answers 404 for an unknown order', async () => {
    mocks.findPendingOrderLifecycle.mockResolvedValue(null);

    const res = await POST(postRequest({ action: 'reconcile', orderId: 'sxs-missing' }));

    expect(res.status).toBe(404);
    expect(mocks.reconcileOrder).not.toHaveBeenCalled();
  });
});

describe('POST — release', () => {
  it('requires the literal confirmation word', async () => {
    const res = await POST(
      postRequest({ action: 'release', orderId: 'sxs-1', resolution: 'refunded', confirm: 'yes' }),
    );

    expect(res.status).toBe(400);
    expect(mocks.releaseHeldOrder).not.toHaveBeenCalled();
  });

  it('requires a known resolution', async () => {
    const res = await POST(
      postRequest({ action: 'release', orderId: 'sxs-1', resolution: 'just_close_it', confirm: 'RELEASE' }),
    );

    expect(res.status).toBe(400);
    expect(mocks.releaseHeldOrder).not.toHaveBeenCalled();
  });

  it('releases through the reconciler with the operator source', async () => {
    mocks.findPendingOrderLifecycle
      .mockResolvedValueOnce(ROW)
      .mockResolvedValueOnce({ ...ROW, status: 'fulfilled' });

    const res = await POST(
      postRequest({ action: 'release', orderId: 'sxs-1', resolution: 'fulfilled_manually', confirm: 'RELEASE' }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      action: 'release',
      ok: true,
      currentStatus: 'fulfilled',
    });
    expect(mocks.releaseHeldOrder).toHaveBeenCalledWith({
      orderId: 'sxs-1',
      resolution: 'fulfilled_manually',
      ctx: { requestId: expect.any(String), source: 'ops' },
    });
  });

  it('surfaces a refused release as a conflict', async () => {
    mocks.releaseHeldOrder.mockResolvedValue({
      ok: false,
      orderId: 'sxs-1',
      status: 'held_review',
      error: 'gateway_still_payable',
    });

    const res = await POST(
      postRequest({ action: 'release', orderId: 'sxs-1', resolution: 'not_paid', confirm: 'RELEASE' }),
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, error: 'gateway_still_payable' });
  });

  it('rejects an unknown action', async () => {
    const res = await POST(postRequest({ action: 'delete', orderId: 'sxs-1' }));
    expect(res.status).toBe(400);
  });
});
