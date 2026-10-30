import {
  fulfillPaidOrder,
  sendOrderReceiptOnce,
  type CashfreeOrder,
  type FulfillmentResult,
  type PendingOrder,
} from '@/lib/cashfree-fulfillment';
import {
  closePendingOrder,
  findPendingOrderClaim,
  findPendingOrderLifecycle,
  findPendingOrdersForReconcile,
  markPendingOrderFulfilled,
  markPendingOrderHeld,
  markPendingOrderOpen,
  markPendingOrderTerminationRequested,
  recordPendingOrderProbe,
  releaseOrderNotification,
  touchPendingOrder,
  tryClaimOrderNotification,
  type PendingOrderLifecycleRow,
  type PendingOrderOpsRow,
} from '@/lib/db';
import { sendBillingOpsAlert } from '@/lib/email';
import { hashUserId, logger } from '@/lib/observe/logger';
import {
  ABANDONED_AFTER_MS,
  CREATING_GRACE_MS,
  HELD_RETRY_HINT_S,
  ORPHAN_PROBE_INTERVAL_MS,
  ORPHAN_PROBE_REQUIRED,
  ORPHAN_PROBE_SPAN_MS,
  RECONCILE_ROW_CAP,
  STUCK_TERMINATION_ALERT_MS,
  TERMINATION_RETRY_HINT_S,
  classifyGatewayOrder,
  pollCashfreeOrder,
  probeCashfreeOrder,
  terminateCashfreeOrder,
  type CloseReason,
  type HoldReason,
} from '@/lib/cashfree-order-lifecycle';

/**
 * Reconciliation of a user's checkout orders.
 *
 * The rule this module exists to enforce: a new payable order is created only
 * after every earlier order that could still be paid has been resolved against
 * the gateway. Nothing here releases an order because it is old. Age decides
 * only *when* an `open` order is abandoned (and therefore terminated); a
 * confirmed gateway answer decides what happens next.
 *
 * A payment is always settled before any other transition is considered, and a
 * rejection parks the order in `held_review` — outside the unique index, so a
 * late payment is recordable even while another checkout is live, and visible
 * to the operator either way. Nothing in this module refunds, terminates a
 * payment, or writes an entitlement outside `fulfillPaidOrder`.
 */

export interface ReconcileContext {
  requestId: string;
  /** Where this pass came from — checkout attempts and operator runs log apart. */
  source: 'checkout' | 'ops';
}

export interface CheckoutBlock {
  httpStatus: 409 | 503;
  body: {
    error: string;
    code: string;
    retryAfterSeconds: number;
    orderId: string;
    paymentSessionId?: string | null;
    amount?: number | null;
    currency?: string | null;
    plan?: string | null;
    status?: string | null;
    supportReference?: string;
  };
}

export type CheckoutReconcileResult = { ok: true } | { ok: false; block: CheckoutBlock };

type RowOutcome = {
  state: 'closed' | 'fulfilled' | 'held' | 'live' | 'terminating' | 'creating' | 'uncertain';
  row: PendingOrderLifecycleRow;
  gateway?: CashfreeOrder;
  note?: string;
};

function pendingFrom(row: PendingOrderLifecycleRow): PendingOrder {
  return {
    orderId: row.orderId,
    userId: row.userId,
    plan: row.plan,
    amount: row.amount,
    currency: row.currency,
  };
}

function elapsedSince(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? Date.now() - at : Number.POSITIVE_INFINITY;
}

/**
 * Sends one operator alert per order and kind. The log line is written every
 * time (it is the operational trail); the email is deduped through
 * `order_notifications` so a stuck order does not email on every page view.
 */
async function alertOnce(
  orderId: string,
  kind: 'ops_held_review' | 'ops_termination_stuck' | 'ops_termination_refused',
  subject: string,
  lines: string[],
): Promise<void> {
  const claimed = await tryClaimOrderNotification(orderId, kind).catch(() => false);
  if (!claimed) return;
  const sent = await sendBillingOpsAlert({ subject, lines }).catch(() => false);
  if (!sent) await releaseOrderNotification(orderId, kind).catch(() => undefined);
}

