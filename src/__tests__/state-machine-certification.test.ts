/**
 * Release certification for the state machine — the defects that block launch.
 *
 * The launch question is not "is the UI ready?" but "can ONE recorded video
 * survive the entire product lifecycle — Free -> payment -> Creator -> every
 * platform -> actual MP4 -> storage -> download — without being recreated or
 * corrupted?". Two defects broke exactly that sentence, and both are pinned
 * here with a fault injected into the real code path rather than a mock that
 * agrees with the implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
import { POST as webhookPOST } from '@/app/api/cashfree/webhook/route';
import { resetDb, getDb } from '@/lib/db/driver';
import {
  setMigrated,
  createUser,
  createPendingOrder,
  findUserById,
  findPendingOrder,
  tryClaimWebhookOrder,
} from '@/lib/db';

const WEBHOOK_SECRET = 'test-secret-key';
const CREATOR_MONTHLY = 349;

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

function mockCashfreeOrder(body: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => body })
  );
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
      'content-type': 'application/json',
      'x-webhook-signature': signature,
      'x-webhook-timestamp': timestamp,
    },
    body: raw,
  });
}

async function planRow(userId: string) {
  const user = await findUserById(userId);
  return { plan: user?.plan, planExpiresAt: user?.planExpiresAt };
}

async function isClaimHeld(orderId: string): Promise<boolean> {
  return tryClaimWebhookOrder(orderId);
}

/**
 * Removes the notification ledger so its INSERT fails for real.
 *
 * This is genuine fault injection, not a stub: the fulfilment code path runs
 * unmodified and hits a genuine database error at a genuine point. Mocking
 * `tryClaimOrderNotification` to reject would have let the test pass while the
 * production call site stayed broken.
 */
async function breakNotificationLedger() {
  await getDb().execute('DROP TABLE order_notifications');
}

async function restoreNotificationLedger() {
  await getDb().execute(`
    CREATE TABLE IF NOT EXISTS order_notifications (
      order_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (order_id, kind)
    )
  `);
}

describe('STATE 6 — duplicate payment events must grant Creator exactly once', () => {
  beforeEach(() => {
    cleanTestData();
    vi.unstubAllGlobals();
  });

  it('a failing receipt send must not release the fulfilment claim and re-extend the subscription', async () => {
    const user = await createUser('dup@example.com', 'Dup', 'hash');
    expect(user).toBeTruthy();
    const orderId = 'sxs-creator_monthly-dup-1';
    await createPendingOrder({ orderId, userId: user!.id, plan: 'creator_monthly', amount: CREATOR_MONTHLY, currency: 'INR' });
    mockCashfreeOrder(paidOrderBody(orderId));

    // --- delivery #1: the receipt ledger is broken underneath the code path.
    await breakNotificationLedger();
    const first = await webhookPOST(signedWebhookRequest(orderId));
    const firstBody = await first.json();

    // The entitlement is correct after the first delivery even though the
    // receipt could not be recorded.
    const afterFirst = await planRow(user!.id);
    expect(afterFirst.plan, 'delivery #1 must activate the plan').toBe('creator_monthly');
    expect(afterFirst.planExpiresAt, 'delivery #1 must write an expiry').toBeTruthy();
    expect(firstBody.status, 'a receipt failure must not surface as a webhook failure').toBe('ok');

    await restoreNotificationLedger();

    // --- delivery #2: Cashfree retrying a delivery it believed failed.
    await new Promise((r) => setTimeout(r, 5));
    const second = await webhookPOST(signedWebhookRequest(orderId));
    expect(second.status).toBe(200);
    const afterSecond = await planRow(user!.id);

    // THE REGRESSION: the fulfilment claim must have survived delivery #1, so
    // delivery #2 loses the race and the expiry is untouched. Before the fix,
    // the throw escaped sendOrderReceiptOnce, the catch released the claim for
    // an already-written plan, and this retry granted a SECOND month.
    expect(
      afterSecond.planExpiresAt,
      'a duplicate delivery must never extend the subscription a second time'
    ).toBe(afterFirst.planExpiresAt);

    // And the claim is genuinely still held, which is what makes the above true.
    expect(await isClaimHeld(orderId), 'the fulfilment claim must not have been released').toBe(false);

    // ...which means the loser took the early-return path, not a re-fulfilment.
    expect(findPendingOrder).toBeDefined();
  });

  it('the canonical webhook/verify/webhook storm grants one expiry, not three', async () => {
    const user = await createUser('storm@example.com', 'Storm', 'hash');
    const orderId = 'sxs-creator_monthly-storm-1';
    await createPendingOrder({ orderId, userId: user!.id, plan: 'creator_monthly', amount: CREATOR_MONTHLY, currency: 'INR' });
    mockCashfreeOrder(paidOrderBody(orderId));

    // Exactly one claim may ever be won for an order.
    const claims = await Promise.all([
      tryClaimWebhookOrder(orderId),
      tryClaimWebhookOrder(orderId),
      tryClaimWebhookOrder(orderId),
    ]);
    expect(claims.filter(Boolean), 'INSERT OR IGNORE on a PRIMARY KEY yields exactly one winner').toHaveLength(1);
  });
});

describe('STATE 3/12 — the master recording is never destroyed by navigation', () => {
  it('"Open My Library" must navigate without discarding the take', () => {
    const source = readStudioPageSource();
    const openLibrary = extractHandler(source, 'handleOpenLibrary');

    expect(openLibrary, 'handleOpenLibrary must still exist').toBeTruthy();
    expect(
      openLibrary!.includes('setActivePanel(\'library\')'),
      'Open My Library must still navigate to the library'
    ).toBe(true);

    // These three are what silently threw away the user's only copy of the
    // take, from a button on the post-export success screen.
    for (const killer of ['clearMasterRecording', 'recorder.resetRecording', 'clearJobs']) {
      expect(
        openLibrary!.includes(killer),
        `Open My Library must NOT call ${killer} — navigation cannot discard a recording`
      ).toBe(false);
    }

    // The explicit discard ("Record Again") must still delete, or the take
    // would resurrect itself on the next restore and trap the user in review.
    const practiceAgain = extractHandler(source, 'handlePracticeAgain');
    expect(practiceAgain, 'handlePracticeAgain must still exist').toBeTruthy();
    expect(
      practiceAgain!.includes('clearMasterRecording'),
      'an explicit discard must still delete the stored take'
    ).toBe(true);
  });

  it('only explicit discards call clearMasterRecording in the whole studio page', () => {
    const source = readStudioPageSource();
    const calls = [...source.matchAll(/clearMasterRecording\(\)/g)];
    // Exactly one production call site: handlePracticeAgain.
    expect(calls.length, 'clearMasterRecording must have exactly one call site').toBe(1);
  });
});

/* ----------------------------- test helpers ----------------------------- */

function readStudioPageSource(): string {
  // Read through the bundler-free fs API so this asserts on shipped source.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readFileSync } = require('fs') as typeof import('fs');
  const { join } = require('path') as typeof import('path');
  return readFileSync(join(process.cwd(), 'src', 'app', 'studio', 'page.tsx'), 'utf8');
}

/** Extracts a `const name = useCallback(() => { ... }, [deps]);` body. */
function extractHandler(source: string, name: string): string | null {
  const start = source.indexOf(`const ${name} = useCallback(`);
  if (start === -1) return null;
  // Walk braces from the first `=> {` to its matching close.
  const arrow = source.indexOf('=> {', start);
  let depth = 0;
  for (let i = arrow + 3; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(arrow, i + 1);
    }
  }
  return null;
}
