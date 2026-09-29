import { updateUserPlanById } from '@/lib/db';
import { logger } from '@/lib/observe/logger';

export const CASHFREE_API_VERSION_FALLBACK = '2023-08-01';

export type CashfreeEnv = 'sandbox' | 'production';

/**
 * The server's authoritative environment. Anything unrecognised falls back to
 * sandbox so a typo can never point production traffic at live credentials.
 */
export function getCashfreeEnv(): CashfreeEnv {
  return process.env.CASHFREE_ENV === 'production' ? 'production' : 'sandbox';
}

export function cashfreeBaseUrl(): string {
  return getCashfreeEnv() === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';
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
  const serverEnv = getCashfreeEnv();
  const publicEnv = process.env.NEXT_PUBLIC_CASHFREE_ENV;
  // Absent public value: nothing to contradict the server with.
  if (!publicEnv) return true;
  const normalized = publicEnv === 'production' ? 'production' : 'sandbox';
  if (normalized === serverEnv) return true;
  logger.error('payment.env_mismatch', {
    route: '/api/cashfree',
    serverEnv,
    publicEnv: normalized,
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

export type FulfillmentFailureReason = 'amount_mismatch' | 'currency_mismatch' | 'unknown_plan';

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

  const updated = await updateUserPlanById(pendingOrder.userId, plan, expiresAt.toISOString());
  if (!updated) {
    // No user row matched. Throwing (rather than returning ok) makes both callers
    // release their claim and retry instead of reporting a phantom activation.
    throw new Error('fulfillment_target_user_missing');
  }

  return { ok: true };
}

export function billingPeriodForPlan(plan: string): 'monthly' | 'yearly' {
  return plan.includes('yearly') ? 'yearly' : 'monthly';
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
