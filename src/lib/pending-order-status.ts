/**
 * The pending-order state vocabulary and its timing constants.
 *
 * Dependency-free on purpose: both the data layer and the gateway client need
 * it, and the gateway client already depends on the data layer through the
 * fulfilment module.
 */

export const PENDING_ORDER_STATUSES = [
  'creating',
  'open',
  'termination_requested',
  'held_review',
  'unverified',
  'fulfilled',
  'closed',
] as const;

export type PendingOrderStatus = (typeof PENDING_ORDER_STATUSES)[number];

/** States in which a payable Cashfree order may exist. Indexed, one per user. */
export const LIVE_PENDING_STATUSES: readonly PendingOrderStatus[] = [
  'creating',
  'open',
  'termination_requested',
];

export function isLiveStatus(status: string): boolean {
  return (LIVE_PENDING_STATUSES as readonly string[]).includes(status);
}

/** A settled outcome: no further checkout will happen for this row. */
export function isTerminalStatus(status: string): boolean {
  return status === 'fulfilled' || status === 'closed';
}

/** A reserved row's creation outcome is unknown until this long after it. */
export const CREATING_GRACE_MS = 2 * 60 * 1000;
/** An `open` order older than this is abandoned and is terminated. */
export const ABANDONED_AFTER_MS = 15 * 60 * 1000;
/** What the sheet is told while a termination is unresolved. */
export const TERMINATION_RETRY_HINT_S = 45;
/** Alert when a termination request has not been confirmed within this long. */
export const STUCK_TERMINATION_ALERT_MS = 15 * 60 * 1000;
/** Minimum spacing between the probes that may declare an orphan. */
export const ORPHAN_PROBE_INTERVAL_MS = 15 * 1000;
/** Confirmed 404s required before a reserved row may be declared orphaned. */
export const ORPHAN_PROBE_REQUIRED = 3;
/** Total span those 404s must cover: 2 gaps of 15 s. */
export const ORPHAN_PROBE_SPAN_MS = (ORPHAN_PROBE_REQUIRED - 1) * ORPHAN_PROBE_INTERVAL_MS;
/** How long the sheet is told to wait when a payment is under review. */
export const HELD_RETRY_HINT_S = 300;
/** In-request polls after a kill request, before the row is left unresolved. */
export const TERMINATION_POLL_ATTEMPTS = 3;
export const TERMINATION_POLL_DELAY_MS = 1000;
/** Per-call ceiling, so one slow gateway answer cannot exhaust the request. */
export const GATEWAY_TIMEOUT_MS = 5000;
/** Rows reconciled per checkout attempt, least-recently-checked first. */
export const RECONCILE_ROW_CAP = 5;
/** How long a checkout lock survives its holder (see acquireCheckoutLock). */
export const CHECKOUT_LOCK_TTL_MS = 60 * 1000;

export type GatewayOrderState =
  | 'paid'
  | 'active'
  | 'expired'
  | 'terminated'
  | 'terminating'
  | 'unknown';

/**
 * Maps Cashfree's `order_status` onto the states this application reasons about.
 *
 * `PAID`, `EXPIRED` and `TERMINATED` are terminal. `TERMINATION_REQUESTED` is
 * NOT: the kill has been accepted but not confirmed, so it must keep blocking.
 * `FAILED`/`CANCELLED` are payment statuses; in `order_status` they are unknown,
 * and an unknown answer is a reason to stop rather than to release a block.
 */
export function classifyGatewayOrder(order: { order_status?: string }): GatewayOrderState {
  switch (order.order_status) {
    case 'PAID':
      return 'paid';
    case 'ACTIVE':
      return 'active';
    case 'EXPIRED':
      return 'expired';
    case 'TERMINATED':
      return 'terminated';
    case 'TERMINATION_REQUESTED':
      return 'terminating';
    default:
      return 'unknown';
  }
}

/** Stable close reasons. The database CHECK constraint lists the same values. */
export type CloseReason =
  | 'paid_fulfilled'
  | 'held_unapplied'
  | 'gateway_expired'
  | 'gateway_terminated'
  | 'gateway_rejected_create'
  | 'orphaned_no_gateway_record'
  | 'hold_void_unpaid'
  | 'operator_closed';

/** Stable hold reasons. The database CHECK constraint lists the same values. */
export type HoldReason =
  | 'fulfilment_rejected'
  | 'fulfilment_failed'
  | 'claim_unentitled'
  | 'late_payment_unapplied';
