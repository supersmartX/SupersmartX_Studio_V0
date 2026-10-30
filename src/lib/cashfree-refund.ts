import { addPlanTerm, planTermInterval } from '@/lib/entitlements';
import {
  findLatestFulfilledOrder,
  findPendingOrder,
  findUserById,
  revokeUserPlanIfCurrent,
  tryClaimOrderNotification,
} from '@/lib/db';
import { logger, hashUserId } from '@/lib/observe/logger';

/**
 * Refund / chargeback handling for the one-time purchase model.
 *
 * There is no mandate and no dunning, so the only money-out event that matters
 * is a reversal of a settled order. A refund is an entitlement change and has
 * to be applied server-side: leaving the plan active after the money came back
 * is a paid feature given away, and revoking the wrong account is a chargeback
 * of its own.
 *
 * The rule is deliberately narrow. Entitlement is revoked only when ALL of the
 * following hold, otherwise the event is logged for manual review:
 *
 *   1. it is a full refund (a partial refund does not cancel the term),
 *   2. the refunded order is the user's most recently fulfilled order, and
 *   3. the stored expiry is exactly the expiry that order alone would have
 *      produced — i.e. no later renewal is stacked on top of it.
 *
 * A refund that arrives before the order granted anything (the payment webhook
 * was still failing when the money went back) is also `review`: it is never
 * answered with a silent `ignored`, because a payment event settling later
 * would otherwise grant a term nobody notices is refunded.
 *
 * A chargeback is never auto-revoked: the dispute may still be lost by the
 * bank's side, and the outcome arrives as a separate event. It is logged for an
 * operator instead.
 *
 * NOTE: the payload shapes read here follow Cashfree's documented
 * `data.refund` webhook (order_id / refund_status / refund_amount) but no live
 * refund has been observed against this account. Anything unrecognised falls
 * through to `review` — it can never revoke by accident.
 */

export type CashfreeEventKind = 'refund' | 'chargeback' | 'other';

/** Lower-case event type from either the `type` or legacy `event_type` field. */
export function cashfreeEventType(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const record = body as Record<string, unknown>;
  const value = record.type ?? record.event_type;
  return typeof value === 'string' ? value.trim() : '';
}

export function classifyCashfreeEvent(type: string): CashfreeEventKind {
  if (/chargeback|dispute/i.test(type)) return 'chargeback';
  if (/refund|reversal/i.test(type)) return 'refund';
  return 'other';
}

export interface RefundDetails {
  orderId: string;
  status: string;
  amount: number | null;
}

/**
 * Reads the refund portion of a webhook body. Returns null when the event
 * carries no order reference at all (nothing can be acted on).
 */
export function readRefundDetails(body: unknown): RefundDetails | null {
  if (!body || typeof body !== 'object') return null;
  const data = (body as Record<string, unknown>).data;
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  const refund = (record.refund && typeof record.refund === 'object' ? record.refund : {}) as Record<string, unknown>;
  const order = (record.order && typeof record.order === 'object' ? record.order : {}) as Record<string, unknown>;

  const rawOrderId = refund.order_id ?? order.order_id;
  if (typeof rawOrderId !== 'string' || rawOrderId.length === 0) return null;

  const rawStatus = refund.refund_status ?? refund.status ?? '';
  const rawAmount = refund.refund_amount ?? refund.amount;

  return {
    orderId: rawOrderId,
    status: typeof rawStatus === 'string' ? rawStatus.toUpperCase() : '',
    amount: typeof rawAmount === 'number' ? rawAmount : null,
  };
}

/** A refund equal to the order total within a cent; anything less is partial. */
export function isFullRefund(refundAmount: number | null, orderAmount: number): boolean {
  if (refundAmount === null || !Number.isFinite(refundAmount)) return false;
  return Math.abs(refundAmount - orderAmount) <= 0.01;
}

/** Expiry a single fulfilled order would have produced on its own. */
export function expectedSoleGrantExpiry(processedAt: string, plan: string): string | null {
  const grantedAt = new Date(processedAt);
  if (Number.isNaN(grantedAt.getTime())) return null;
  const period = planTermInterval(plan) === '1 year' ? 'yearly' : 'monthly';
  return addPlanTerm(grantedAt, period).toISOString();
}

// Clock/precision allowance when comparing the stored expiry with the expected
// sole-grant expiry. The grant write happens milliseconds after the claim row,
// while any real renewal adds at least a month — so a minute is generous
// without ever masking a stacked term.
const EXPIRY_MATCH_TOLERANCE_MS = 60_000;

export type RefundOutcome = 'revoked' | 'ignored' | 'review';

/**
 * Applies a verified refund webhook. Total: never throws, so a malformed or
 * unexpected payload cannot turn into a webhook retry loop.
 */
