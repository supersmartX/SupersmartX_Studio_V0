import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
}));

import { auth } from '@/auth';
import { POST as verifyPOST } from '@/app/api/cashfree/verify/route';
import { POST as webhookPOST } from '@/app/api/cashfree/webhook/route';
import { fulfillPaidOrder, fulfillmentErrorMessage, getCashfreeEnv, cashfreeBaseUrl, isCashfreeEnvConsistent } from '@/lib/cashfree-fulfillment';
import { resetDb, getDb } from '@/lib/db/driver';
import {
  setMigrated,
  createUser,
  createPendingOrder,
  findPendingOrder,
  tryClaimWebhookOrder,
  releaseWebhookClaim,
  findUserById,
} from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

const WEBHOOK_SECRET = 'test-secret-key';
const CREATOR_MONTHLY = 349;

let n = 0;

async function seedBuyer(email: string) {
  n += 1;
  const user = await createUser(email, 'Buyer', 'hash');
  if (!user) throw new Error('seed user creation failed');
  return user;
}

/** Seeds a pending order the way the checkout route does. */
async function seedPendingOrder(userId: string, overrides: Partial<{ plan: string; amount: number; currency: string; orderId: string }> = {}) {
  const orderId = overrides.orderId ?? `sxs-creator_monthly-${n}-${Math.random().toString(36).slice(2, 8)}`;
  await createPendingOrder({
    orderId,
    userId,
    plan: overrides.plan ?? 'creator_monthly',
    amount: overrides.amount ?? CREATOR_MONTHLY,
    currency: overrides.currency ?? 'INR',
  });
  return orderId;
}

function mockCashfreeOrder(body: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
    })
  );
}

function paidOrderBody(orderId: string, amount = CREATOR_MONTHLY, currency = 'INR') {
  return {
    order_id: orderId,
    order_status: 'PAID',
    order_amount: amount,
    order_currency: currency,
    customer_details: { customer_name: 'Buyer', customer_email: 'buyer@example.com' },
  };
}

function verifyRequest(orderId: string) {
  return new NextRequest(`http://localhost/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`, {
    method: 'POST',
  });
}

