import { describe, it, expect } from 'vitest';
import '@/__tests__/helpers/db'; // registers the per-test TRUNCATE isolation
import {
  createUser,
  createPendingOrder,
  findPendingOrder,
  tryClaimWebhookOrder,
} from '@/lib/db';

// Database-backed suite: runs only when DATABASE_URL points at a throwaway
// PostgreSQL database; otherwise the cases are reported as skipped.
const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

// ---------------------------------------------------------------------------
// E. A pending-order write is verified, never assumed. (Formerly part of
//    db-durability.test.ts; the rest of that file is now fully offline.)
// ---------------------------------------------------------------------------

describeDb('createPendingOrder verifies the row actually landed', () => {
  it('persists a payable order and makes it findable by the fulfilment paths', async () => {
    const user = await createUser('verify-buyer@example.com', 'Buyer', 'hash');
    await createPendingOrder({
      orderId: 'o-verify',
      userId: user.id,
      plan: 'creator_monthly',
      amount: 349,
      currency: 'INR',
    });
    expect((await findPendingOrder('o-verify'))?.plan).toBe('creator_monthly');
  });

  it('rejects when a constraint refuses the row, and leaves nothing behind', async () => {
    const user = await createUser('verify-buyer-2@example.com', 'Buyer', 'hash');
    // A NOT NULL violation on `plan` used to be swallowed by `INSERT OR IGNORE`:
    // no row written, no error raised. Returning normally would hand the buyer a
    // payable order the webhook and verify paths can never find — the exact
    // silent failure that turns a paid order into a 404.
    await expect(
      createPendingOrder({
        orderId: 'o-drop',
        userId: user.id,
        plan: null as unknown as string,
        amount: 349,
        currency: 'INR',
      }),
    ).rejects.toThrow(/pending_order_not_persisted/);
    expect(await findPendingOrder('o-drop')).toBeNull();
  });

  it('is idempotent for a duplicate order id', async () => {
    const user = await createUser('verify-buyer-3@example.com', 'Buyer', 'hash');
    await createPendingOrder({
      orderId: 'o-dup',
      userId: user.id,
      plan: 'creator_monthly',
      amount: 349,
      currency: 'INR',
    });
    await expect(
      createPendingOrder({
        orderId: 'o-dup',
        userId: user.id,
        plan: 'creator_monthly',
        amount: 349,
        currency: 'INR',
      }),
    ).resolves.toBeUndefined();
    expect(await tryClaimWebhookOrder('o-dup')).toBe(true);
    expect(await tryClaimWebhookOrder('o-dup')).toBe(false);
  });
});
