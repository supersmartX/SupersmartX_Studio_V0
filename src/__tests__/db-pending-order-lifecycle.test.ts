import { describe, it, expect } from 'vitest';
import '@/__tests__/helpers/db'; // registers the per-test TRUNCATE isolation
import { getPrisma } from '@/lib/db/prisma';
import {
  PendingOrderConflictError,
  acquireCheckoutLock,
  closePendingOrder,
  createUser,
  findPendingOrderClaim,
  findPendingOrderLifecycle,
  listPendingOrdersForOps,
  markPendingOrderFulfilled,
  markPendingOrderHeld,
  markPendingOrderOpen,
  markPendingOrderTerminationRequested,
  recordPendingOrderProbe,
  releaseCheckoutLock,
  reservePendingOrder,
  tryClaimWebhookOrder,
} from '@/lib/db';

/**
 * The database is the last line of defence for W2. These cases exercise the
 * parts an application test cannot: the partial unique index that makes the
 * duplicate-checkout guard real under concurrency, the CHECK constraints that
 * keep closure/hold/termination fields consistent with the status, the
 * status-guarded transitions that stop a stale reader overwriting a newer
 * decision, and the TTL lock that serializes a checkout.
 */

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

async function makeUser(email = 'lifecycle@example.com') {
  return createUser(email, 'Buyer', 'hash');
}

function reserve(userId: string, orderId: string) {
  return reservePendingOrder({
    orderId,
    userId,
    plan: 'creator_monthly',
    amount: 349,
    currency: 'INR',
  });
}

describeDb('pending_orders_one_live_per_user', () => {
  it('rejects a second live checkout for the same user, whatever its live status', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-live-1');

    await expect(reserve(user.id, 'sxs-live-2')).rejects.toBeInstanceOf(PendingOrderConflictError);

    // termination_requested is still live: a payable order may still exist.
    await markPendingOrderTerminationRequested('sxs-live-1');
    await expect(reserve(user.id, 'sxs-live-3')).rejects.toBeInstanceOf(PendingOrderConflictError);
  });

  it('lets a new checkout proceed once the live order is settled', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-done-1');
    await markPendingOrderFulfilled('sxs-done-1');

    await expect(reserve(user.id, 'sxs-done-2')).resolves.toBeUndefined();
    expect((await findPendingOrderLifecycle('sxs-done-2'))?.status).toBe('creating');
  });

  it('does not count a held order as live', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-held-1');
    await markPendingOrderHeld('sxs-held-1', 'claim_unentitled');

    // The hold is an obligation, not a live checkout: a late PAID order must be
    // recordable while the user is allowed to try again.
    await expect(reserve(user.id, 'sxs-held-2')).resolves.toBeUndefined();
  });

  it('allows one live checkout per user independently', async () => {
    const one = await createUser('one@example.com', 'One', 'hash');
    const two = await createUser('two@example.com', 'Two', 'hash');

    await reserve(one.id, 'sxs-a');
    await expect(reserve(two.id, 'sxs-b')).resolves.toBeUndefined();
  });

  it('admits exactly one of several concurrent reservations', async () => {
    const user = await makeUser();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) => reserve(user.id, `sxs-race-${index}`)),
    );

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result) => result.status === 'rejected' && result.reason instanceof PendingOrderConflictError,
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(4);
  });
});