/**
 * Settles a PAID order through the same atomic transaction the webhook and the
 * return trip use.
 *
 * The transaction is the evidence rule: a fulfilled order has a `fulfilled_at`
 * marker committed together with its grant. A claim with no marker is therefore
 * *not* proof of fulfilment and becomes a review case instead of a second
 * grant. Nothing here releases or re-creates a claim around the write — a
 * throw leaves the order exactly as it was.
 */
async function settleIfPaid(
  row: PendingOrderLifecycleRow,
  order: CashfreeOrder,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  let result: FulfillmentResult;
  try {
    result = await fulfillPaidOrder(pendingFrom(row), order);
  } catch (error) {
    // The settlement transaction rolled back, so there is no claim to release
    // and no partial grant to reconcile — only the obligation to surface it.
    await markPendingOrderHeld(row.orderId, 'fulfilment_failed' satisfies HoldReason);
    logger.error('payment.order_held_review', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      userIdHash: hashUserId(row.userId),
      holdReason: 'fulfilment_failed',
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    await alertOnce(
      row.orderId,
      'ops_held_review',
      'Payment received but not applied — review required',
      [
        `Order ${row.orderId} is PAID at Cashfree but the settlement transaction failed.`,
        'It rolled back atomically: no claim and no grant were written. The order is held for review.',
      ],
    );
    return { state: 'held', row, gateway: order };
  }

  if (!result.ok && result.state === 'in_progress') {
    await parkUnentitled(row, ctx);
    return { state: 'held', row, gateway: order };
  }

  if (!result.ok) {
    await markPendingOrderHeld(row.orderId, 'fulfilment_rejected' satisfies HoldReason);
    logger.error('payment.order_held_review', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      userIdHash: hashUserId(row.userId),
      holdReason: 'fulfilment_rejected',
      rejection: result.reason,
    });
    await alertOnce(
      row.orderId,
      'ops_held_review',
      'Payment received but not applied — review required',
      [
        `Order ${row.orderId} is PAID at Cashfree but was rejected by fulfilment (${result.reason}).`,
        `Stored: ${row.plan} ${row.amount} ${row.currency}. The buyer is blocked from new checkout.`,
      ],
    );
    return { state: 'held', row, gateway: order };
  }

  await sendReceipt(row, order);
  logger.info('payment.order_fulfilled_reconciled', {
    route: 'pending-order-reconcile',
    requestId: ctx.requestId,
    orderId: row.orderId,
    userIdHash: hashUserId(row.userId),
    alreadySettled: result.state === 'already_fulfilled',
  });
  return { state: 'fulfilled', row, gateway: order };
}

/** A claim without the order's own fulfilment marker: never granted automatically. */
async function parkUnentitled(row: PendingOrderLifecycleRow, ctx: ReconcileContext): Promise<void> {
  await markPendingOrderHeld(row.orderId, 'claim_unentitled' satisfies HoldReason);
  logger.error('payment.order_held_review', {
    route: 'pending-order-reconcile',
    requestId: ctx.requestId,
    orderId: row.orderId,
    userIdHash: hashUserId(row.userId),
    holdReason: 'claim_unentitled',
  });
  await alertOnce(
    row.orderId,
    'ops_held_review',
    'Claimed order has no entitlement — review required',
    [
      `Order ${row.orderId} has a fulfilment claim but the user's stored expiry does not corroborate it.`,
      'This is usually a crash between the claim and the plan write. It was NOT auto-fulfilled.',
    ],
  );
}

/** The receipt is best-effort in every path (see sendOrderReceiptOnce). */
async function sendReceipt(row: PendingOrderLifecycleRow, order: CashfreeOrder): Promise<void> {
  try {
    await sendOrderReceiptOnce(pendingFrom(row), order);
  } catch {
    // sendOrderReceiptOnce is total; this is belt and braces around the caller.
  }
}

