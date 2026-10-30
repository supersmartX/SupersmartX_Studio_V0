import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Refunds and chargebacks are the money-out side of a one-time purchase: there
 * is no mandate to cancel, so the only question is whether access should be
 * revoked. Revoking the wrong account is as damaging as leaving a refunded
 * account active, so the rule is narrow and every ambiguous case is left for an
 * operator (outcome `review`) rather than guessed at.
 *
 * These tests drive the whole decision table through `handleRefundEvent` with
 * the data layer mocked at its module boundary — the same seam the webhook route
 * uses — plus the pure payload helpers.
 */

const db = vi.hoisted(() => ({
  findPendingOrder: vi.fn(),
  findUserById: vi.fn(),
  findLatestFulfilledOrder: vi.fn(),
  revokeUserPlanIfCurrent: vi.fn(),
  tryClaimOrderNotification: vi.fn(),
}));

vi.mock('@/lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...actual,
    findPendingOrder: db.findPendingOrder,
    findUserById: db.findUserById,
    findLatestFulfilledOrder: db.findLatestFulfilledOrder,
    revokeUserPlanIfCurrent: db.revokeUserPlanIfCurrent,
    tryClaimOrderNotification: db.tryClaimOrderNotification,
  };
});

import {
  cashfreeEventType,
  classifyCashfreeEvent,
  readRefundDetails,
  isFullRefund,
  expectedSoleGrantExpiry,
  handleRefundEvent,
} from '@/lib/cashfree-refund';

const ORDER_ID = 'order_refund_1';
const ORDER_AMOUNT = 59.99;
const PROCESSED_AT = '2026-01-15T09:30:00.000Z';
const SOLE_GRANT_EXPIRY = '2027-01-15T09:30:00.000Z';

function refundBody(overrides: Partial<{ type: string; orderId: string; status: string; amount: number }> = {}) {
  return {
    type: overrides.type ?? 'REFUND_SUCCESS',
    data: {
      refund: {
        order_id: overrides.orderId ?? ORDER_ID,
        refund_status: overrides.status ?? 'SUCCESS',
        refund_amount: overrides.amount ?? ORDER_AMOUNT,
      },
    },
  };
}

