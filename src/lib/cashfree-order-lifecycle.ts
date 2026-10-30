import {
  CASHFREE_API_VERSION_FALLBACK,
  cashfreeBaseUrl,
  type CashfreeOrder,
} from './cashfree-fulfillment';
import { GATEWAY_TIMEOUT_MS, TERMINATION_POLL_ATTEMPTS, TERMINATION_POLL_DELAY_MS, classifyGatewayOrder } from './pending-order-status';

export * from './pending-order-status';

/**
 * The Cashfree side of the lifecycle.
 *
 * Every read distinguishes three answers — found, definitely absent, uncertain —
 * because only a definite absence may release a reservation. Only an explicit
 * 404 counts as absence; timeouts, 5xx, 401 and 429 are all uncertainty.
 */

function gatewayHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-client-id': process.env.CASHFREE_APP_ID || '',
    'x-client-secret': process.env.CASHFREE_SECRET_KEY || '',
    'x-api-version': process.env.CASHFREE_API_VERSION || CASHFREE_API_VERSION_FALLBACK,
  };
}

export type GatewayProbe =
  | { kind: 'found'; order: CashfreeOrder }
  | { kind: 'not_found' }
  | { kind: 'uncertain'; reason: string };

export async function probeCashfreeOrder(orderId: string): Promise<GatewayProbe> {
  try {
    const response = await fetch(`${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
      method: 'GET',
      headers: gatewayHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'uncertain', reason: `http_${response.status}` };
    const body = (await response.json()) as CashfreeOrder;
    if (!body || typeof body.order_id !== 'string') return { kind: 'uncertain', reason: 'unreadable_body' };
    return { kind: 'found', order: body };
  } catch (error) {
    return { kind: 'uncertain', reason: error instanceof Error ? error.name || 'error' : 'error' };
  }
}

export type TerminateResult =
  | { kind: 'accepted'; order: CashfreeOrder }
  | { kind: 'not_found' }
  | { kind: 'refused'; status: number }
  | { kind: 'uncertain'; reason: string };

/**
 * Asks Cashfree to terminate an order.
 *
 * On the verified API version this answers 200 with the order in
 * `TERMINATION_REQUESTED`; an immediate read usually already shows
 * `TERMINATED`. A refusal is reported as such — the caller must not create a
 * replacement — and a transport failure stays uncertain.
 */
export async function terminateCashfreeOrder(orderId: string): Promise<TerminateResult> {
  try {
    const response = await fetch(`${cashfreeBaseUrl()}/orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: gatewayHeaders(),
      body: JSON.stringify({ order_status: 'TERMINATED' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(GATEWAY_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: 'not_found' };
    if (!response.ok) return { kind: 'refused', status: response.status };
    const body = (await response.json().catch(() => null)) as CashfreeOrder | null;
    return { kind: 'accepted', order: body ?? { order_id: orderId } };
  } catch (error) {
    return { kind: 'uncertain', reason: error instanceof Error ? error.name || 'error' : 'error' };
  }
}

/**
 * Re-reads an order until it is terminal or the attempt budget runs out.
 * Deliberately short: the sandbox answers `TERMINATED` on the first read after
 * a kill, and a request must not hold a buyer for long. An exhausted budget
 * returns the last answer, so the caller persists `termination_requested`
 * rather than guessing.
 */
export async function pollCashfreeOrder(
  orderId: string,
  attempts: number = TERMINATION_POLL_ATTEMPTS,
  delayMs: number = TERMINATION_POLL_DELAY_MS,
): Promise<GatewayProbe> {
  let last: GatewayProbe = { kind: 'uncertain', reason: 'not_polled' };
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await probeCashfreeOrder(orderId);
    if (last.kind === 'not_found') return last;
    if (last.kind === 'found') {
      const state = classifyGatewayOrder(last.order);
      if (state === 'paid' || state === 'expired' || state === 'terminated') return last;
    }
  }
  return last;
}
