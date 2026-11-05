import {
  findUserById,
  settleFulfilledOrder,
  tryClaimOrderNotification,
  releaseOrderNotification,
} from '@/lib/db';
import { planTermInterval } from '@/lib/entitlements';
import { logger } from '@/lib/observe/logger';

import { getCashfreeConfig, getCashfreeEnv, cashfreeHeaders } from './cashfree-config';
import type { CashfreeEnv } from './cashfree-config';
export { getCashfreeEnv } from './cashfree-config';
export type { CashfreeEnv } from './cashfree-config';

export function assertCashfreeEnvForRuntime(): void { getCashfreeConfig(); }
export function cashfreeBaseUrl(): string { return getCashfreeConfig().baseUrl; }
export function isCashfreeEnvUsable(): boolean {
  try { getCashfreeConfig(); return true; } catch { return false; }
}
export function isCashfreeEnvConsistent(): boolean {
  return process.env.NEXT_PUBLIC_CASHFREE_ENV === getCashfreeEnv();
}
export function isCashfreeConfigured(): boolean {
  return Boolean(process.env.CASHFREE_APP_ID?.trim() && process.env.CASHFREE_SECRET_KEY?.trim());
}
export function apiVersion(): { value: string; source: 'env' } {
  return { value: getCashfreeConfig().apiVersion, source: 'env' };
}

/**
 * What a rejected gateway call may say about itself, without exposing a credential.
 *
 * Read only from an HTTP answer and attached to a still-unclassified result or
 * error: no caller's decision is derived from it, the log becomes actionable.
 */
export interface GatewayProbeDiagnostics {
  host: string;
  cashfreeEnv: CashfreeEnv;
  apiVersion: string;
  apiVersionSource: 'env';
  status: number;
  bodyKind: 'json' | 'non_json' | 'empty';
  gatewayErrorCode?: string;
  gatewayMessage?: string;
  gatewayRequestId?: string;
}

const GATEWAY_TEXT_LIMIT = 120;
const GATEWAY_BODY_LIMIT = 500;

/** Bounded, credential-free text. Never returns a raw body. */
function scrubGatewayText(value: string): string {
  let out = value;
  // Defensive: if a rejection ever echoes a credential, it must not reach the log.
  for (const secret of [process.env.CASHFREE_APP_ID, process.env.CASHFREE_SECRET_KEY]) {
    if (secret && secret.length >= 6) out = out.split(secret).join('[REDACTED]');
  }
  return out.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, GATEWAY_TEXT_LIMIT);
}

function errorText(body: unknown, keys: readonly string[]): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) return scrubGatewayText(value);
  }
  return undefined;
}

/**
 * Describes a rejection from whitelisted fields only. Accepts both documented
 * shapes (`error_code`/`description`/`reason`, and `code`/`message`), keeps the
 * public request id if one is returned, and drops everything else.
 */
export async function describeGatewayFailure(
  response: Response,
  baseUrl: string,
): Promise<GatewayProbeDiagnostics> {
  const version = apiVersion();
  const diagnostics: GatewayProbeDiagnostics = {
    host: new URL(baseUrl).hostname,
    cashfreeEnv: getCashfreeEnv(),
    apiVersion: version.value,
    apiVersionSource: version.source,
    status: response.status,
    bodyKind: 'empty',
  };

  const requestId =
    response.headers.get('x-request-id') ??
    response.headers.get('x-cf-request-id') ??
    response.headers.get('request-id');

  const raw = (await response.text().catch(() => '')).slice(0, GATEWAY_BODY_LIMIT);
  if (!raw) {
    return { ...diagnostics, gatewayRequestId: requestId ? scrubGatewayText(requestId) : undefined };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return {
      ...diagnostics,
      bodyKind: 'non_json',
      gatewayRequestId: requestId ? scrubGatewayText(requestId) : undefined,
    };
  }

  return {
    ...diagnostics,
    bodyKind: 'json',
    gatewayErrorCode: errorText(body, ['error_code', 'code']),
    gatewayMessage: errorText(body, ['description', 'reason', 'message']),
    gatewayRequestId: requestId ? scrubGatewayText(requestId) : undefined,
  };
}

/**
 * A gateway read that was refused. Carries the sanitized description of the
 * rejection so the caller's failure log names a cause instead of a bare status.
 */
export class CashfreeRequestError extends Error {
  readonly status: number;
  readonly diagnostics?: GatewayProbeDiagnostics;

  constructor(message: string, status: number, diagnostics?: GatewayProbeDiagnostics) {
    super(message);
    this.name = 'CashfreeRequestError';
    this.status = status;
    this.diagnostics = diagnostics;
  }
}

export interface CashfreeOrder {
  order_id: string;
  order_status?: string;
  order_amount?: number;
  order_currency?: string;
  /** Present on the GET /orders/{id} read; used to hand an open order back. */
  payment_session_id?: string;
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
  const baseUrl = cashfreeBaseUrl();
  const response = await fetch(`${baseUrl}/orders/${encodeURIComponent(orderId)}`, {
    method: 'GET',
    headers: cashfreeHeaders(),
    redirect: 'error',
    cache: 'no-store',
  });

