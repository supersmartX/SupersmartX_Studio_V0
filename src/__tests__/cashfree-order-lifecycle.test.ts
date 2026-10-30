import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The gateway client is where "we do not know" must never be mistaken for "no
 * order exists". Only an explicit 404 is absence. Everything else — 5xx, 401,
 * 429, a timeout, an unreadable body — is uncertainty, and uncertainty must not
 * move an order one step closer to release.
 */

process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';

import {
  classifyGatewayOrder,
  pollCashfreeOrder,
  probeCashfreeOrder,
  terminateCashfreeOrder,
} from '@/lib/cashfree-order-lifecycle';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ORDER = { order_id: 'sxs-1', order_status: 'ACTIVE', order_amount: 349, order_currency: 'INR' };

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('classifyGatewayOrder', () => {
  it('maps the terminal states and keeps TERMINATION_REQUESTED non-terminal', () => {
    expect(classifyGatewayOrder({ order_status: 'PAID' })).toBe('paid');
    expect(classifyGatewayOrder({ order_status: 'ACTIVE' })).toBe('active');
    expect(classifyGatewayOrder({ order_status: 'EXPIRED' })).toBe('expired');
    expect(classifyGatewayOrder({ order_status: 'TERMINATED' })).toBe('terminated');
    expect(classifyGatewayOrder({ order_status: 'TERMINATION_REQUESTED' })).toBe('terminating');
  });

  it('treats payment statuses and unknown words as unknown, not as failures', () => {
    // FAILED / CANCELLED are payment_status values; ordering an ACTIVE order to
    // be released because of one would be a paid-order loss.
    expect(classifyGatewayOrder({ order_status: 'FAILED' })).toBe('unknown');
    expect(classifyGatewayOrder({ order_status: 'CANCELLED' })).toBe('unknown');
    expect(classifyGatewayOrder({ order_status: 'paid' })).toBe('unknown');
    expect(classifyGatewayOrder({})).toBe('unknown');
  });
});

describe('probeCashfreeOrder', () => {
  it('reads an existing order', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ORDER));
    vi.stubGlobal('fetch', fetchMock);

    const probe = await probeCashfreeOrder('sxs-1');

    expect(probe).toEqual({ kind: 'found', order: ORDER });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/orders\/sxs-1$/);
    expect(init.method).toBe('GET');
  });

  it('reports absence only for an explicit 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    expect(await probeCashfreeOrder('sxs-1')).toEqual({ kind: 'not_found' });
  });

  it.each([401, 429, 500, 503])('treats HTTP %i as uncertainty', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status })));

    const probe = await probeCashfreeOrder('sxs-1');

    expect(probe.kind).toBe('uncertain');
  });

  it('treats a transport failure as uncertainty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNRESET');
      }),
    );

    expect(await probeCashfreeOrder('sxs-1')).toEqual({ kind: 'uncertain', reason: 'Error' });
  });

  it('treats a body without an order id as uncertainty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ status: 'ACTIVE' })));

    expect(await probeCashfreeOrder('sxs-1')).toEqual({ kind: 'uncertain', reason: 'unreadable_body' });
  });

  it('treats an unparseable success body as uncertainty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));

    expect((await probeCashfreeOrder('sxs-1')).kind).toBe('uncertain');
  });
});

describe('terminateCashfreeOrder', () => {
  it('sends the documented PATCH payload and reports acceptance', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...ORDER, order_status: 'TERMINATED' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await terminateCashfreeOrder('sxs-1');

    expect(result.kind).toBe('accepted');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ order_status: 'TERMINATED' });
  });

  it('distinguishes a refusal from uncertainty', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    expect(await terminateCashfreeOrder('sxs-1')).toEqual({ kind: 'refused', status: 400 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('timeout');
      }),
    );
    expect((await terminateCashfreeOrder('sxs-1')).kind).toBe('uncertain');
  });

  it('reports a missing order without pretending the kill worked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    expect(await terminateCashfreeOrder('sxs-1')).toEqual({ kind: 'not_found' });
  });

  it('accepts an empty success body as "request taken"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 200 })));

    const result = await terminateCashfreeOrder('sxs-1');

    expect(result).toEqual({ kind: 'accepted', order: { order_id: 'sxs-1' } });
  });
});

describe('pollCashfreeOrder', () => {
  it('stops at the first terminal reading without sleeping', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ...ORDER, order_status: 'TERMINATED' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollCashfreeOrder('sxs-1');

    expect(result.kind).toBe('found');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns the last non-terminal answer when the budget runs out', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(ORDER));
    vi.stubGlobal('fetch', fetchMock);

    const result = await pollCashfreeOrder('sxs-1', 2, 0);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('found');
  });

  it('stops early on a 404 so the caller can classify it', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);

    expect(await pollCashfreeOrder('sxs-1', 3, 0)).toEqual({ kind: 'not_found' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
