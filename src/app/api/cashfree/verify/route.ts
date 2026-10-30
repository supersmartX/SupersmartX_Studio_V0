import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findPendingOrder, findPendingOrderClaim, findUserById } from '@/lib/db';
import {
  fetchCashfreeOrder,
  fulfillPaidOrder,
  fulfillmentErrorMessage,
  hasActivePaidGrant,
  isCashfreeOrderPaid,
  isCashfreeOrderTerminalFailure,
  isCashfreeConfigured,
  isCashfreeEnvUsable,
  sendOrderReceiptOnce,
} from '@/lib/cashfree-fulfillment';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';
import { rateLimit } from '@/lib/rate-limit';

// Phase 2.9: verification hits Cashfree's order API (merchant-wide quota) and
// can write entitlements, so it carries a per-user boundary. 30/min is far
// above the client's 15-poll activation loop.
const VERIFY_RATE_LIMIT_MAX = 30;
const VERIFY_RATE_LIMIT_WINDOW_MS = 60 * 1000;

/**
 * Server-side verification of a Cashfree payment on the browser return trip.
 *
 * The `?payment=success` query string is attacker-controllable, so the plan is
 * only ever activated from this order's own fulfilment record, and only read
 * from Cashfree when that record does not exist yet. The answer names the plan
 * and expiry for the order that was asked about, so the client needs no
 * session-plan or URL-plan fallback to decide what the buyer now owns.
 *
 * This is the recovery path for a webhook that has not landed yet; it is safe
 * to call repeatedly because fulfilment is a single transaction that claims,
 * grants and stamps the order together.
 *
 * A claim row alone is never an activation. `activated` requires this exact
 * order's `fulfilled_at` marker (written only by that transaction) AND a live
 * entitlement; a claim without a marker is a review case answered `pending`.
 *
 * The same authority runs in the other direction: a FAILED / CANCELLED /
 * EXPIRED order is reported as `failed` so the client can stop waiting, and
 * because nothing here writes a plan on that path, the account is still Free
 * and a retried or abandoned attempt leaves no entitlement behind.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  // Nothing is released here on a throw: the settlement transaction commits the
  // claim, the grant and the marker together or rolls all three back, so a
  // failed call leaves the order claimable rather than claimed-and-unpaid.
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rl = rateLimit(`cashfree-verify:${session.user.id}`, VERIFY_RATE_LIMIT_MAX, VERIFY_RATE_LIMIT_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );
    }

    if (!isCashfreeConfigured()) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    // Never verify (and therefore never activate) against a Cashfree environment
    // the server has not explicitly selected. An unset or misspelt CASHFREE_ENV
    // must not be able to fulfil an order against a host nobody chose; an
    // explicit `sandbox` is a legitimate choice in any deployment.
    if (!isCashfreeEnvUsable()) {
      logger.error('payment.verify_failed', { route: '/api/cashfree/verify', requestId, errorCode: 'cashfree_env_invalid' });
      return NextResponse.json({ error: 'Payment is temporarily unavailable' }, { status: 503 });
    }

    const orderId = request.nextUrl.searchParams.get('order_id')?.trim();
    if (!orderId || orderId.length > 200) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }

    const pendingOrder = await findPendingOrder(orderId);
    if (!pendingOrder) {
      return NextResponse.json({ error: 'Unknown order' }, { status: 404 });
    }

    // Ownership check. The order may reference a stub/ephemeral user id created
    // at checkout, so the session email is accepted as the same account.
    const owner = await findUserById(pendingOrder.userId);
    const sameAccount =
      pendingOrder.userId === session.user.id ||
      (owner?.email?.toLowerCase() === session.user.email?.toLowerCase());
    if (!sameAccount) {
      // Phase 2.10: a foreign order must be indistinguishable from an unknown
      // one — 403-vs-404 would let an authenticated caller confirm that someone
      // else's order id exists. The rejection itself is unchanged.
      logger.warn('payment.verify_forbidden', { route: '/api/cashfree/verify', requestId, userIdHash: hashUserId(session.user.id), orderId });
      return NextResponse.json({ error: 'Unknown order' }, { status: 404 });
    }

    // Fulfilment-first: this order's own marker is the authority. Once it
    // exists the plan write committed in the same transaction, so asking
    // Cashfree again would make an already-paid order depend on the gateway
    // being reachable — and would leave a buyer whose webhook settled the order
    // stranded on a spinner during a Cashfree outage.
    //
    // The marker is exact per-order evidence (`pending_orders.fulfilled_at`),
    // not a claim row. A claim with no marker is the crash window this gate
    // exists to close: it must never be reported as an activation.
    //
    // The verdict describes THIS order: its stored plan and the account's
    // stored expiry. It never comes from the session (a renewal leaves
    // `session.user.plan` at `creator_*` from before the purchase, so the
    // session cannot tell a new activation from the plan already held) and
    // never from the return URL, which any caller can write.
    const claim = await findPendingOrderClaim(orderId);
    if (claim?.claimed) {
      if (!claim.entitled) {
        logger.error('payment.verify_claim_without_grant', {
          route: '/api/cashfree/verify',
          requestId,
          userIdHash: hashUserId(pendingOrder.userId),
          orderId,
        });
        // Pending, not failed and not activated: the money may be real, but no
        // grant exists for it, so nothing may be confirmed and no receipt may
        // claim one. Reconciliation holds the order for review.
        return NextResponse.json({ status: 'pending', orderStatus: 'ACTIVE' });
      }

      // Read the account AFTER the marker so the expiry cannot be a stale
      // pre-grant read. A revoked (refunded) or lapsed entitlement means this
      // order is fulfilled history, not a live activation.
      const settledOwner = await findUserById(pendingOrder.userId);
      if (!hasActivePaidGrant(settledOwner)) {
        logger.warn('payment.verify_fulfilled_grant_inactive', {
          route: '/api/cashfree/verify',
          requestId,
          userIdHash: hashUserId(pendingOrder.userId),
          orderId,
          userPlan: settledOwner?.plan ?? 'missing',
        });
        return NextResponse.json({ status: 'pending', orderStatus: 'ACTIVE' });
      }

      // The winner may have fulfilled without sending a receipt (a webhook that
      // threw after the commit, for instance). Best-effort, from stored facts
      // only: the amount was already validated at fulfilment and the identity
      // is the account's, so no gateway read is needed to tell the buyer. This
      // cannot change the verdict.
      await sendOrderReceiptOnce(pendingOrder, {
        order_id: orderId,
        order_amount: pendingOrder.amount,
        order_currency: pendingOrder.currency,
        customer_details: {
          customer_name: owner?.name || '',
          customer_email: owner?.email || session.user.email || '',
        },
      });
      logger.info('payment.verify_already_fulfilled', {
        route: '/api/cashfree/verify',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
      });
      return NextResponse.json({
        status: 'activated',
        orderId,
        plan: pendingOrder.plan,
        expiresAt: settledOwner?.planExpiresAt ?? null,
      });
    }

    const order = await fetchCashfreeOrder(orderId);

    if (!isCashfreeOrderPaid(order)) {
      // A terminal failure is an answer, not a delay. Reporting it as
      // 'pending' is what made a declined payment look like a slow one: the
      // client kept polling for an activation that could never arrive, then
      // told the buyer their plan was on its way. The plan is untouched here,
      // so the session keeps reading 'free' and every Free limit still holds.
      if (isCashfreeOrderTerminalFailure(order)) {
        logger.info('payment.verify_order_failed', {
          route: '/api/cashfree/verify',
          requestId,
          userIdHash: hashUserId(session.user.id),
          orderId,
          orderStatus: order.order_status,
        });
        return NextResponse.json({ status: 'failed', orderStatus: order.order_status });
      }
      logger.info('payment.verify_pending', { route: '/api/cashfree/verify', requestId, orderId, orderStatus: order.order_status || 'unknown' });
      return NextResponse.json({ status: 'pending', orderStatus: order.order_status || 'ACTIVE' });
    }

    // Claim, grant and marker are one transaction. A concurrent verify or
    // webhook either already committed (we are told `already_fulfilled`) or is
    // mid-transaction (our insert blocks until it commits, then we see the
    // marker). Either way exactly one term is granted and both callers get a
    // coherent answer.
    const result = await fulfillPaidOrder(pendingOrder, order);

    if (!result.ok && result.state === 'in_progress') {
      // A claim with no marker: never an activation, and never a receipt.
      logger.error('payment.verify_claim_without_grant', {
        route: '/api/cashfree/verify',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
      });
      return NextResponse.json({ status: 'pending', orderStatus: 'ACTIVE' });
    }

    if (!result.ok) {
      logger.error('payment.fulfillment_rejected', {
        route: '/api/cashfree/verify',
        requestId,
        orderId,
        reason: result.reason,
      });
      return NextResponse.json({ error: fulfillmentErrorMessage(result.reason) }, { status: 400 });
    }

    // Confirm the grant that committed alongside the marker before telling the
    // buyer anything. The receipt states the access is live, so it may only be
    // sent against a live entitlement.
    const settledOwner = await findUserById(pendingOrder.userId);
    if (!hasActivePaidGrant(settledOwner)) {
      logger.error('payment.verify_grant_not_live', {
        route: '/api/cashfree/verify',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
        userPlan: settledOwner?.plan ?? 'missing',
      });
      return NextResponse.json({ status: 'pending', orderStatus: 'ACTIVE' });
    }

    await sendOrderReceiptOnce(pendingOrder, order);

    logger.info('payment.verify_activated', { route: '/api/cashfree/verify', requestId, userIdHash: hashUserId(pendingOrder.userId), orderId, plan: pendingOrder.plan });
    return NextResponse.json({
      status: 'activated',
      orderId,
      plan: pendingOrder.plan,
      // The expiry the stored account holds, so the client never has to guess
      // it from the session (which does not carry it at all).
      expiresAt: settledOwner?.planExpiresAt ?? null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('payment.verify_failed', { route: '/api/cashfree/verify', requestId, errorCode: msg.slice(0, 120) });
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