describeDb('pending_orders CHECK constraints', () => {
  async function seed(userId: string, orderId: string) {
    await reserve(userId, orderId);
    await markPendingOrderOpen(orderId);
  }

  it('refuses a status outside the vocabulary', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-1');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders
         SET status = 'abandoned', closed_at = now(), close_reason = 'operator_closed'
         WHERE order_id = 'sxs-check-1'`,
      ),
    ).rejects.toThrow(/pending_orders_status_allowed/);
  });

  it('refuses a fulfilled row without a fulfilment timestamp', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-2');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders SET status = 'fulfilled', closed_at = now(), close_reason = 'paid_fulfilled'
         WHERE order_id = 'sxs-check-2'`,
      ),
    ).rejects.toThrow(/pending_orders_fulfilled_at_matches_status/);
  });

  it('refuses to close a live row without a reason', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-3');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders SET status = 'closed' WHERE order_id = 'sxs-check-3'`,
      ),
    ).rejects.toThrow(/pending_orders_closure_matches_status/);
  });

  it('refuses a close reason outside the documented list', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-4');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders SET status = 'closed', closed_at = now(), close_reason = 'user_cancelled'
         WHERE order_id = 'sxs-check-4'`,
      ),
    ).rejects.toThrow(/pending_orders_close_reason_allowed/);
  });

  it('refuses hold data on a live row', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-5');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders SET held_at = now(), hold_reason = 'fulfilment_failed'
         WHERE order_id = 'sxs-check-5'`,
      ),
    ).rejects.toThrow(/pending_orders_hold_only_when_closed/);
  });

  it('refuses a held row without hold details', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-6');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders
         SET status = 'held_review', closed_at = now(), close_reason = 'held_unapplied'
         WHERE order_id = 'sxs-check-6'`,
      ),
    ).rejects.toThrow(/pending_orders_held_matches_status/);
  });

  it('refuses a hold reason outside the documented list', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-7');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders
         SET status = 'held_review', held_at = now(), hold_reason = 'looks_suspicious',
             closed_at = now(), close_reason = 'held_unapplied'
         WHERE order_id = 'sxs-check-7'`,
      ),
    ).rejects.toThrow(/pending_orders_hold_reason_allowed/);
  });

  it('refuses a termination timestamp on a state that never asked', async () => {
    const user = await makeUser();
    await seed(user.id, 'sxs-check-8');

    await expect(
      getPrisma().$executeRawUnsafe(
        `UPDATE pending_orders SET termination_requested_at = now() WHERE order_id = 'sxs-check-8'`,
      ),
    ).rejects.toThrow(/pending_orders_termination_only_when_requested/);
  });
});

describeDb('status-guarded transitions', () => {
  it('never reopens or re-closes a settled order', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-guard-1');
    await markPendingOrderFulfilled('sxs-guard-1');

    expect(await markPendingOrderOpen('sxs-guard-1')).toBe(false);
    expect(await closePendingOrder('sxs-guard-1', 'gateway_expired')).toBe(false);
    expect((await findPendingOrderLifecycle('sxs-guard-1'))?.status).toBe('fulfilled');
  });

  it('does not let a stale hold overwrite a settled order', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-guard-2');
    await markPendingOrderFulfilled('sxs-guard-2');

    await markPendingOrderHeld('sxs-guard-2', 'fulfilment_failed');

    expect((await findPendingOrderLifecycle('sxs-guard-2'))?.status).toBe('fulfilled');
  });

  it('records the settlement, with the closure and reason the constraints expect', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-guard-3');
    await markPendingOrderFulfilled('sxs-guard-3');

    const row = await findPendingOrderLifecycle('sxs-guard-3');
    expect(row).toMatchObject({ status: 'fulfilled', closeReason: 'paid_fulfilled' });
    expect(row?.fulfilledAt).toBeTruthy();
    expect(row?.closedAt).toBeTruthy();
  });

  it('stamps the termination request once and keeps the first timestamp', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-guard-4');
    await markPendingOrderOpen('sxs-guard-4');
    await markPendingOrderTerminationRequested('sxs-guard-4');

    const first = await findPendingOrderLifecycle('sxs-guard-4');
    expect(first?.status).toBe('termination_requested');
    expect(first?.terminationSentAt).toBeTruthy();

    await new Promise((resolve) => setTimeout(resolve, 20));
    await markPendingOrderTerminationRequested('sxs-guard-4');

    const second = await findPendingOrderLifecycle('sxs-guard-4');
    expect(second?.terminationSentAt).toBe(first?.terminationSentAt);
  });

  it('closes only from the statuses the caller allowed', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-guard-5');
    await markPendingOrderOpen('sxs-guard-5');

    expect(await closePendingOrder('sxs-guard-5', 'gateway_expired', ['held_review'])).toBe(false);
    expect(await closePendingOrder('sxs-guard-5', 'gateway_expired', ['open'])).toBe(true);

    const row = await findPendingOrderLifecycle('sxs-guard-5');
    expect(row).toMatchObject({ status: 'closed', closeReason: 'gateway_expired' });
  });
});

describeDb('probe accounting', () => {
  it('counts confirmed misses, clears on a hit, and ignores live orders', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-probe-1');

    const first = await recordPendingOrderProbe('sxs-probe-1', 'not_found');
    expect(first?.probeCount).toBe(1);
    expect(first?.firstProbedAt).toBeTruthy();

    const second = await recordPendingOrderProbe('sxs-probe-1', 'not_found');
    expect(second?.probeCount).toBe(2);
    expect(second?.firstProbedAt?.toISOString()).toBe(first?.firstProbedAt?.toISOString());

    // An uncertain answer must not move an orphan one step closer to release.
    const uncertain = await recordPendingOrderProbe('sxs-probe-1', 'uncertain');
    expect(uncertain?.probeCount).toBe(2);

    const found = await recordPendingOrderProbe('sxs-probe-1', 'found');
    expect(found?.probeCount).toBe(0);
    expect(found?.firstProbedAt).toBeNull();

    await markPendingOrderOpen('sxs-probe-1');
    expect(await recordPendingOrderProbe('sxs-probe-1', 'not_found')).toBeNull();
  });
});

