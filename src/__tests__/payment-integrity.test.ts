/* W8 integrity: a visible claim must imply a visible grant.
 *
 * The settlement transaction makes `processed_webhooks` (the claim), the
 * `users` plan write and the exact per-order `pending_orders.fulfilled_at`
 * marker commit together. This suite pins that at the level the previous
 * pipeline failed:
 *
 *  - the claim cannot survive a failed grant, and the grant cannot survive a
 *    failed marker (real database errors, injected as triggers — not a mock of
 *    the boundary under test);
 *  - two concurrent deliveries grant exactly one subscription term;
 *  - a renewal crash is not mistaken for fulfilment because an earlier term is
 *    still live, and a genuine renewal is recognised from its own marker
 *    without consulting Cashfree;
 *  - neither route can turn a claim-without-marker into success or a receipt.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';
process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
}));

import { HAS_TEST_DB } from '@/__tests__/helpers/db';
import { getPrisma } from '@/lib/db/prisma';
import {
  createPendingOrder,
  createUser,
  findPendingOrderLifecycle,
  findUserById,
  listPendingOrdersForOps,
  markPendingOrderOpen,
  setMigrated,
  settleFulfilledOrder,
  tryClaimWebhookOrder,
  updateUserPlanById,
} from '@/lib/db';
import { buildReconciliationReport } from '@/lib/pending-order-reconcile';
import { auth } from '@/auth';
import { POST as verifyPOST } from '@/app/api/cashfree/verify/route';
import { POST as webhookPOST } from '@/app/api/cashfree/webhook/route';

// `HAS_TEST_DB` (not merely "DATABASE_URL is set") refuses a URL that looks like
// the deployed database, so exporting the production value cannot turn this
// suite's writes or TRUNCATE loose on real accounts.
const describeDb = HAS_TEST_DB ? describe : describe.skip;

const CREATOR_MONTHLY = 349;
const WEBHOOK_SECRET = 'test-secret-key';
const DAY_MS = 86_400_000;

let n = 0;

async function seedBuyer(email: string) {
  n += 1;
  const user = await createUser(email, 'Buyer', 'hash');
  if (!user) throw new Error('seed user creation failed');
  return user;
}

async function seedPendingOrder(userId: string, plan = 'creator_monthly') {
  n += 1;
  const orderId = `sxs-integrity-${n}-${Math.random().toString(36).slice(2, 8)}`;
  await createPendingOrder({ orderId, userId, plan, amount: CREATOR_MONTHLY, currency: 'INR' });
  return orderId;
}

async function claimExists(orderId: string): Promise<boolean> {
  const rows = await getPrisma().$queryRaw<{ order_id: string }[]>`
    SELECT order_id FROM processed_webhooks WHERE order_id = ${orderId}`;
  return rows.length > 0;
}

function mockCashfreeOrder(body: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => body }));
}

function paidOrderBody(orderId: string) {
  return {
    order_id: orderId,
    order_status: 'PAID',
    order_amount: CREATOR_MONTHLY,
    order_currency: 'INR',
    customer_details: { customer_name: 'Buyer', customer_email: 'buyer@example.com' },
  };
}

function verifyRequest(orderId: string) {
  return new NextRequest(`http://localhost/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`, {
    method: 'POST',
  });
}

function signedWebhookRequest(orderId: string) {
  const raw = JSON.stringify({
    event_type: 'PAYMENT_SUCCESS',
    data: { order: { order_id: orderId }, payment: { payment_status: 'SUCCESS' } },
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

const GRANT_FAILURE = 'injected_user_grant_failure';
const MARKER_FAILURE = 'injected_order_marker_failure';

/**
 * Makes the next UPDATE of `users` (the plan grant) or `pending_orders` (the
 * fulfilment marker) fail inside whatever transaction issues it. This is a real
 * database error, so the test observes the transaction's own rollback rather
 * than a mock's opinion of it.
 */
async function installFailureTrigger(which: 'grant' | 'marker'): Promise<void> {
  const prisma = getPrisma();
  const fn = which === 'grant' ? 'payment_integrity_fail_user_grant' : 'payment_integrity_fail_order_marker';
  const table = which === 'grant' ? 'users' : 'pending_orders';
  const message = which === 'grant' ? GRANT_FAILURE : MARKER_FAILURE;
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${fn}() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION '${message}'; END; $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON ${table}`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${fn} BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION ${fn}()`);
}

