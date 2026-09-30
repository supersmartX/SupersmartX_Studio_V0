import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { tryClaimWebhookOrder, releaseWebhookClaim, findPendingOrder } from '@/lib/db';
import {
  fetchCashfreeOrder,
  fulfillPaidOrder,
  fulfillmentErrorMessage,
  isCashfreeOrderPaid,
  sendOrderReceiptOnce,
} from '@/lib/cashfree-fulfillment';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';

function verifyWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string
): boolean {
  const secretKey = process.env.CASHFREE_WEBHOOK_SECRET || process.env.CASHFREE_SECRET_KEY || '';
  if (!secretKey) return false;

  const signatureData = timestamp + payload;
  const computedSignature = crypto
    .createHmac('sha256', secretKey)
    .update(signatureData)
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computedSignature),
      Buffer.from(signature)
    );
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  let claimedOrderId: string | null = null;
  try {
    if (!process.env.CASHFREE_SECRET_KEY) {
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature') || '';
    const timestamp = request.headers.get('x-webhook-timestamp') || '';

    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 });
    }

    if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const body = JSON.parse(rawBody);
    const orderId = body.data?.order?.order_id;

    if (!orderId) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }

    // Look up the pending order server-side — no plan derivation from order ID
    const pendingOrder = await findPendingOrder(orderId);
    if (!pendingOrder) {
      logger.error('payment.order_unknown', { route: '/api/cashfree/webhook', requestId, orderId });
      return NextResponse.json({ error: 'Unknown order' }, { status: 400 });
    }

    const order = await fetchCashfreeOrder(orderId);
    const paymentStatus = body.data?.payment?.payment_status;
    const eventClaimsPaid = isCashfreeOrderPaid(order) || paymentStatus === 'SUCCESS' || paymentStatus === 'PAID';

    if (!eventClaimsPaid) {
      // Genuinely non-terminal event (pending / failed). Not marked processed so
      // a later success event for the same order is still handled.
      return NextResponse.json({ status: 'ok' });
    }

    if (!isCashfreeOrderPaid(order)) {
      // The event says paid but Cashfree's authoritative state does not yet.
      // Returning 2xx would drop the event permanently, so ask for a retry.
      logger.warn('payment.order_state_lag', { route: '/api/cashfree/webhook', requestId, orderId, paymentStatus });
      return NextResponse.json(
        { error: 'Order not settled yet' },
        { status: 503, headers: { 'Retry-After': '60' } }
      );
    }

    // Claim BEFORE mutating the plan. A duplicate delivery that loses the race
    // returns early, so the paid expiry can never be extended twice.
    const claimed = await tryClaimWebhookOrder(orderId);
    if (!claimed) {
      // Someone else already fulfilled this order — usually the return-trip
      // verify, which routinely beats the webhook. That does NOT mean the buyer
      // has been told: the receipt is claimed separately, so send it here
      // rather than assuming the winner handled it. Losing the fulfilment race
      // is a reason to check, not a reason to go silent.
      await sendOrderReceiptOnce(pendingOrder, order);
      return NextResponse.json({ status: 'ok' });
    }
    claimedOrderId = orderId;

    const result = await fulfillPaidOrder(pendingOrder, order);
    if (!result.ok) {
      await releaseWebhookClaim(orderId);
      claimedOrderId = null;
      logger.error('payment.fulfillment_rejected', {
        route: '/api/cashfree/webhook',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
        reason: result.reason,
      });
      return NextResponse.json({ error: fulfillmentErrorMessage(result.reason) }, { status: 400 });
    }

    // Receipt after the plan is active, so the email can never describe an
    // entitlement the buyer does not have.
    await sendOrderReceiptOnce(pendingOrder, order);

    logger.info('payment.order_fulfilled', { route: '/api/cashfree/webhook', requestId, userIdHash: hashUserId(pendingOrder.userId), orderId, plan: pendingOrder.plan });

    claimedOrderId = null;
    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('payment.webhook_failed', { route: '/api/cashfree/webhook', requestId, errorCode: msg.slice(0, 120) });
    // Release the claim so Cashfree's retry can fulfil this order.
    if (claimedOrderId) {
      try {
        await releaseWebhookClaim(claimedOrderId);
      } catch {}
    }
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