describeDb('findPendingOrderClaim', () => {
  it('reports the claim and the exact per-order marker separately', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-claim-1');

    expect(await findPendingOrderClaim('sxs-claim-1')).toEqual({ claimed: false, entitled: false });

    await tryClaimWebhookOrder('sxs-claim-1');
    // A claim whose grant never committed is exactly the crash window W8 must
    // not rule out: it reads as claimed-but-unentitled.
    expect(await findPendingOrderClaim('sxs-claim-1')).toEqual({ claimed: true, entitled: false });

    // An expiry the account happens to hold is NOT evidence for this order: a
    // renewal bought while a plan is live leaves this exact shape, and so does
    // a crash between the claim and the grant.
    await getPrisma().user.update({
      where: { id: user.id },
      data: { plan: 'creator_monthly', planExpiresAt: new Date(Date.now() + 30 * 86_400_000) },
    });
    expect(await findPendingOrderClaim('sxs-claim-1')).toEqual({ claimed: true, entitled: false });

    // Only the order's own marker proves its grant committed with it.
    await markPendingOrderFulfilled('sxs-claim-1');
    expect(await findPendingOrderClaim('sxs-claim-1')).toEqual({ claimed: true, entitled: true });
  });

  it('reports nothing for an unknown order', async () => {
    expect(await findPendingOrderClaim('sxs-unknown')).toBeNull();
  });
});

describeDb('listPendingOrdersForOps', () => {
  it('reports the stored amount as a number and the claim evidence beside it', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-ops-1');
    await markPendingOrderHeld('sxs-ops-1', 'claim_unentitled');
    await tryClaimWebhookOrder('sxs-ops-1');

    const rows = await listPendingOrdersForOps({ statuses: ['held_review'], limit: 10 });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orderId: 'sxs-ops-1',
      status: 'held_review',
      holdReason: 'claim_unentitled',
      amount: 349,
      currency: 'INR',
    });
    expect(rows[0].processedAt).toBeTruthy();
    expect(rows[0].planExpiresAt).toBeNull();
    expect(rows[0].userPlan).toBe('free');
  });

  it('filters by the requested statuses', async () => {
    const user = await makeUser();
    await reserve(user.id, 'sxs-ops-2');

    expect(await listPendingOrdersForOps({ statuses: ['held_review'], limit: 10 })).toHaveLength(0);
    expect(await listPendingOrdersForOps({ statuses: ['creating'], limit: 10 })).toHaveLength(1);
  });
});

describeDb('checkout_locks', () => {
  it('grants the lock to one holder and refuses the next until release', async () => {
    const user = await makeUser();

    expect(await acquireCheckoutLock(user.id, 'token-a', 60_000)).toBe(true);
    expect(await acquireCheckoutLock(user.id, 'token-b', 60_000)).toBe(false);

    // A release with the wrong token must not free someone else's lock.
    await releaseCheckoutLock(user.id, 'token-b');
    expect(await acquireCheckoutLock(user.id, 'token-c', 60_000)).toBe(false);

    await releaseCheckoutLock(user.id, 'token-a');
    expect(await acquireCheckoutLock(user.id, 'token-c', 60_000)).toBe(true);
  });

  it('lets an expired lock be taken over', async () => {
    const user = await makeUser();

    // Expiry is measured against the ttl the caller asks for: a holder that
    // died is only displaced once its row is older than that ttl.
    expect(await acquireCheckoutLock(user.id, 'stale-holder', 1)).toBe(true);
    expect(await acquireCheckoutLock(user.id, 'too-soon', 60_000)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await acquireCheckoutLock(user.id, 'new-holder', 1)).toBe(true);
  });

  it('serializes holders per user, not globally', async () => {
    const one = await createUser('lock-one@example.com', 'One', 'hash');
    const two = await createUser('lock-two@example.com', 'Two', 'hash');

    expect(await acquireCheckoutLock(one.id, 't1', 60_000)).toBe(true);
    expect(await acquireCheckoutLock(two.id, 't2', 60_000)).toBe(true);
  });
});