/** The 3-probe orphan protocol, shared by `creating` and `unverified` rows. */
async function orphanProbe(
  row: PendingOrderLifecycleRow,
  outcome: 'found' | 'not_found',
): Promise<{ closed: boolean; probes: number }> {
  const record = await recordPendingOrderProbe(row.orderId, outcome);
  if (outcome === 'found') return { closed: false, probes: 0 };
  const probes = record?.probeCount ?? 1;
  const firstAt = record?.firstProbedAt ? record.firstProbedAt.getTime() : Date.now();
  const span = Date.now() - firstAt;
  if (probes >= ORPHAN_PROBE_REQUIRED && span >= ORPHAN_PROBE_SPAN_MS) {
    await closePendingOrder(row.orderId, 'orphaned_no_gateway_record' satisfies CloseReason, [
      'creating',
      'unverified',
    ]);
    return { closed: true, probes };
  }
  return { closed: false, probes };
}

/**
 * A reserved order whose create outcome is unknown.
 *
 * Released only by repeated, spaced, confirmed 404s. A 200 adopts whatever the
 * gateway actually has — the create may have landed even though this process
 * never saw the response.
 */
async function reconcileCreating(
  row: PendingOrderLifecycleRow,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  if (elapsedSince(row.createdAt) < CREATING_GRACE_MS) return { state: 'creating', row };
  if (elapsedSince(row.lastCheckedAt) < ORPHAN_PROBE_INTERVAL_MS) {
    return { state: 'creating', row, note: 'probe_spacing' };
  }

  const probe = await probeCashfreeOrder(row.orderId);
  if (probe.kind === 'uncertain') {
    await touchPendingOrder(row.orderId);
    logger.warn('payment.order_probe_uncertain', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      reason: probe.reason,
    });
    return { state: 'uncertain', row, note: probe.reason };
  }
  if (probe.kind === 'not_found') {
    const result = await orphanProbe(row, 'not_found');
    if (result.closed) {
      logger.warn('payment.order_orphaned_closed', {
        route: 'pending-order-reconcile',
        requestId: ctx.requestId,
        orderId: row.orderId,
        probes: result.probes,
      });
      return { state: 'closed', row };
    }
    return { state: 'creating', row, note: `orphan_probe_${result.probes}` };
  }

  await orphanProbe(row, 'found');
  const state = classifyGatewayOrder(probe.order);
  if (state === 'paid') return settleIfPaid(row, probe.order, ctx);
  if (state === 'expired') {
    await closePendingOrder(row.orderId, 'gateway_expired' satisfies CloseReason, ['creating']);
    return { state: 'closed', row, gateway: probe.order };
  }
  if (state === 'terminated') {
    await closePendingOrder(row.orderId, 'gateway_terminated' satisfies CloseReason, ['creating']);
    return { state: 'closed', row, gateway: probe.order };
  }
  if (state === 'unknown') {
    await touchPendingOrder(row.orderId);
    return { state: 'uncertain', row, note: 'unknown_order_status' };
  }

  // The create did land. From here it is an ordinary open order — including the
  // staleness rule, so a reservation that landed late cannot become a second
  // payable order.
  await markPendingOrderOpen(row.orderId);
  return reconcileOpen({ ...row, status: 'open' }, ctx);
}

async function reconcileOpen(
  row: PendingOrderLifecycleRow,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  const probe = await probeCashfreeOrder(row.orderId);
  if (probe.kind === 'uncertain') {
    await touchPendingOrder(row.orderId);
    logger.warn('payment.order_probe_uncertain', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      reason: probe.reason,
    });
    return { state: 'uncertain', row, note: probe.reason };
  }
  if (probe.kind === 'not_found') {
    // A created order the gateway does not know is a contradiction, not proof
    // of absence. Fail closed and let an operator resolve it.
    await touchPendingOrder(row.orderId);
    return { state: 'uncertain', row, note: 'order_missing_at_gateway' };
  }

  const state = classifyGatewayOrder(probe.order);
  if (state === 'paid') return settleIfPaid(row, probe.order, ctx);
  if (state === 'expired') {
    await closePendingOrder(row.orderId, 'gateway_expired' satisfies CloseReason, ['open']);
    return { state: 'closed', row, gateway: probe.order };
  }
  if (state === 'terminated') {
    await closePendingOrder(row.orderId, 'gateway_terminated' satisfies CloseReason, ['open']);
    return { state: 'closed', row, gateway: probe.order };
  }
  if (state === 'terminating') {
    await markPendingOrderTerminationRequested(row.orderId);
    return { state: 'terminating', row, gateway: probe.order };
  }
  if (state === 'active') {
    if (elapsedSince(row.createdAt) < ABANDONED_AFTER_MS) {
      await touchPendingOrder(row.orderId);
      return { state: 'live', row, gateway: probe.order };
    }
    return terminateAbandoned(row, ctx);
  }
  await touchPendingOrder(row.orderId);
  return { state: 'uncertain', row, note: 'unknown_order_status' };
}

