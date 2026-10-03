import { updateUserPlanByIdIfInactive, tryClaimOrderNotification, releaseOrderNotification } from '@/lib/db';
import { logger } from '@/lib/observe/logger';

export const CASHFREE_API_VERSION_FALLBACK = '2023-08-01';

export type CashfreeEnv = 'sandbox' | 'production';

/** The server's authoritative Cashfree environment; only exact values are valid. */
export function getCashfreeEnv(): CashfreeEnv {
  const env = process.env.CASHFREE_ENV;
  if (env === 'sandbox' || env === 'production') return env;
  throw new Error('cashfree_env_invalid');
}

/**
 * Validate the server-selected mode. Sandbox is permitted in production when
 * explicitly configured; missing and unknown values always fail closed.
 */
export function assertCashfreeEnvForRuntime(): void {
  getCashfreeEnv();
}

export function cashfreeBaseUrl(): string {
  assertCashfreeEnvForRuntime();
  return getCashfreeEnv() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
}

/** Non-throwing form of the guard, for request handlers that answer 503. */
export function isCashfreeEnvUsable(): boolean {
  try {
    assertCashfreeEnvForRuntime();
    return true;
  } catch {
    return false;
  }
}

/**
 * Guards the split between the server env (runtime) and the browser env
 * (build-time `NEXT_PUBLIC_CASHFREE_ENV`).
 *
 * The Cashfree SDK's mode is fixed in the browser when the script loads, but the
 * order is created server-side. If the two disagree, checkout renders against
 * one Cashfree environment while the order — and therefore the webhook — belongs
 * to the other, so the payment can never settle into an activation. Callers must
 * refuse to create an order while they are inconsistent.
 */
export function isCashfreeEnvConsistent(): boolean {
  assertCashfreeEnvForRuntime();
  const serverEnv = getCashfreeEnv();
  const publicEnv = process.env.NEXT_PUBLIC_CASHFREE_ENV;
  if (publicEnv === serverEnv) return true;
  logger.error('payment.env_mismatch', {
    route: '/api/cashfree',
    serverEnv,
    publicEnv: publicEnv || 'unset',
  });
  return false;
}

export function isCashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_APP_ID && process.env.CASHFREE_SECRET_KEY);
}

export interface CashfreeOrder {
  order_id: string;
  order_status?: string;
  order_amount?: number;
  order_currency?: string;
  customer_details?: { customer_name?: string; customer_email?: string };
}

export interface PendingOrder {
  orderId: string;
  userId: string;
  plan: string;
  amount: number;
  currency: string;
}

/** Authoritative order state straight from Cashfree — never from client input. */
export async function fetchCashfreeOrder(orderId: string): Promise<CashfreeOrder> {
  const response = await fetch(`${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: {
      'x-client-id': process.env.CASHFREE_APP_ID || '',
      'x-client-secret': process.env.CASHFREE_SECRET_KEY || '',
      'x-api-version': process.env.CASHFREE_API_VERSION || CASHFREE_API_VERSION_FALLBACK,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch order status: ${response.status}`);
  }
  return response.json() as Promise<CashfreeOrder>;
}

export function isCashfreeOrderPaid(order: CashfreeOrder): boolean {
  return order.order_status === 'PAID';
}

/**
 * Cashfree order states that will never become PAID.
 *
 * `ACTIVE` is deliberately NOT here: it is the genuine "still settling" state
 * the return trip exists to wait on (the webhook routinely lands after the
 * redirect). These three are terminal — the buyer declined, the gateway
 * rejected, or the session expired — so polling for an activation that can
 * never arrive is what turned a failed payment into a 30-second spinner
 * promising a plan that was never going to land.
 */
const TERMINAL_UNPAID_STATUSES = ['FAILED', 'CANCELLED', 'EXPIRED'] as const;

export function isCashfreeOrderTerminalFailure(order: CashfreeOrder): boolean {
  return (TERMINAL_UNPAID_STATUSES as readonly string[]).includes(order.order_status ?? '');
}

export type FulfillmentFailureReason = 'amount_mismatch' | 'currency_mismatch' | 'unknown_plan' | 'active_plan_exists';

export type FulfillmentResult =
  | { ok: true }
  | { ok: false; reason: FulfillmentFailureReason; expected: number | string; received: number | string };

/**
 * The only plans a paid order may ever grant.
 *
 * The order route already rejects anything else, but the value is re-validated
 * here because this is the boundary that writes to `users.plan`: a stored value
 * that is not in the launch set must never reach the database, whatever wrote
 * the row. Pro ids remain in the type for legacy rows but are not purchasable.
 */
const FULFILLABLE_PLANS = ['creator_monthly', 'creator_yearly'] as const;
type FulfillablePlan = (typeof FULFILLABLE_PLANS)[number];

/**
 * Validates a PAID order against the server-stored expectation and, only then,
 * activates the plan. Shared by the webhook and the return-URL verification so
 * the two paths can never disagree on what "paid" means.
 */