function signedWebhookRequest(orderId: string, paymentStatus: string) {
  const raw = JSON.stringify({
    event_type: 'PAYMENT_SUCCESS',
    data: { order: { order_id: orderId }, payment: { payment_status: paymentStatus } },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = crypto.createHmac('sha256', WEBHOOK_SECRET).update(timestamp + raw).digest('base64');
  return new NextRequest('http://localhost/api/cashfree/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body: raw,
  });
}

async function claimExists(orderId: string): Promise<boolean> {
  const db = getDb();
  const result = await db.execute({ sql: 'SELECT order_id FROM processed_webhooks WHERE order_id = ?', args: [orderId] });
  return result.rows.length > 0;
}

describe('payment fulfilment is driven by authoritative state, not the return URL', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('activates the plan on the return trip even when the webhook never arrived', async () => {
    const user = await seedBuyer('return-trip@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder(paidOrderBody(orderId));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'return-trip@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'activated' });
    const updated = await findUserById(user.id);
    expect(updated?.plan).toBe('creator_monthly');
  });

  it('refuses to activate when Cashfree does not report PAID', async () => {
    const user = await seedBuyer('unpaid@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder({ order_id: orderId, order_status: 'ACTIVE', order_amount: CREATOR_MONTHLY, order_currency: 'INR' });
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'unpaid@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ status: 'pending' });
    const updated = await findUserById(user.id);
    expect(updated?.plan).toBe('free');
  });

  it('rejects a signed-in user who does not own the order', async () => {
    const owner = await seedBuyer('owner@example.com');
    const attacker = await seedBuyer('attacker@example.com');
    const orderId = await seedPendingOrder(owner.id);
    mockCashfreeOrder(paidOrderBody(orderId));
    vi.mocked(auth).mockResolvedValue({ user: { id: attacker.id, email: 'attacker@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(403);
    expect((await findUserById(owner.id))?.plan).toBe('free');
    expect((await findUserById(attacker.id))?.plan).toBe('free');
  });

  it('requires authentication', async () => {
    vi.mocked(auth).mockResolvedValue(null as unknown as Awaited<ReturnType<typeof auth>>);

    const res = await verifyPOST(verifyRequest('sxs-unknown'));

    expect(res.status).toBe(401);
  });

  it('rejects a paid order whose amount does not match the stored expectation', async () => {
    const user = await seedBuyer('wrong-amount@example.com');
    const orderId = await seedPendingOrder(user.id, { amount: CREATOR_MONTHLY });
    // A tampered/underpaid settlement for a fraction of the real price.
    mockCashfreeOrder(paidOrderBody(orderId, 1));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'wrong-amount@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(400);
    expect((await findUserById(user.id))?.plan).toBe('free');
  });

  it('rejects a paid order settled in a different currency', async () => {
    const user = await seedBuyer('wrong-currency@example.com');
    const orderId = await seedPendingOrder(user.id, { currency: 'INR' });
    mockCashfreeOrder(paidOrderBody(orderId, CREATOR_MONTHLY, 'USD'));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'wrong-currency@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(400);
    expect((await findUserById(user.id))?.plan).toBe('free');
  });

  it('never fulfils a plan outside the launch set, even from a PAID order', async () => {
    const user = await seedBuyer('pro-attempt@example.com');
    const orderId = await seedPendingOrder(user.id, { plan: 'pro_yearly' });
    mockCashfreeOrder(paidOrderBody(orderId));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'pro-attempt@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(400);
    expect((await findUserById(user.id))?.plan).toBe('free');
  });
});

describe('payment fulfilment idempotency', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('activates the plan exactly once across repeated verify calls', async () => {
    const user = await seedBuyer('idempotent@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder(paidOrderBody(orderId));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'idempotent@example.com' } } as never);

    const first = await verifyPOST(verifyRequest(orderId));
    const second = await verifyPOST(verifyRequest(orderId));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    await expect(second.json()).resolves.toMatchObject({ status: 'activated' });

    // The expiry is written once: the first activation's timestamp must survive,
    // so a second write would be visible as a drifting/extended expiry.
    const updated = await findUserById(user.id);
    expect(updated?.plan).toBe('creator_monthly');
    expect(await claimExists(orderId)).toBe(true);
  });

  it('does not extend the expiry when the webhook and the return trip race', async () => {
    const user = await seedBuyer('race@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder(paidOrderBody(orderId));

    // First call claims and fulfils; the second loses the claim race.
    expect(await tryClaimWebhookOrder(orderId)).toBe(true);
    expect(await tryClaimWebhookOrder(orderId)).toBe(false);

    const updated = await findUserById(user.id);
    expect(updated?.plan).toBe('free'); // claim taken, fulfilment not yet run
  });
});

describe('webhook claim lifecycle', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('is atomic under concurrent claims for the same order', async () => {
    const results = await Promise.all([
      tryClaimWebhookOrder('sxs-concurrent'),
      tryClaimWebhookOrder('sxs-concurrent'),
      tryClaimWebhookOrder('sxs-concurrent'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('releaseWebhookClaim makes the order claimable again', async () => {
    expect(await tryClaimWebhookOrder('sxs-retry')).toBe(true);
    expect(await tryClaimWebhookOrder('sxs-retry')).toBe(false);
    await releaseWebhookClaim('sxs-retry');
    expect(await tryClaimWebhookOrder('sxs-retry')).toBe(true);
  });
});

describe('webhook request handling', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('rejects a body whose signature does not match', async () => {
    const user = await seedBuyer('bad-sig@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder(paidOrderBody(orderId));

    const req = new NextRequest('http://localhost/api/cashfree/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': 'not-a-valid-signature',
        'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
      },
      body: JSON.stringify({ data: { order: { order_id: orderId }, payment: { payment_status: 'SUCCESS' } } }),
    });

    const res = await webhookPOST(req);

    expect(res.status).toBe(400);
    expect((await findUserById(user.id))?.plan).toBe('free');
  });

  it('asks for a retry when the event claims paid but Cashfree has not settled', async () => {
    const user = await seedBuyer('lagging@example.com');
    const orderId = await seedPendingOrder(user.id);
    // Event says SUCCESS; authoritative state is still ACTIVE.
    mockCashfreeOrder({ order_id: orderId, order_status: 'ACTIVE', order_amount: CREATOR_MONTHLY, order_currency: 'INR' });

    const res = await webhookPOST(signedWebhookRequest(orderId, 'SUCCESS'));

    // 2xx here would drop the event permanently, so a 503 with Retry-After is required.
    expect(res.status).toBe(503);
    expect((await findUserById(user.id))?.plan).toBe('free');
  });

  it('ignores a genuinely non-terminal event without consuming the claim', async () => {
    const user = await seedBuyer('pending-event@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder({ order_id: orderId, order_status: 'ACTIVE', order_amount: CREATOR_MONTHLY, order_currency: 'INR' });

    const res = await webhookPOST(signedWebhookRequest(orderId, 'PENDING'));

    expect(res.status).toBe(200);
    expect(await claimExists(orderId)).toBe(false);
  });

  it('fulfils once and leaves a later duplicate delivery as a no-op', async () => {
    const user = await seedBuyer('dup-delivery@example.com');
    const orderId = await seedPendingOrder(user.id);
    mockCashfreeOrder(paidOrderBody(orderId));

    const first = await webhookPOST(signedWebhookRequest(orderId, 'SUCCESS'));
    const second = await webhookPOST(signedWebhookRequest(orderId, 'SUCCESS'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await findUserById(user.id))?.plan).toBe('creator_monthly');
    expect(await claimExists(orderId)).toBe(true);
  });

  it('releases the claim when fulfilment throws so a retry can still succeed', async () => {
    const user = await seedBuyer('throw@example.com');
    const orderId = await seedPendingOrder(user.id);
    // Ownership still resolves (session id === order user id), but the target row
    // is gone by the time the plan is written: the write affects zero rows and
    // must be reported as a retryable failure, not a phantom activation.
    // (Deleting the user cascades the pending order away, so it is re-added.)
    await getDb().execute({ sql: 'DELETE FROM users WHERE id = ?', args: [user.id] });
    await seedPendingOrder(user.id, { orderId, plan: 'creator_monthly', amount: CREATOR_MONTHLY });
    mockCashfreeOrder(paidOrderBody(orderId));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'throw@example.com' } } as never);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(500);
    // Claim released, so a later retry is not permanently blocked.
    expect(await claimExists(orderId)).toBe(false);
    expect((await findPendingOrder(orderId))?.userId).toBe(user.id);
  });
});

describe('Cashfree environment consistency', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('defaults to sandbox when the server env is unset', () => {
    delete process.env.CASHFREE_ENV;
    expect(getCashfreeEnv()).toBe('sandbox');
    expect(cashfreeBaseUrl()).toBe('https://sandbox.cashfree.com/pg');
  });

  it('treats an unrecognised server env as sandbox, never production', () => {
    process.env.CASHFREE_ENV = 'prodution';
    expect(getCashfreeEnv()).toBe('sandbox');
  });

  it('selects the live host only for an exact production value', () => {
    process.env.CASHFREE_ENV = 'production';
    expect(getCashfreeEnv()).toBe('production');
    expect(cashfreeBaseUrl()).toBe('https://api.cashfree.com/pg');
  });

  it('accepts a matching public env', () => {
    process.env.CASHFREE_ENV = 'production';
    process.env.NEXT_PUBLIC_CASHFREE_ENV = 'production';
    expect(isCashfreeEnvConsistent()).toBe(true);
  });

  it('accepts an absent public env (nothing to contradict)', () => {
    process.env.CASHFREE_ENV = 'production';
    delete process.env.NEXT_PUBLIC_CASHFREE_ENV;
    expect(isCashfreeEnvConsistent()).toBe(true);
  });

  // A browser locked to sandbox checkout while the server creates a production
  // order can never settle: the payment succeeds in one environment and the
  // webhook for the order never fires in the other.
  it('rejects a split where the browser would check out in sandbox against a production order', () => {
    process.env.CASHFREE_ENV = 'production';
    process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';
    expect(isCashfreeEnvConsistent()).toBe(false);
  });

  it('rejects the mirror-image split', () => {
    process.env.CASHFREE_ENV = 'sandbox';
    process.env.NEXT_PUBLIC_CASHFREE_ENV = 'production';
    expect(isCashfreeEnvConsistent()).toBe(false);
  });
});

describe('fulfillPaidOrder guardrails', () => {
  beforeEach(cleanTestData);
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('tolerates sub-paisa float noise but rejects a real mismatch', async () => {
    const pending = { orderId: 'o1', userId: 'u1', plan: 'creator_monthly', amount: 349, currency: 'INR' };
    const user = await seedBuyer('float@example.com');
    const withUser = { ...pending, userId: user.id };

    const ok = await fulfillPaidOrder(withUser, { order_id: 'o1', order_status: 'PAID', order_amount: 349.005, order_currency: 'INR' });
    expect(ok.ok).toBe(true);

    const bad = await fulfillPaidOrder(withUser, { order_id: 'o1', order_status: 'PAID', order_amount: 348, order_currency: 'INR' });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toBe('amount_mismatch');
  });

  it('maps every failure reason to a message that does not echo stored values', () => {
    expect(fulfillmentErrorMessage('amount_mismatch')).toBe('Amount mismatch');
    expect(fulfillmentErrorMessage('currency_mismatch')).toBe('Currency mismatch');
    expect(fulfillmentErrorMessage('unknown_plan')).toBe('Unsupported plan');
  });

  it('sets a one-month expiry for monthly and one-year for yearly', async () => {
    const user = await seedBuyer('expiry@example.com');
    const before = Date.now();

    await fulfillPaidOrder(
      { orderId: 'o2', userId: user.id, plan: 'creator_monthly', amount: 349, currency: 'INR' },
      { order_id: 'o2', order_status: 'PAID', order_amount: 349, order_currency: 'INR' }
    );
    const monthly = await findUserById(user.id);
    const monthlyMs = new Date(monthly!.planExpiresAt!).getTime() - before;
    expect(monthlyMs).toBeGreaterThan(27 * 86400000);
    expect(monthlyMs).toBeLessThan(32 * 86400000);

    const before2 = Date.now();
    await fulfillPaidOrder(
      { orderId: 'o3', userId: user.id, plan: 'creator_yearly', amount: 2899, currency: 'INR' },
      { order_id: 'o3', order_status: 'PAID', order_amount: 2899, order_currency: 'INR' }
    );
    const yearly = await findUserById(user.id);
    const yearlyMs = new Date(yearly!.planExpiresAt!).getTime() - before2;
    expect(yearlyMs).toBeGreaterThan(360 * 86400000);
    expect(yearlyMs).toBeLessThan(370 * 86400000);
  });
});
