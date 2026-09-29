import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { findPendingOrder, findUserById, tryClaimWebhookOrder, releaseWebhookClaim } from '@/lib/db';
import {
  fetchCashfreeOrder,
  fulfillPaidOrder,
  fulfillmentErrorMessage,
  isCashfreeOrderPaid,
  isCashfreeConfigured,
} from '@/lib/cashfree-fulfillment';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';

/**
 * Server-side verification of a Cashfree payment on the browser return trip.
 *
 * The `?payment=success` query string is attacker-controllable, so the plan is
 * only ever activated from Cashfree's authoritative order state, never from the
 * URL. This is the recovery path for a webhook that has not landed yet; it is
 * safe to call repeatedly because the fulfilment is claimed atomically.
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
      logger.info('payment.verify_pending', { route: '/api/cashfree/verify', requestId, orderId, orderStatus: order.order_status || 'unknown' });
      return NextResponse.json({ status: 'pending', orderStatus: order.order_status || 'ACTIVE' });
    }

    // Already fulfilled by the webhook (or an earlier verify call).
    const claimed = await tryClaimWebhookOrder(orderId);
    if (!claimed) {
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
