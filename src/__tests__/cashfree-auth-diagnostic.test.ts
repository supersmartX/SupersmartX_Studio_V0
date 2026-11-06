import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/db');
vi.mock('@/lib/pending-order-reconcile');
vi.mock('@/lib/email');
import * as db from '@/lib/db';
import * as reconciliation from '@/lib/pending-order-reconcile';
import * as fulfillment from '@/lib/cashfree-fulfillment';
import * as lifecycle from '@/lib/cashfree-order-lifecycle';
import { GET } from '@/app/api/internal/billing/orders/route';

const orderId = 'sxs-creator_monthly-a0c3367c-0724-4061-84c6-bb418b119d09';
const gatewayId = '3595a2fc-006c-479f-9ff6-d8456712c28c';
const query = `?diagnostic=cashfree-auth&orderId=${orderId}`;
const request = (suffix = query, secret = 'dummy-ops') => new NextRequest(
  `https://studio.example/api/internal/billing/orders${suffix}`,
  { headers: { 'x-billing-ops-secret': secret } },
);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of ['VERCEL', 'VERCEL_TARGET_ENV', 'CASHFREE_BUILD_ENV', 'NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY']) vi.stubEnv(key, undefined);
  for (const [key, value] of Object.entries({ VERCEL_ENV: 'production', CASHFREE_ENV: 'production',
    NEXT_PUBLIC_CASHFREE_ENV: 'production', CASHFREE_API_VERSION: '2022-09-01',
    CASHFREE_APP_ID: 'dummy-app', CASHFREE_SECRET_KEY: 'dummy-secret', BILLING_OPS_SECRET: 'dummy-ops' })) vi.stubEnv(key, value);
  vi.spyOn(fulfillment, 'fetchCashfreeOrder');
  vi.spyOn(fulfillment, 'fulfillPaidOrder');
  vi.spyOn(fulfillment, 'sendOrderReceiptOnce');
  vi.spyOn(lifecycle, 'terminateCashfreeOrder');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
    order_id: orderId, order_status: 'PAID', payment_session_id: 'private-session',
    customer_details: { customer_email: 'private@example.com' },
  }), { status: 200, headers: { 'x-request-id': gatewayId } })));
});

afterEach(() => {
  for (const exported of [...Object.values(db), ...Object.values(reconciliation)]) {
    if (vi.isMockFunction(exported)) expect(exported).not.toHaveBeenCalled();
  }
  expect(fulfillment.fulfillPaidOrder).not.toHaveBeenCalled();
  expect(fulfillment.sendOrderReceiptOnce).not.toHaveBeenCalled();
  expect(lifecycle.terminateCashfreeOrder).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function expectOneRead() {
  expect(fulfillment.fetchCashfreeOrder).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(`https://api.cashfree.com/pg/orders/${orderId}`, {
    method: 'GET', redirect: 'error', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'x-client-id': 'dummy-app',
      'x-client-secret': 'dummy-secret', 'x-api-version': '2022-09-01' },
  });
}

describe('protected Cashfree authentication diagnostic', () => {
  it('reads once and returns only diagnostic fields, even for a paid order', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ configurationValidation: 'PASS', authentication: 'PASS',
      httpStatus: 200, gatewayRequestId: gatewayId, gatewayErrorCode: null, gatewayMessage: null, orderFound: true });
    expectOneRead();
  });

  it.each([401, 403, 404, 429, 500])('reports HTTP %s without retrying', async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ code: 'request_failed',
      message: 'authentication Failed', payment_session_id: 'private-session' }),
    { status, headers: { 'x-cf-request-id': gatewayId } }));
    const response = await GET(request());
    expect(await response.json()).toEqual({ configurationValidation: 'PASS',
      authentication: status === 401 || status === 403 ? 'FAIL' : 'UNVERIFIED',
      httpStatus: status, gatewayRequestId: gatewayId, gatewayErrorCode: 'request_failed',
      gatewayMessage: 'authentication Failed', orderFound: status === 404 ? false : null });
    expectOneRead();
  });

  it('does not reflect arbitrary upstream messages or request headers', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      code: 'dummy-secret', message: 'private@example.com private-session dummy-app',
    }), { status: 401, headers: { 'x-request-id': 'private@example.com' } }));
    expect(await (await GET(request())).json()).toMatchObject({ gatewayErrorCode: 'cashfree_error',
      gatewayMessage: 'Cashfree returned HTTP 401', gatewayRequestId: null });
    expectOneRead();
  });

  it('does not leak transport errors or retry', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('dummy-secret private-session'));
    expect(await (await GET(request())).json()).toMatchObject({ httpStatus: null,
      authentication: 'UNVERIFIED', orderFound: null, gatewayErrorCode: 'gateway_request_or_response_failed' });
    expectOneRead();
  });

  it('does not claim a different order was found', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ order_id: 'different-order' })));
    expect(await (await GET(request())).json()).toMatchObject({ authentication: 'UNVERIFIED',
      orderFound: null, gatewayErrorCode: 'unexpected_order_response' });
    expectOneRead();
  });

  it.each(['', 'wrong-secret'])('rejects missing/wrong billing authentication', async (secret) => {
    expect((await GET(request(query, secret))).status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requires a configured billing secret', async () => {
    vi.stubEnv('BILLING_OPS_SECRET', undefined);
    expect((await GET(request())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['?diagnostic=cashfree-auth', '?diagnostic=cashfree-auth&orderId=unknown',
    `${query}&orderId=${orderId}`, '?diagnostic=invalid', `${query}&diagnostic=cashfree-auth`])(
    'rejects invalid diagnostic input: %s', async (suffix) => {
      expect((await GET(request(suffix))).status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    });

  it.each([['CASHFREE_ENV', 'sandbox'], ['CASHFREE_API_VERSION', ''],
    ['CASHFREE_SECRET_KEY', "'dummy-secret'"], ['NEXT_PUBLIC_CASHFREE_ENV', 'sandbox']])(
    'rejects invalid Production configuration %s', async (key, value) => {
      vi.stubEnv(key, value);
      const response = await GET(request());
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ configurationValidation: 'FAIL', authentication: 'NOT_TESTED' });
      expect(fetch).not.toHaveBeenCalled();
    });

  it('rejects valid local Sandbox configuration for this Production-only diagnostic', async () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('CASHFREE_ENV', 'sandbox');
    vi.stubEnv('NEXT_PUBLIC_CASHFREE_ENV', 'sandbox');
    expect((await GET(request())).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
});