/**
 * Terminates an abandoned order and waits for a confirmed terminal status.
 *
 * A kill request that is accepted but not confirmed leaves the row in
 * `termination_requested` — still blocking — because a payable order may still
 * exist at the gateway. A refusal is surfaced (and alerted) rather than
 * bypassed.
 */
async function terminateAbandoned(
  row: PendingOrderLifecycleRow,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  // The same rule serves a live checkout and a historical `unverified` row, so
  // the terminal close must name the status this row actually holds. Closing
  // with a hard-coded `open` would match no row for a historical order: the
  // gateway kill would be confirmed while the local row silently stayed
  // unclassified and kept reappearing in every operator report.
  const from = row.status === 'unverified' ? ['unverified'] : ['open'];
  const kill = await terminateCashfreeOrder(row.orderId);
  if (kill.kind === 'not_found' || kill.kind === 'uncertain') {
    await touchPendingOrder(row.orderId);
    logger.warn('payment.order_termination_uncertain', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      reason: kill.kind === 'uncertain' ? kill.reason : 'not_found',
    });
    return { state: 'uncertain', row, note: 'termination_uncertain' };
  }
  if (kill.kind === 'refused') {
    await touchPendingOrder(row.orderId);
    logger.error('payment.order_termination_refused', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      httpStatus: kill.status,
    });
    await alertOnce(
      row.orderId,
      'ops_termination_refused',
      'Cashfree refused to terminate an abandoned order',
      [
        `Order ${row.orderId} is older than the abandoned threshold but Cashfree refused the termination (HTTP ${kill.status}).`,
        'No replacement order was created. Check the API version and the order state by hand.',
      ],
    );
    return { state: 'uncertain', row, note: `termination_refused_${kill.status}` };
  }

  if (classifyGatewayOrder(kill.order) === 'paid') {
    return settleIfPaid(row, kill.order, ctx);
  }

  const final = await pollCashfreeOrder(row.orderId);
  if (final.kind === 'found') {
    const state = classifyGatewayOrder(final.order);
    if (state === 'paid') return settleIfPaid(row, final.order, ctx);
    if (state === 'terminated') {
      await closePendingOrder(row.orderId, 'gateway_terminated' satisfies CloseReason, from);
      return { state: 'closed', row, gateway: final.order };
    }
    if (state === 'expired') {
      await closePendingOrder(row.orderId, 'gateway_expired' satisfies CloseReason, from);
      return { state: 'closed', row, gateway: final.order };
    }
  }

  await markPendingOrderTerminationRequested(row.orderId);
  logger.warn('payment.order_termination_pending', {
    route: 'pending-order-reconcile',
    requestId: ctx.requestId,
    orderId: row.orderId,
  });
  return { state: 'terminating', row, note: 'termination_not_confirmed' };
}

async function reconcileTerminating(
  row: PendingOrderLifecycleRow,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  const poll = await pollCashfreeOrder(row.orderId);
  if (poll.kind === 'found') {
    const state = classifyGatewayOrder(poll.order);
    if (state === 'paid') return settleIfPaid(row, poll.order, ctx);
    if (state === 'terminated') {
      await closePendingOrder(row.orderId, 'gateway_terminated' satisfies CloseReason, [
        'termination_requested',
      ]);
      return { state: 'closed', row, gateway: poll.order };
    }
    if (state === 'expired') {
      await closePendingOrder(row.orderId, 'gateway_expired' satisfies CloseReason, [
        'termination_requested',
      ]);
      return { state: 'closed', row, gateway: poll.order };
    }
  }

  await markPendingOrderTerminationRequested(row.orderId);
  if (elapsedSince(row.terminationSentAt) >= STUCK_TERMINATION_ALERT_MS) {
    logger.error('payment.order_termination_stuck', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      userIdHash: hashUserId(row.userId),
      pendingMs: elapsedSince(row.terminationSentAt),
    });
    await alertOnce(
      row.orderId,
      'ops_termination_stuck',
      'Order termination unconfirmed for too long',
      [
        `Order ${row.orderId} has been in TERMINATION_REQUESTED for more than 15 minutes.`,
        'Checkout for this user stays blocked (fail closed) until Cashfree confirms.',
      ],
    );
  }
  return { state: 'terminating', row, note: 'termination_not_confirmed' };
}