export async function fulfillPaidOrder(
  pendingOrder: PendingOrder,
  order: CashfreeOrder,
): Promise<FulfillmentResult> {
  const paidAmount = Number(order.order_amount);
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - pendingOrder.amount) > 0.01) {
    return { ok: false, reason: 'amount_mismatch', expected: pendingOrder.amount, received: paidAmount };
  }
  if (order.order_currency && pendingOrder.currency && order.order_currency !== pendingOrder.currency) {
    return { ok: false, reason: 'currency_mismatch', expected: pendingOrder.currency, received: order.order_currency };
  }

  if (!FULFILLABLE_PLANS.includes(pendingOrder.plan as FulfillablePlan)) {
    return { ok: false, reason: 'unknown_plan', expected: FULFILLABLE_PLANS.join('|'), received: pendingOrder.plan };
  }
  const plan: FulfillablePlan = pendingOrder.plan as FulfillablePlan;

  const billingPeriod = plan.includes('yearly') ? ('yearly' as const) : ('monthly' as const);

  const expiresAt = new Date();
  if (billingPeriod === 'yearly') {
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  } else {
    expiresAt.setMonth(expiresAt.getMonth() + 1);
  }

  const updated = await updateUserPlanByIdIfInactive(pendingOrder.userId, plan, expiresAt.toISOString());
  if (!updated) {
    const userExists = await (await import('@/lib/db')).findUserById(pendingOrder.userId);
    if (!userExists) throw new Error('fulfillment_target_user_missing');
    return { ok: false, reason: 'active_plan_exists', expected: 'no active paid plan', received: userExists.plan };
  }

  return { ok: true };
}

export function billingPeriodForPlan(plan: string): 'monthly' | 'yearly' {
  return plan.includes('yearly') ? 'yearly' : 'monthly';
}

/**
 * Sends the post-payment receipt for a fulfilled order, at most once.
 *
 * Both the webhook and the return-trip verification call this. They race for
 * the fulfilment claim in `processed_webhooks`, and whichever loses returns
 * early — so when the redirect beat the webhook, the buyer was activated and
 * never emailed. Claiming the notification separately makes "exactly one
 * receipt" a property of the notification rather than an accident of which
 * path happened to win.
 *
 * Best-effort in both directions: a failed send does not undo an entitlement
 * that is already correct, and a send that throws is not allowed to turn a
 * settled order into a webhook retry loop.
 *
 * This function is therefore TOTAL — it never throws. That guarantee has to
 * include claiming the notification, not just the send: both callers
 * (`webhook/route.ts`, `verify/route.ts`) invoke it *after* the plan is
 * written, and their catch blocks release the *fulfilment* claim on any
 * throw. A throw from the claim below would therefore delete the claim for an
 * entitlement that is already correct, Cashfree's retry would win the claim
 * back, and `fulfillPaidOrder` would run again — and because the expiry is
 * computed from `new Date()`, each retry extends the subscription by another
 * full billing period. Claiming outside the try made that unbounded.
 */
export async function sendOrderReceiptOnce(
  pendingOrder: PendingOrder,
  order: CashfreeOrder,
): Promise<boolean> {
  try {
    const claimed = await tryClaimOrderNotification(pendingOrder.orderId, 'payment_receipt');
    if (!claimed) return false;
    const [{ sendPaymentConfirmationEmail, sendAdminNotification }] = await Promise.all([
      import('@/lib/email'),
    ]);
    await Promise.allSettled([
      sendPaymentConfirmationEmail({
        orderId: pendingOrder.orderId,
        plan: pendingOrder.plan,
        amount: Number(order.order_amount),
        currency: pendingOrder.currency,
        customerName: order.customer_details?.customer_name || '',
        customerEmail: order.customer_details?.customer_email || '',
        billingPeriod: billingPeriodForPlan(pendingOrder.plan),
      }),
      sendAdminNotification({
        orderId: pendingOrder.orderId,
        plan: pendingOrder.plan,
        amount: Number(order.order_amount),
        currency: pendingOrder.currency,
        customerName: order.customer_details?.customer_name || '',
        customerEmail: order.customer_details?.customer_email || '',
        billingPeriod: billingPeriodForPlan(pendingOrder.plan),
      }),
    ]);
    return true;
  } catch (error) {
    // The entitlement is already written and correct; a mail transport failure
    // must not escalate into a retry that re-runs fulfilment. Release the claim
    // so a later event can still try to deliver the receipt.
    try {
      await releaseOrderNotification(pendingOrder.orderId, 'payment_receipt');
    } catch {}
    logger.error('payment.receipt_failed', {
      route: '/api/cashfree',
      orderId: pendingOrder.orderId,
      errorCode: error instanceof Error ? error.message.slice(0, 120) : 'unknown',
    });
    return false;
  }
}

/** Client-safe message for a rejected fulfilment. Never echoes stored values. */
export function fulfillmentErrorMessage(reason: FulfillmentFailureReason): string {
  switch (reason) {
    case 'amount_mismatch':
      return 'Amount mismatch';
    case 'currency_mismatch':
      return 'Currency mismatch';
    case 'unknown_plan':
      return 'Unsupported plan';
    case 'active_plan_exists':
      return 'An active paid plan already exists';
  }
}