/** Pending order, current user and latest fulfilled grant all line up. */
function armHappyPath() {
  db.findPendingOrder.mockResolvedValue({
    orderId: ORDER_ID,
    userId: 'user_1',
    plan: 'creator_yearly',
    amount: ORDER_AMOUNT,
    currency: 'USD',
  });
  db.findUserById.mockResolvedValue({
    id: 'user_1',
    email: 'buyer@example.com',
    name: 'Buyer',
    passwordHash: 'hash',
    createdAt: '2026-01-01T00:00:00.000Z',
    plan: 'creator_yearly',
    planExpiresAt: SOLE_GRANT_EXPIRY,
    sessionVersion: 1,
  });
  db.findLatestFulfilledOrder.mockResolvedValue({ orderId: ORDER_ID, processedAt: PROCESSED_AT });
  db.tryClaimOrderNotification.mockResolvedValue(true);
  db.revokeUserPlanIfCurrent.mockResolvedValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('webhook event classification', () => {
  it('reads the modern `type` and the legacy `event_type`', () => {
    expect(cashfreeEventType({ type: 'REFUND_SUCCESS' })).toBe('REFUND_SUCCESS');
    expect(cashfreeEventType({ event_type: ' PAYMENT_CHARGEBACK ' })).toBe('PAYMENT_CHARGEBACK');
    expect(cashfreeEventType({})).toBe('');
    expect(cashfreeEventType(null)).toBe('');
  });

  it('separates refunds, chargebacks and unrelated payment events', () => {
    expect(classifyCashfreeEvent('REFUND_SUCCESS')).toBe('refund');
    expect(classifyCashfreeEvent('PAYMENT_REVERSAL')).toBe('refund');
    expect(classifyCashfreeEvent('PAYMENT_CHARGEBACK')).toBe('chargeback');
    expect(classifyCashfreeEvent('DISPUTE_CREATED')).toBe('chargeback');
    expect(classifyCashfreeEvent('PAYMENT_SUCCESS_WEBHOOK')).toBe('other');
    expect(classifyCashfreeEvent('')).toBe('other');
  });
});

describe('refund payload reading', () => {
  it('reads the documented data.refund shape', () => {
    expect(readRefundDetails(refundBody())).toEqual({
      orderId: ORDER_ID,
      status: 'SUCCESS',
      amount: ORDER_AMOUNT,
    });
  });

  it('accepts the order object as the order reference', () => {
    expect(
      readRefundDetails({ type: 'REFUND_SUCCESS', data: { order: { order_id: 'order_x' } } }),
    ).toEqual({ orderId: 'order_x', status: '', amount: null });
  });

  it('normalises status to upper case', () => {
    expect(readRefundDetails(refundBody({ status: 'processed' }))?.status).toBe('PROCESSED');
  });

  it('returns null when no order can be identified', () => {
    expect(readRefundDetails({ type: 'REFUND_SUCCESS', data: {} })).toBeNull();
    expect(readRefundDetails({ type: 'REFUND_SUCCESS' })).toBeNull();
    expect(readRefundDetails('nope')).toBeNull();
  });

  it('only counts a refund equal to the order total as full', () => {
    expect(isFullRefund(ORDER_AMOUNT, ORDER_AMOUNT)).toBe(true);
    expect(isFullRefund(ORDER_AMOUNT - 0.01, ORDER_AMOUNT)).toBe(true);
    expect(isFullRefund(ORDER_AMOUNT - 0.02, ORDER_AMOUNT)).toBe(false);
    expect(isFullRefund(ORDER_AMOUNT / 2, ORDER_AMOUNT)).toBe(false);
    expect(isFullRefund(null, ORDER_AMOUNT)).toBe(false);
  });

  it('computes the expiry a single grant would produce, clamping month-end', () => {
    expect(expectedSoleGrantExpiry(PROCESSED_AT, 'creator_yearly')).toBe(SOLE_GRANT_EXPIRY);
    expect(expectedSoleGrantExpiry('2026-01-31T00:00:00.000Z', 'creator_monthly'))
      .toBe('2026-02-28T00:00:00.000Z');
    expect(expectedSoleGrantExpiry('not-a-date', 'creator_monthly')).toBeNull();
  });
});

describe('handleRefundEvent — entitlement decisions', () => {
  it('revokes a full refund of the only grant', async () => {
    armHappyPath();

    await expect(handleRefundEvent(refundBody(), 'req_1')).resolves.toBe('revoked');
    expect(db.revokeUserPlanIfCurrent).toHaveBeenCalledWith('user_1', SOLE_GRANT_EXPIRY);
  });

  it('leaves entitlement alone before money has moved back', async () => {
    armHappyPath();

    await expect(handleRefundEvent(refundBody({ status: 'PENDING' }), 'req_2')).resolves.toBe('ignored');
    expect(db.tryClaimOrderNotification).not.toHaveBeenCalled();
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('never auto-revokes a chargeback', async () => {
    armHappyPath();

    await expect(
      handleRefundEvent(refundBody({ type: 'PAYMENT_CHARGEBACK' }), 'req_3'),
    ).resolves.toBe('review');
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('reviews an unreadable payload instead of revoking', async () => {
    armHappyPath();

    await expect(handleRefundEvent({ type: 'REFUND_SUCCESS', data: {} }, 'req_4')).resolves.toBe('review');
    expect(db.findPendingOrder).not.toHaveBeenCalled();
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('reviews a refund of an order it has no record of', async () => {
    armHappyPath();
    db.findPendingOrder.mockResolvedValue(null);

    await expect(handleRefundEvent(refundBody(), 'req_5')).resolves.toBe('review');
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('does not cancel the term on a partial refund, and does not burn the claim', async () => {
    armHappyPath();

    await expect(
      handleRefundEvent(refundBody({ amount: ORDER_AMOUNT / 2 }), 'req_6'),
    ).resolves.toBe('review');
    // A later full refund of the same order must still be able to revoke.
    expect(db.tryClaimOrderNotification).not.toHaveBeenCalled();
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('ignores a duplicate refund event', async () => {
    armHappyPath();
    db.tryClaimOrderNotification.mockResolvedValue(false);

    await expect(handleRefundEvent(refundBody(), 'req_7')).resolves.toBe('ignored');
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('ignores a refund when nothing is granted any more', async () => {
    armHappyPath();
    db.findUserById.mockResolvedValue({
      id: 'user_1',
      email: 'buyer@example.com',
      name: 'Buyer',
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      plan: 'free',
      planExpiresAt: null,
      sessionVersion: 1,
    });

    await expect(handleRefundEvent(refundBody(), 'req_8')).resolves.toBe('ignored');
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
    // The claim must survive: nothing was taken away, so a delivery that arrives
    // after a later grant can still revoke it.
    expect(db.tryClaimOrderNotification).not.toHaveBeenCalled();
  });

  it('reviews a refund that arrives before the order granted anything', async () => {
    armHappyPath();
    db.findUserById.mockResolvedValue({
      id: 'user_1',
      email: 'buyer@example.com',
      name: 'Buyer',
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      plan: 'free',
      planExpiresAt: null,
      sessionVersion: 1,
    });
    // The payment has not been fulfilled yet, so this order never granted a term.
    db.findLatestFulfilledOrder.mockResolvedValue(null);

    await expect(handleRefundEvent(refundBody(), 'req_13')).resolves.toBe('review');
    // Never silent: an operator must see that money went back for an ungranted
    // order, and the claim must stay free for the delivery after the grant.
    expect(db.tryClaimOrderNotification).not.toHaveBeenCalled();
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('reviews when a later order is the latest grant and no term is stored', async () => {
    armHappyPath();
    db.findUserById.mockResolvedValue({
      id: 'user_1',
      email: 'buyer@example.com',
      name: 'Buyer',
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      plan: 'free',
      planExpiresAt: null,
      sessionVersion: 1,
    });
    db.findLatestFulfilledOrder.mockResolvedValue({ orderId: 'order_later', processedAt: PROCESSED_AT });

    await expect(handleRefundEvent(refundBody(), 'req_14')).resolves.toBe('review');
    expect(db.tryClaimOrderNotification).not.toHaveBeenCalled();
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('reviews a refund of an older order when a renewal is stacked on top', async () => {
    armHappyPath();
    db.findLatestFulfilledOrder.mockResolvedValue({ orderId: 'order_later', processedAt: PROCESSED_AT });

    await expect(handleRefundEvent(refundBody(), 'req_9')).resolves.toBe('review');
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('reviews when the stored expiry is not the sole grant of this order', async () => {
    armHappyPath();
    db.findUserById.mockResolvedValue({
      id: 'user_1',
      email: 'buyer@example.com',
      name: 'Buyer',
      passwordHash: 'hash',
      createdAt: '2026-01-01T00:00:00.000Z',
      plan: 'creator_yearly',
      // Two stacked terms, not one.
      planExpiresAt: '2028-01-15T09:30:00.000Z',
      sessionVersion: 1,
    });

    await expect(handleRefundEvent(refundBody(), 'req_10')).resolves.toBe('review');
    expect(db.revokeUserPlanIfCurrent).not.toHaveBeenCalled();
  });

  it('reviews when a renewal lands between the read and the revoke write', async () => {
    armHappyPath();
    db.revokeUserPlanIfCurrent.mockResolvedValue(false);

    await expect(handleRefundEvent(refundBody(), 'req_11')).resolves.toBe('review');
  });

  it('reviews instead of throwing when the data layer fails', async () => {
    armHappyPath();
    db.findPendingOrder.mockRejectedValue(new Error('db down'));

    await expect(handleRefundEvent(refundBody(), 'req_12')).resolves.toBe('review');
  });
});