/**
 * A held order is retried before anything else: self-healing is what makes a
 * hold temporary rather than a support ticket.
 *
 * Only a gateway-confirmed terminal *unpaid* state can void the hold. A paid
 * order, or one whose state cannot be read, stays held — never released by
 * timeout.
 */
async function reconcileHeld(
  row: PendingOrderLifecycleRow,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  if (row.holdReason === 'claim_unentitled') {
    const claim = await findPendingOrderClaim(row.orderId);
    if (claim?.claimed && claim.entitled) {
      await markPendingOrderFulfilled(row.orderId);
      return { state: 'fulfilled', row };
    }
  }

  const probe = await probeCashfreeOrder(row.orderId);
  if (probe.kind === 'uncertain') {
    await touchPendingOrder(row.orderId);
    return { state: 'held', row, note: probe.reason };
  }
  if (probe.kind === 'not_found') {
    // Not proof of anything for an order we recorded a create for.
    await touchPendingOrder(row.orderId);
    return { state: 'held', row, note: 'order_missing_at_gateway' };
  }

  const state = classifyGatewayOrder(probe.order);
  if (state === 'paid') return settleIfPaid(row, probe.order, ctx);
  if (state === 'expired' || state === 'terminated') {
    await closePendingOrder(row.orderId, 'hold_void_unpaid' satisfies CloseReason, ['held_review']);
    logger.warn('payment.order_hold_voided', {
      route: 'pending-order-reconcile',
      requestId: ctx.requestId,
      orderId: row.orderId,
      gatewayStatus: probe.order.order_status,
    });
    return { state: 'closed', row, gateway: probe.order };
  }
  await touchPendingOrder(row.orderId);
  return { state: 'held', row, note: `hold_unresolved_${state}` };
}

/**
 * A historical row that was never classified. The gateway decides; a row with
 * a claim is checked against the entitlement before anything is granted.
 */
async function reconcileUnverified(
  row: PendingOrderLifecycleRow,
  ctx: ReconcileContext,
): Promise<RowOutcome> {
  if (elapsedSince(row.lastCheckedAt) < ORPHAN_PROBE_INTERVAL_MS) {
    return { state: 'uncertain', row, note: 'probe_spacing' };
  }

  const probe = await probeCashfreeOrder(row.orderId);
  if (probe.kind === 'uncertain') {
    await touchPendingOrder(row.orderId);
    return { state: 'uncertain', row, note: probe.reason };
  }
  if (probe.kind === 'not_found') {
    const result = await orphanProbe(row, 'not_found');
    if (result.closed) return { state: 'closed', row };
    return { state: 'uncertain', row, note: `orphan_probe_${result.probes}` };
  }

  await orphanProbe(row, 'found');
  const state = classifyGatewayOrder(probe.order);
  if (state === 'paid') return settleIfPaid(row, probe.order, ctx);
  if (state === 'expired') {
    await closePendingOrder(row.orderId, 'gateway_expired' satisfies CloseReason, ['unverified']);
    return { state: 'closed', row, gateway: probe.order };
  }
  if (state === 'terminated') {
    await closePendingOrder(row.orderId, 'gateway_terminated' satisfies CloseReason, ['unverified']);
    return { state: 'closed', row, gateway: probe.order };
  }
  if (state === 'active') {
    // Any historical row is older than the abandonment threshold by definition
    // of "historical"; terminating it is the same rule applied to a stale order.
    return terminateAbandoned(row, ctx);
  }
  if (state === 'terminating') {
    await markPendingOrderTerminationRequested(row.orderId);
    return { state: 'terminating', row, gateway: probe.order };
  }
  await touchPendingOrder(row.orderId);
  return { state: 'uncertain', row, note: 'unknown_order_status' };
}

