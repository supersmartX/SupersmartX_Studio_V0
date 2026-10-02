import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findPendingOrder, findUserById, tryClaimWebhookOrder, releaseWebhookClaim } from '@/lib/db';
import {
  fetchCashfreeOrder,
  fulfillPaidOrder,
  fulfillmentErrorMessage,
  isCashfreeOrderPaid,
  isCashfreeOrderTerminalFailure,
  isCashfreeConfigured,
  isCashfreeEnvUsable,
  sendOrderReceiptOnce,
} from '@/lib/cashfree-fulfillment';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';

/**
 * Server-side verification of a Cashfree payment on the browser return trip.
 *
 * The `?payment=success` query string is attacker-controllable, so the plan is
 * only ever activated from Cashfree's authoritative order state, never from the
 * URL. This is the recovery path for a webhook that has not landed yet; it is
 * safe to call repeatedly because the fulfilment is claimed atomically.
 *
 * The same authority runs in the other direction: a FAILED / CANCELLED /
 * EXPIRED order is reported as `failed` so the client can stop waiting, and
 * because nothing here writes a plan on that path, the account is still Free
 * and a retried or abandoned attempt leaves no entitlement behind.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  // Tracked outside the try so a throw after the claim still releases it;
  // otherwise the order stays claimed and every later retry falsely reports
  // "activated" while the plan was never written.
  let claimedOrderId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isCashfreeConfigured()) {
      return NextResponse.json({ error: 'Payment gateway not configured' }, { status: 503 });
    }

    // Never verify (and therefore never activate) against a Cashfree
    // environment that production has not explicitly selected. A mistyped or
    // missing CASHFREE_ENV must not be able to fulfil a real order.
    if (!isCashfreeEnvUsable()) {
      logger.error('payment.verify_failed', { route: '/api/cashfree/verify', requestId, errorCode: 'cashfree_env_not_production' });
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
      logger.warn('payment.verify_forbidden', { route: '/api/cashfree/verify', requestId, userIdHash: hashUserId(session.user.id), orderId });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    // Already fulfilled by the webhook (or an earlier verify call). The claim
    // only says the plan write is spoken for — it says nothing about whether the
    // buyer was ever told, and the winner of that race may have been a path
    // that sends no receipt at all. Claim the notification separately so the
    // buyer is not activated and left in silence.
    const claimed = await tryClaimWebhookOrder(orderId);
    if (!claimed) {
      await sendOrderReceiptOnce(pendingOrder, order);
      return NextResponse.json({ status: 'activated' });
    }
    claimedOrderId = orderId;

    const result = await fulfillPaidOrder(pendingOrder, order);
    if (!result.ok) {
      await releaseWebhookClaim(orderId);
      claimedOrderId = null;
      logger.error('payment.fulfillment_rejected', { route: '/api/cashfree/verify', requestId, orderId, reason: result.reason });
      return NextResponse.json({ error: fulfillmentErrorMessage(result.reason) }, { status: 400 });
    }

    await sendOrderReceiptOnce(pendingOrder, order);

    claimedOrderId = null;
    logger.info('payment.verify_activated', { route: '/api/cashfree/verify', requestId, userIdHash: hashUserId(pendingOrder.userId), orderId, plan: pendingOrder.plan });
    return NextResponse.json({ status: 'activated' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    if (claimedOrderId) {
      try {
        await releaseWebhookClaim(claimedOrderId);
      } catch {}
    }
    logger.error('payment.verify_failed', { route: '/api/cashfree/verify', requestId, errorCode: msg.slice(0, 120) });
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
