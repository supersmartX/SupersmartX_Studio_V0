import crypto from 'crypto';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getCashfreeConfig, requiresCashfreeProduction } from '@/lib/cashfree-config';
import { resolveCashfreeMode, loadCashfreeSDK } from '@/lib/cashfree';
import { fetchCashfreeOrder } from '@/lib/cashfree-fulfillment';
import { probeCashfreeOrder, terminateCashfreeOrder } from '@/lib/cashfree-order-lifecycle';

vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'config-test' } })) }));
vi.mock('@/lib/db');
vi.mock('@/lib/email');
import * as db from '@/lib/db';
import { POST as create } from '@/app/api/cashfree/order/route';
import { POST as verify } from '@/app/api/cashfree/verify/route';
import { POST as webhook } from '@/app/api/cashfree/webhook/route';
import { POST as ops, GET as report } from '@/app/api/internal/billing/orders/route';
import { reconcileOrder, reconcileUserCheckout, releaseHeldOrder } from '@/lib/pending-order-reconcile';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ order_id: 'order-1', order_status: 'ACTIVE' }))));
  for (const key of ['VERCEL', 'VERCEL_ENV', 'VERCEL_TARGET_ENV', 'CASHFREE_BUILD_ENV', 'NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY']) vi.stubEnv(key, undefined);
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('CASHFREE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_CASHFREE_ENV', 'production');
  vi.stubEnv('CASHFREE_API_VERSION', '2022-09-01');
  vi.stubEnv('CASHFREE_APP_ID', 'test-app-id');
  vi.stubEnv('CASHFREE_SECRET_KEY', 'test-secret-key');
  vi.stubEnv('BILLING_OPS_SECRET', 'test-ops');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const request = (path: string) => new NextRequest(`https://studio.example/api/${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', authorization: 'Bearer test-ops' },
  body: JSON.stringify({ action: 'reconcile', orderId: 'order-1', dryRun: false }),
});

describe('Production Cashfree boundary', () => {
  it.each([
    ['CASHFREE_ENV', 'sandbox'], ['NEXT_PUBLIC_CASHFREE_ENV', 'sandbox'],
    ['CASHFREE_ENV', ''], ['CASHFREE_APP_ID', ''], ['CASHFREE_SECRET_KEY', ' '],
    ['CASHFREE_API_VERSION', '2023-08-01'], ['CASHFREE_API_VERSION', ''],
    ['CASHFREE_BUILD_ENV', 'sandbox'], ['CASHFREE_ENV', 'PRODUCTION'],
  ])('blocks %s=%s before gateway or order mutation', async (key, value) => {
    vi.stubEnv(key, value);
    expect(() => getCashfreeConfig()).toThrow();
    expect((await create(request('cashfree/order'))).status).toBe(503);
    expect((await verify(request('cashfree/verify?order_id=order-1'))).status).toBe(503);
    expect((await webhook(request('cashfree/webhook'))).status).toBe(500);
    expect((await ops(request('internal/billing/orders'))).status).toBe(503);
    await expect(reconcileOrder('order-1', { requestId: 'test', source: 'ops' })).rejects.toThrow();
    await expect(reconcileUserCheckout('user-1', { requestId: 'test', source: 'ops' })).rejects.toThrow();
    await expect(releaseHeldOrder({ orderId: 'order-1', resolution: 'refunded', ctx: { requestId: 'test', source: 'ops' } })).rejects.toThrow();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(db.reservePendingOrder).not.toHaveBeenCalled();
    expect(db.findPendingOrder).not.toHaveBeenCalled();
    expect(db.closePendingOrder).not.toHaveBeenCalled();
    expect(db.settleFulfilledOrder).not.toHaveBeenCalled();
  });

  it('uses Production and the exact version for reads, probes and termination; forbids redirects', async () => {
    await fetchCashfreeOrder('order-1');
    await probeCashfreeOrder('order-1');
    await terminateCashfreeOrder('order-1');
    expect(vi.mocked(fetch).mock.calls).toHaveLength(3);
    for (const [url, init] of vi.mocked(fetch).mock.calls) {
      expect(String(url)).toBe('https://api.cashfree.com/pg/orders/order-1');
      expect(init?.headers).toMatchObject({ 'x-api-version': '2022-09-01' });
      expect(init?.redirect).toBe('error');
    }
  });

  it('allows explicitly configured local Sandbox, including local next start', () => {
    vi.stubEnv('VERCEL_ENV', undefined);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CASHFREE_ENV', 'sandbox');
    vi.stubEnv('NEXT_PUBLIC_CASHFREE_ENV', 'sandbox');
    expect(getCashfreeConfig().baseUrl).toBe('https://sandbox.cashfree.com/pg');
    vi.stubEnv('NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY', 'true');
    expect(() => getCashfreeConfig()).toThrow('cashfree_production_required');
    expect(resolveCashfreeMode()).toBeNull();
  });

  it('fails closed on absent or contradictory hosted context', () => {
    expect(() => requiresCashfreeProduction({ VERCEL: '1' })).toThrow();
    expect(() => requiresCashfreeProduction({ VERCEL_ENV: 'production', VERCEL_TARGET_ENV: 'preview' })).toThrow();
    expect(requiresCashfreeProduction({ VERCEL_ENV: 'production' })).toBe(true);
  });

  it('rejects browser Sandbox without initializing or loading the SDK', async () => {
    vi.stubEnv('NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY', 'true');
    vi.stubEnv('NEXT_PUBLIC_CASHFREE_ENV', 'sandbox');
    const sdk = vi.fn();
    window.Cashfree = sdk;
    const append = vi.spyOn(document.head, 'appendChild');
    await expect(loadCashfreeSDK()).rejects.toThrow('cashfree_env_invalid');
    expect(sdk).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
    append.mockRestore();
    delete window.Cashfree;
  });

  it('keeps database-only ops reports available but blocks probes on misconfiguration', async () => {
    vi.stubEnv('CASHFREE_ENV', 'sandbox');
    vi.mocked(db.listPendingOrdersForOps).mockResolvedValue([]);
    vi.mocked(db.countPendingOrdersByStatus).mockResolvedValue({} as never);
    const headers = { authorization: 'Bearer test-ops' };
    expect((await report(new NextRequest('https://studio.example/api/internal/billing/orders', { headers }))).status).toBe(200);
    expect((await report(new NextRequest('https://studio.example/api/internal/billing/orders?probe=1', { headers }))).status).toBe(503);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('locks the Production build and excludes Sandbox from its CSP', async () => {
    vi.resetModules();
    const { default: config } = await import('../../next.config');
    expect(config.env).toMatchObject({ NEXT_PUBLIC_CASHFREE_PRODUCTION_ONLY: 'true', CASHFREE_BUILD_ENV: 'production' });
    expect(JSON.stringify(config.env)).not.toContain('test-secret-key');
    const headers = JSON.stringify(await config.headers!());
    expect(headers).toContain('https://api.cashfree.com');
    expect(headers).not.toContain('sandbox.cashfree.com');
    expect(headers).not.toContain('payments-test.cashfree.com');
  });

  it.each(['CASHFREE_ENV', 'NEXT_PUBLIC_CASHFREE_ENV', 'CASHFREE_APP_ID', 'CASHFREE_SECRET_KEY', 'CASHFREE_API_VERSION'])('fails a Production build when %s is missing', async (key) => {
    vi.stubEnv(key, undefined);
    vi.resetModules();
    await expect(import('../../next.config')).rejects.toThrow();
  });

  it('requires the original signed raw webhook body and rejects replay/tampering', async () => {
    const body = JSON.stringify({ data: { order: { order_id: 'order-1' } } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signed = (raw: string, time: string, secret = 'test-secret-key') => new NextRequest('https://studio.example/api/cashfree/webhook', {
      method: 'POST', body: raw, headers: {
        'x-webhook-timestamp': time,
        'x-webhook-signature': crypto.createHmac('sha256', secret).update(time + body).digest('base64'),
      },
    });
    const valid = await webhook(signed(body, timestamp));
    expect((await valid.json()).error).toBe('Unknown order');
    expect(db.findPendingOrder).toHaveBeenCalledWith('order-1');
    vi.mocked(db.findPendingOrder).mockClear();
    for (const req of [signed(body + ' ', timestamp), signed(body, String(Number(timestamp) - 600)), signed(body, timestamp, 'wrong-test-secret')]) {
      expect((await webhook(req)).status).toBe(400);
    }
    expect(db.findPendingOrder).not.toHaveBeenCalled();
    expect(db.settleFulfilledOrder).not.toHaveBeenCalled();
  });

});