export async function reconcileOrder(
  orderId: string,
  ctx: ReconcileContext,
): Promise<RowOutcome | null> {
  const row = await findPendingOrderLifecycle(orderId);
  if (!row) return null;
  if (row.status === 'creating') return reconcileCreating(row, ctx);
  if (row.status === 'open') return reconcileOpen(row, ctx);
  if (row.status === 'termination_requested') return reconcileTerminating(row, ctx);
  if (row.status === 'held_review') return reconcileHeld(row, ctx);
  if (row.status === 'unverified') return reconcileUnverified(row, ctx);
  return { state: row.status === 'fulfilled' ? 'fulfilled' : 'closed', row };
}

function buildOpenBlock(outcome: RowOutcome): CheckoutBlock {
  const gateway: Partial<CashfreeOrder> = outcome.gateway ?? {};
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((Date.parse(outcome.row.createdAt) + ABANDONED_AFTER_MS - Date.now()) / 1000),
  );
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return {
    httpStatus: 409,
    body: {
      error:
        `An earlier checkout is still open. You can resume it now, or start a new payment in about ` +
        `${minutes} minute${minutes === 1 ? '' : 's'}.`,
      code: 'pending_order_open',
      orderId: outcome.row.orderId,
      paymentSessionId: typeof gateway.payment_session_id === 'string' ? gateway.payment_session_id : null,
      // What Cashfree will charge: the same authority a successful response
      // reports, so the sheet never re-quotes from a stale browser price.
      amount: typeof gateway.order_amount === 'number' && Number.isFinite(gateway.order_amount)
        ? gateway.order_amount
        : outcome.row.amount,
      currency: gateway.order_currency || outcome.row.currency,
      plan: outcome.row.plan,
      status: gateway.order_status ?? outcome.row.status,
      retryAfterSeconds,
    },
  };
}

function buildHeldBlock(outcome: RowOutcome): CheckoutBlock {
  return {
    httpStatus: 409,
    body: {
      // Kept under the sheet's 120-character "is this technical?" limit so the
      // buyer reads the real reason instead of a generic failure.
      error:
        "Payment received - we're applying it now. Please don't pay again. " +
        "Contact support if it's not active in 30 minutes.",
      code: 'paid_order_pending_review',
      orderId: outcome.row.orderId,
      paymentSessionId: null,
      amount: outcome.row.amount,
      currency: outcome.row.currency,
      plan: outcome.row.plan,
      status: 'PAID',
      retryAfterSeconds: HELD_RETRY_HINT_S,
      supportReference: outcome.row.orderId,
    },
  };
}

function buildCreatingBlock(outcome: RowOutcome): CheckoutBlock {
  const retry = outcome.note === 'probe_spacing'
    ? Math.max(1, Math.ceil((ORPHAN_PROBE_INTERVAL_MS - elapsedSince(outcome.row.lastCheckedAt)) / 1000))
    : 60;
  return {
    httpStatus: 409,
    body: {
      error: "We're confirming an earlier checkout attempt. Please try again in a minute.",
      code: 'pending_order_creating',
      orderId: outcome.row.orderId,
      retryAfterSeconds: Math.min(120, Math.max(5, retry)),
    },
  };
}

function buildTerminatingBlock(outcome: RowOutcome): CheckoutBlock {
  return {
    httpStatus: 409,
    body: {
      error: "We're closing an earlier checkout attempt. Please try again in about a minute.",
      code: 'pending_order_terminating',
      orderId: outcome.row.orderId,
      retryAfterSeconds: TERMINATION_RETRY_HINT_S,
      status: 'TERMINATION_REQUESTED',
    },
  };
}

function buildUnconfirmedBlock(outcome: RowOutcome): CheckoutBlock {
  return {
    httpStatus: 503,
    body: {
      error: "We couldn't confirm an earlier checkout attempt. Please try again in a minute.",
      code: 'pending_order_unconfirmed',
      orderId: outcome.row.orderId,
      retryAfterSeconds: 60,
    },
  };
}