export async function handleRefundEvent(body: unknown, requestId: string): Promise<RefundOutcome> {
  const type = cashfreeEventType(body);
  const kind = classifyCashfreeEvent(type);
  const details = readRefundDetails(body);

  if (!details) {
    logger.warn('payment.refund_unreadable', { route: '/api/cashfree/webhook', requestId, eventType: type.slice(0, 80) });
    return 'review';
  }

  try {
    if (kind === 'chargeback') {
      logger.warn('payment.chargeback_received', {
        route: '/api/cashfree/webhook',
        requestId,
        orderId: details.orderId,
        eventType: type.slice(0, 80),
        review: 'entitlement left in place pending dispute outcome',
      });
      return 'review';
    }

    if (details.status !== 'SUCCESS' && details.status !== 'PROCESSED') {
      // PENDING / FAILED / CANCELLED: no money has moved back yet.
      return 'ignored';
    }

    const pending = await findPendingOrder(details.orderId);
    if (!pending) {
      logger.warn('payment.refund_unknown_order', { route: '/api/cashfree/webhook', requestId, orderId: details.orderId });
      return 'review';
    }

    // A partial refund does not cancel the term. Checked BEFORE claiming so a
    // later full refund of the same order is still processed.
    if (!isFullRefund(details.amount, pending.amount)) {
      logger.warn('payment.refund_partial', {
        route: '/api/cashfree/webhook',
        requestId,
        orderId: details.orderId,
        review: 'partial refund does not cancel the purchased term',
      });
      return 'review';
    }

    // Decide whether anything can be taken away BEFORE claiming. A refund can
    // arrive before the payment has been fulfilled (the payment webhook was
    // still failing when the order was refunded), and claiming first would burn
    // the only `refund_success` slot for an order that never granted anything —
    // so a grant that landed later could never be reversed. Checking first costs
    // no safety: the revoke below is a compare-and-set, so two deliveries that
    // both get this far still revoke at most once.
    const user = await findUserById(pending.userId);
    if (!user || !user.planExpiresAt || user.plan === 'free') {
      const latest = await findLatestFulfilledOrder(pending.userId);
      if (latest?.orderId === details.orderId) {
        // This order's own term is already gone — lapsed, or revoked by an
        // earlier delivery of this same event. Nothing left to take away.
        return 'ignored';
      }
      // Money went back for an order that granted no access, so there is
      // nothing to revoke and nothing may be assumed: an operator has to
      // confirm the buyer holds no term, and a payment event that settles after
      // this refund must not quietly resurrect one.
      logger.warn('payment.refund_before_fulfilment', {
        route: '/api/cashfree/webhook',
        requestId,
        orderId: details.orderId,
        userIdHash: hashUserId(user?.id ?? pending.userId),
        review: 'refund received before the order granted an entitlement',
      });
      return 'review';
    }

    // Claim before mutating, so a duplicate refund event cannot revoke twice or
    // race an operator. Losing the claim means it was already handled.
    const claimed = await tryClaimOrderNotification(details.orderId, 'refund_success');
    if (!claimed) return 'ignored';

    const latest = await findLatestFulfilledOrder(user.id);
    if (!latest || latest.orderId !== details.orderId) {
      logger.warn('payment.refund_not_latest_grant', {
        route: '/api/cashfree/webhook',
        requestId,
        orderId: details.orderId,
        userIdHash: hashUserId(user.id),
        review: 'a later purchase is stacked on top; operator must decide the reversal',
      });
      return 'review';
    }

    const expected = expectedSoleGrantExpiry(latest.processedAt, pending.plan);
    if (
      !expected ||
      Math.abs(new Date(user.planExpiresAt).getTime() - new Date(expected).getTime()) >
        EXPIRY_MATCH_TOLERANCE_MS
    ) {
      logger.warn('payment.refund_expiry_mismatch', {
        route: '/api/cashfree/webhook',
        requestId,
        orderId: details.orderId,
        userIdHash: hashUserId(user.id),
        review: 'stored expiry is not the sole grant of this order; not revoking automatically',
      });
      return 'review';
    }

    // Compare-and-set on the exact expiry: if a renewal landed between the read
    // above and this write, the match fails and the entitlement is preserved.
    const revoked = await revokeUserPlanIfCurrent(user.id, user.planExpiresAt);
    if (!revoked) {
      logger.warn('payment.refund_revoke_raced', {
        route: '/api/cashfree/webhook',
        requestId,
        orderId: details.orderId,
        userIdHash: hashUserId(user.id),
      });
      return 'review';
    }

    logger.info('payment.refund_revoked', {
      route: '/api/cashfree/webhook',
      requestId,
      orderId: details.orderId,
      userIdHash: hashUserId(user.id),
    });
    return 'revoked';
  } catch (error) {
    logger.error('payment.refund_failed', {
      route: '/api/cashfree/webhook',
      requestId,
      orderId: details.orderId,
      errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    });
    return 'review';
  }
}