async function dropFailureTriggers(): Promise<void> {
  const prisma = getPrisma();
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS payment_integrity_fail_user_grant ON users');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS payment_integrity_fail_order_marker ON pending_orders');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS payment_integrity_fail_user_grant()');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS payment_integrity_fail_order_marker()');
}

beforeEach(() => {
  setMigrated(false);
});

afterEach(async () => {
  // A trigger left installed would poison every later test in the run.
  if (HAS_TEST_DB) await dropFailureTriggers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describeDb('the settlement transaction commits the claim, the grant and the marker together', () => {
  it('leaves no claim behind when the entitlement write fails', async () => {
    const user = await seedBuyer('grant-fail@example.com');
    const orderId = await seedPendingOrder(user.id);

    await installFailureTrigger('grant');
    try {
      await expect(
        settleFulfilledOrder({ orderId, userId: user.id, plan: 'creator_monthly', interval: '1 month' }),
      ).rejects.toThrow(GRANT_FAILURE);
    } finally {
      await dropFailureTriggers();
    }

    expect(await claimExists(orderId)).toBe(false);
    expect((await findPendingOrderLifecycle(orderId))?.fulfilledAt).toBeNull();
    expect((await findUserById(user.id))?.plan).toBe('free');

    // The order is still claimable: the failure did not burn it.
    const retry = await settleFulfilledOrder({ orderId, userId: user.id, plan: 'creator_monthly', interval: '1 month' });
    expect(retry.state).toBe('fulfilled');
  });

  it('rolls the grant and the claim back when the fulfilment marker cannot be written', async () => {
    const user = await seedBuyer('marker-fail@example.com');
    const orderId = await seedPendingOrder(user.id);

    await installFailureTrigger('marker');
    try {
      await expect(
        settleFulfilledOrder({ orderId, userId: user.id, plan: 'creator_monthly', interval: '1 month' }),
      ).rejects.toThrow(MARKER_FAILURE);
    } finally {
      await dropFailureTriggers();
    }

    // The grant is written before the marker, so this is the case where the
    // entitlement did reach `users` — it must have been rolled back with it.
    const owner = await findUserById(user.id);
    expect(owner?.plan).toBe('free');
    expect(owner?.planExpiresAt ?? null).toBeNull();
    expect(await claimExists(orderId)).toBe(false);
    expect((await findPendingOrderLifecycle(orderId))?.fulfilledAt).toBeNull();
  });

  it('grants exactly one subscription term when two deliveries race', async () => {
    const user = await seedBuyer('settle-race@example.com');
    const orderId = await seedPendingOrder(user.id);

    const before = Date.now();
    const [a, b] = await Promise.all([
      settleFulfilledOrder({ orderId, userId: user.id, plan: 'creator_monthly', interval: '1 month' }),
      settleFulfilledOrder({ orderId, userId: user.id, plan: 'creator_monthly', interval: '1 month' }),
    ]);

    // One caller performs the grant; the other observes the committed marker.
    expect([a.state, b.state].sort()).toEqual(['already_fulfilled', 'fulfilled']);
    const expiresAt = a.state === 'already_fulfilled' || a.state === 'fulfilled' ? a.expiresAt : null;
    const otherExpiresAt = b.state === 'already_fulfilled' || b.state === 'fulfilled' ? b.expiresAt : null;
    expect(expiresAt).toBeTruthy();
    expect(otherExpiresAt).toBe(expiresAt);

    // Exactly one billing period, not two: a second grant would show up as the
    // expiry being roughly two months out instead of one.
    const termDays = (Date.parse(expiresAt as string) - before) / DAY_MS;
    expect(termDays).toBeGreaterThan(27);
    expect(termDays).toBeLessThan(32);
    expect((await findUserById(user.id))?.planExpiresAt).toBe(expiresAt);
  });
});

describeDb('historical claims are classified by their own marker', () => {
  it('does not call a renewal crash fulfilled just because an earlier term is still live', async () => {
    const user = await seedBuyer('renewal-crash@example.com');
    // The buyer already holds a paid term — the exact reason the old
    // `plan_expires_at > processed_at` heuristic reported these as fulfilled.
    await updateUserPlanById(user.id, 'creator_monthly', new Date(Date.now() + 20 * DAY_MS).toISOString());
    const orderId = await seedPendingOrder(user.id);
    await markPendingOrderOpen(orderId);

    // The pre-fix pipeline committed the claim, then died before the grant.
    expect(await tryClaimWebhookOrder(orderId)).toBe(true);

    const rows = await listPendingOrdersForOps({ statuses: ['open'], limit: 10 });
    const { rows: report, gatewayCalls } = await buildReconciliationReport({ rows, probe: false });

    expect(gatewayCalls).toBe(0);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({
      orderId,
      claimed: true,
      entitled: false,
      recommendation: 'investigate_claim_unentitled',
    });
  });

  it('recognises a genuine renewal from its order marker without asking Cashfree', async () => {
    const user = await seedBuyer('renewal-ok@example.com');
    const heldUntil = new Date(Date.now() + 20 * DAY_MS);
    await updateUserPlanById(user.id, 'creator_monthly', heldUntil.toISOString());
    const orderId = await seedPendingOrder(user.id);

    const settled = await settleFulfilledOrder({ orderId, userId: user.id, plan: 'creator_monthly', interval: '1 month' });
    expect(settled.state).toBe('fulfilled');
    const settledExpiry = settled.state === 'fulfilled' ? settled.expiresAt : '';

    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'renewal-ok@example.com' } } as never);
    const fetchSpy = vi.fn(async () => {
      throw new Error('Cashfree must not be consulted for a settled order');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await verifyPOST(verifyRequest(orderId));
    const body = (await res.json()) as { status?: string; orderId?: string; plan?: string; expiresAt?: string };

    expect(res.status).toBe(200);
    expect(body).toEqual({ status: 'activated', orderId, plan: 'creator_monthly', expiresAt: settledExpiry });
    expect(fetchSpy).not.toHaveBeenCalled();

    // A renewal extends the held term by one period; it must not restart from
    // now() and silently discard the remaining days.
    const termDays = (Date.parse(body.expiresAt as string) - heldUntil.getTime()) / DAY_MS;
    expect(termDays).toBeGreaterThan(27);
    expect(termDays).toBeLessThan(32);
  });
});

describeDb('route verdicts never promote a claim to an activation', () => {
  it('verify answers pending for a claim with no marker, sends no receipt and consults nothing', async () => {
    const user = await seedBuyer('claim-only-verify@example.com');
    const orderId = await seedPendingOrder(user.id);
    expect(await tryClaimWebhookOrder(orderId)).toBe(true);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id, email: 'claim-only-verify@example.com' } } as never);

    const fetchSpy = vi.fn(async () => {
      throw new Error('a claim with no marker must not be verified against the gateway');
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await verifyPOST(verifyRequest(orderId));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending', orderStatus: 'ACTIVE' });
    expect(fetchSpy).not.toHaveBeenCalled();

    const { sendPaymentConfirmationEmail } = await import('@/lib/email');
    expect(vi.mocked(sendPaymentConfirmationEmail)).not.toHaveBeenCalled();
    expect((await findUserById(user.id))?.plan).toBe('free');
    expect((await findPendingOrderLifecycle(orderId))?.fulfilledAt).toBeNull();
    // The claim is preserved for the operator, not silently dropped.
    expect(await claimExists(orderId)).toBe(true);
  });

  it('webhook acknowledges a claim with no marker without success or a receipt', async () => {
    const user = await seedBuyer('claim-only-webhook@example.com');
    const orderId = await seedPendingOrder(user.id);
    expect(await tryClaimWebhookOrder(orderId)).toBe(true);
    mockCashfreeOrder(paidOrderBody(orderId));

    const res = await webhookPOST(signedWebhookRequest(orderId));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending_review' });

    const { sendPaymentConfirmationEmail } = await import('@/lib/email');
    expect(vi.mocked(sendPaymentConfirmationEmail)).not.toHaveBeenCalled();
    expect((await findUserById(user.id))?.plan).toBe('free');
    expect((await findPendingOrderLifecycle(orderId))?.fulfilledAt).toBeNull();
  });
});