function buildIncompleteBlock(orderId: string): CheckoutBlock {
  return {
    httpStatus: 503,
    body: {
      error: "We're tidying up earlier checkout attempts. Please try again in a minute.",
      code: 'reconciliation_incomplete',
      orderId,
      retryAfterSeconds: 60,
    },
  };
}

/**
 * Reconciles everything that could still be payable for one user and reports
 * whether a new checkout may proceed.
 *
 * The caller must hold the per-user checkout lock: this reads several rows and
 * may act on each of them, and two concurrent passes would otherwise both see
 * the same unclassified order as "still to handle".
 */
export async function reconcileUserCheckout(
  userId: string,
  ctx: ReconcileContext,
): Promise<CheckoutReconcileResult> {
  const rows = await findPendingOrdersForReconcile(userId, RECONCILE_ROW_CAP + 1);
  const batch = rows.slice(0, RECONCILE_ROW_CAP);
  const outcomes: RowOutcome[] = [];

  for (const row of batch) {
    try {
      outcomes.push(await reconcileOrder(row.orderId, ctx) ?? { state: 'closed', row });
    } catch (error) {
      logger.error('payment.reconcile_failed', {
        route: 'pending-order-reconcile',
        requestId: ctx.requestId,
        orderId: row.orderId,
        userIdHash: hashUserId(userId),
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      // A reconciliation that cannot finish must not open a new checkout.
      return { ok: false, block: buildUnconfirmedBlock({ state: 'uncertain', row }) };
    }
  }

  const pick = (state: RowOutcome['state']) => outcomes.find((outcome) => outcome.state === state);

  const live = pick('live');
  if (live) return { ok: false, block: buildOpenBlock(live) };
  const creating = pick('creating');
  if (creating) return { ok: false, block: buildCreatingBlock(creating) };
  const terminating = pick('terminating');
  if (terminating) return { ok: false, block: buildTerminatingBlock(terminating) };
  const held = pick('held');
  if (held) return { ok: false, block: buildHeldBlock(held) };
  const uncertain = pick('uncertain');
  if (uncertain) return { ok: false, block: buildUnconfirmedBlock(uncertain) };
  if (rows.length > RECONCILE_ROW_CAP) {
    return { ok: false, block: buildIncompleteBlock(rows[RECONCILE_ROW_CAP].orderId) };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Operator surface
// ---------------------------------------------------------------------------

export type OpsRecommendation =
  | 'mark_fulfilled'
  | 'settle'
  | 'close'
  | 'terminate'
  | 'investigate_claim_unentitled'
  | 'investigate';

export interface ReconciliationReportRow {
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
  status: string;
  createdAt: string;
  claimed: boolean;
  entitled: boolean;
  gatewayStatus: string | null;
  recommendation: OpsRecommendation;
}

/**
 * Read-only dry run. It may read the gateway, but it never writes — not the
 * order, not the entitlement.
 */
export async function buildReconciliationReport(params: {
  rows: PendingOrderOpsRow[];
  probe: boolean;
}): Promise<{ rows: ReconciliationReportRow[]; gatewayCalls: number }> {
  const report: ReconciliationReportRow[] = [];
  let gatewayCalls = 0;

  for (const row of params.rows) {
    const claimed = row.processedAt !== null;
    // Exact per-order evidence only. The old heuristic (`plan_expires_at >
    // processed_at`) also corroborated a crashed renewal, because the previous
    // term had already pushed the expiry past the new claim. `fulfilled_at` is
    // written by the settlement transaction and by nothing else.
    const entitled = row.fulfilledAt !== null;

    let gatewayStatus: string | null = null;
    if (params.probe && (row.status === 'unverified' || row.status === 'held_review')) {
      gatewayCalls += 1;
      const probe = await probeCashfreeOrder(row.orderId);
      gatewayStatus = probe.kind === 'found' ? probe.order.order_status ?? 'unknown' : probe.kind;
    }

    let recommendation: OpsRecommendation = 'investigate';
    if (claimed && !entitled) recommendation = 'investigate_claim_unentitled';
    else if (claimed && entitled && row.status !== 'fulfilled') recommendation = 'mark_fulfilled';
    else if (gatewayStatus === 'PAID') recommendation = 'settle';
    else if (gatewayStatus === 'EXPIRED' || gatewayStatus === 'TERMINATED' || gatewayStatus === 'not_found') {
      recommendation = 'close';
    } else if (gatewayStatus === 'ACTIVE') recommendation = 'terminate';

    report.push({
      orderId: row.orderId,
      userId: row.userId,
      plan: row.plan,
      amount: row.amount,
      currency: row.currency,
      status: row.status,
      createdAt: row.createdAt,
      claimed,
      entitled,
      gatewayStatus,
      recommendation,
    });
  }

  return { rows: report, gatewayCalls };
}

export interface ReleaseResult {
  ok: boolean;
  orderId: string;
  status?: string;
  error?: string;
}

/**
 * The operator's explicit exit from a hold. It re-reads the gateway first, so
 * an operator cannot close a paid order by mistake; a refund is recorded only
 * after it happened elsewhere (this function never moves money).
 */
export async function releaseHeldOrder(params: {
  orderId: string;
  resolution: 'fulfilled_manually' | 'refunded' | 'not_paid';
  ctx: ReconcileContext;
}): Promise<ReleaseResult> {
  const row = await findPendingOrderLifecycle(params.orderId);
  if (!row) return { ok: false, orderId: params.orderId, error: 'order_not_found' };
  if (row.status !== 'held_review') {
    return { ok: false, orderId: params.orderId, status: row.status, error: 'order_not_held' };
  }

  if (params.resolution === 'refunded') {
    // Money already returned outside this system: the obligation is discharged.
    await closePendingOrder(params.orderId, 'operator_closed', ['held_review']);
    logger.warn('payment.order_released_by_operator', {
      route: 'billing-ops',
      requestId: params.ctx.requestId,
      orderId: params.orderId,
      resolution: params.resolution,
    });
    return { ok: true, orderId: params.orderId, status: 'closed' };
  }

  const probe = await probeCashfreeOrder(params.orderId);
  if (probe.kind === 'uncertain') {
    return { ok: false, orderId: params.orderId, error: 'gateway_unavailable' };
  }

  if (params.resolution === 'not_paid') {
    if (probe.kind !== 'found' || (classifyGatewayOrder(probe.order) !== 'expired' && classifyGatewayOrder(probe.order) !== 'terminated')) {
      return { ok: false, orderId: params.orderId, error: 'gateway_still_payable' };
    }
    await closePendingOrder(params.orderId, 'hold_void_unpaid', ['held_review']);
    return { ok: true, orderId: params.orderId, status: 'closed' };
  }

  // fulfilled_manually: grant only against a gateway-confirmed payment.
  if (probe.kind !== 'found' || classifyGatewayOrder(probe.order) !== 'paid') {
    return { ok: false, orderId: params.orderId, error: 'gateway_not_paid' };
  }

  // A claim with the order's own marker means the grant already committed and
  // only the status write is left. A claim without that marker is not evidence
  // the operator can act on — granting again could pay out a second term for a
  // payment that may already have been applied before the marker convention
  // existed. Refuse, and leave it as an investigation.
  const claim = await findPendingOrderClaim(params.orderId);
  if (claim?.claimed) {
    if (!claim.entitled) {
      return { ok: false, orderId: params.orderId, error: 'claim_unentitled' };
    }
    await markPendingOrderFulfilled(params.orderId);
    await sendReceipt(row, probe.order);
    return { ok: true, orderId: params.orderId, status: 'fulfilled' };
  }

  // The transaction claims, grants and marks; there is no pre-claim to lose and
  // nothing to release if it fails.
  const result: FulfillmentResult = await fulfillPaidOrder(pendingFrom(row), probe.order);
  if (!result.ok) {
    if (result.state === 'in_progress') {
      return { ok: false, orderId: params.orderId, error: 'fulfilment_in_progress' };
    }
    return { ok: false, orderId: params.orderId, error: `fulfilment_${result.reason}` };
  }
  await sendReceipt(row, probe.order);
  logger.warn('payment.order_released_by_operator', {
    route: 'billing-ops',
    requestId: params.ctx.requestId,
    orderId: params.orderId,
    resolution: params.resolution,
  });
  return { ok: true, orderId: params.orderId, status: 'fulfilled' };
}