  if (!response.ok) {
    const diagnostics = await describeGatewayFailure(response, baseUrl).catch(() => undefined);
    throw new CashfreeRequestError(
      `Failed to fetch order status: ${response.status}`,
      response.status,
      diagnostics,
    );
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

export type FulfillmentFailureReason = 'amount_mismatch' | 'currency_mismatch' | 'unknown_plan';

export type FulfillmentResult =
  /** This call committed the claim, the grant and the per-order marker. */
  | { ok: true; state: 'fulfilled' | 'already_fulfilled'; expiresAt: string | null }
  /** Validation refused the order before anything was claimed. */
  | {
      ok: false;
      state: 'rejected';
      reason: FulfillmentFailureReason;
      expected: number | string;
      received: number | string;
    }
  /**
   * A claim exists but the order has no fulfilment marker. This is a legacy
   * crash (or an old-version writer mid-flight), never proof of payment: the
   * caller must answer pending and leave the receipt unsent.
   */
  | { ok: false; state: 'in_progress' };

/** A paid entitlement that is live right now — not merely a past grant. */
export function hasActivePaidGrant(
  user: { plan?: string; planExpiresAt?: string | null } | null | undefined,
  now = Date.now(),
): boolean {
  if (!user || !user.plan || user.plan === 'free' || !user.planExpiresAt) return false;
  const expiresAt = Date.parse(user.planExpiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

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
 * activates the plan. Shared by the webhook, the return-URL verification and
 * the reconciler so the three can never disagree on what "paid" means.
 *
 * Validation runs BEFORE the claim, so a tampered amount never burns the one
 * claim this order has. The settlement itself is a single transaction: claim,
 * grant and the `fulfilled_at` marker commit together or not at all. That is
 * why a throw here (database error, missing user) leaves the order claimable
 * rather than claimed-and-unpaid.
 */
export async function fulfillPaidOrder(
  pendingOrder: PendingOrder,
  order: CashfreeOrder,
): Promise<FulfillmentResult> {
  const paidAmount = Number(order.order_amount);
  if (!Number.isFinite(paidAmount) || Math.abs(paidAmount - pendingOrder.amount) > 0.01) {
    return {
      ok: false,
      state: 'rejected',
      reason: 'amount_mismatch',
      expected: pendingOrder.amount,
      received: paidAmount,
    };
  }
  if (order.order_currency && pendingOrder.currency && order.order_currency !== pendingOrder.currency) {
    return {
      ok: false,
      state: 'rejected',
      reason: 'currency_mismatch',
      expected: pendingOrder.currency,
      received: order.order_currency,
    };
  }

  if (!FULFILLABLE_PLANS.includes(pendingOrder.plan as FulfillablePlan)) {
    return {
      ok: false,
      state: 'rejected',
      reason: 'unknown_plan',
      expected: FULFILLABLE_PLANS.join('|'),
      received: pendingOrder.plan,
    };
  }
  const plan: FulfillablePlan = pendingOrder.plan as FulfillablePlan;

  // A purchase extends whatever is left of an active plan and starts afresh on
  // an expired or free one. That is the renewal path as well as the first
  // purchase: `creator_yearly` bought while a plan is live adds a calendar year
  // to the current end date instead of replacing it. The grant is one statement
  // on the database clock inside the settlement transaction, so two different
  // orders settling at once stack rather than overwrite, and a duplicate of the
  // *same* order loses the claim instead of reaching the write.
  const settled = await settleFulfilledOrder({
    orderId: pendingOrder.orderId,
    userId: pendingOrder.userId,
    plan,
    interval: planTermInterval(plan),
  });

  switch (settled.state) {
    case 'fulfilled':
    case 'already_fulfilled':
      return { ok: true, state: settled.state, expiresAt: settled.expiresAt };
    case 'claim_without_grant':
      return { ok: false, state: 'in_progress' };
    case 'user_missing':
      // The transaction rolled back: no claim, no grant, no marker. A retry can
      // settle the order once the account exists again.
      throw new Error('fulfillment_target_user_missing');
    case 'order_missing':
    case 'order_owner_mismatch':
    case 'marker_write_missing':
      throw new Error(`fulfillment_${settled.state}`);
  }
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
    // The receipt must state the expiry that is actually stored. Recomputing it
    // here from `new Date()` produced a second, independent date: for a renewal
    // it silently disagreed with the (extended) stored expiry, and a slow send
    // could even land on a different day than the write. A read failure is not
    // fatal — the email simply omits the date rather than guessing one.
    const accessUntil = await findUserById(pendingOrder.userId)
      .then((owner) => owner?.planExpiresAt ?? null)
      .catch(() => null);
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
        accessUntil,
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
  }
}
