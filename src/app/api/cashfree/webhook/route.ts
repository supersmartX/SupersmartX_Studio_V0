import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { findPendingOrder, findUserById } from '@/lib/db';
import {
  fetchCashfreeOrder,
  fulfillPaidOrder,
  fulfillmentErrorMessage,
  hasActivePaidGrant,
  isCashfreeOrderPaid,
  isCashfreeEnvUsable,
  sendOrderReceiptOnce,
} from '@/lib/cashfree-fulfillment';
import { cashfreeEventType, classifyCashfreeEvent, handleRefundEvent } from '@/lib/cashfree-refund';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';

// Phase 2.6: signed webhooks older than this are treated as replays. Cashfree
// signs each delivery at send time, so live deliveries arrive within seconds;
// 5 minutes only excludes captured-and-replayed traffic.
const WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS = 300;

/**
 * Cashfree signs every webhook with the PG client secret key — the same value
 * sent as `x-client-secret` on API calls. There is no separate webhook secret,
 * so a second variable here could only ever hold a value Cashfree never signs
 * with, and preferring it would reject every genuine event. The key is read
 * only from CASHFREE_SECRET_KEY, and the handler's own guard has already
 * established that it is present.
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  timestamp: string
): boolean {
  const secretKey = process.env.CASHFREE_SECRET_KEY || '';
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
  // No claim is held outside the settlement transaction, so a throw has nothing
  // to release: the transaction rolls the claim, the grant and the marker back
  // together and Cashfree's retry can settle the order.
  try {
    if (!process.env.CASHFREE_SECRET_KEY) {
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    // Fulfilment runs against whichever Cashfree environment the server selected,
    // which is chosen by CASHFREE_ENV alone and is not tied to NODE_ENV. An
    // unset or misspelt value must stop fulfilment dead rather than verify the
    // order against an environment nobody selected and write a real entitlement.
    if (!isCashfreeEnvUsable()) {
      logger.error('payment.webhook_failed', {
        route: '/api/cashfree/webhook',
        requestId,
        errorCode: 'cashfree_env_invalid',
      });
      return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
    }

    const rawBody = await request.text();
    const signature = request.headers.get('x-webhook-signature') || '';
    const timestamp = request.headers.get('x-webhook-timestamp') || '';

    if (!signature || !timestamp) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 400 });
    }

    // Phase 2.6 replay handling: a captured delivery must not remain valid
    // indefinitely — the HMAC alone proves origin, not freshness. Seconds-only
    // (a millisecond or non-numeric timestamp fails the skew check and is
    // rejected exactly like a bad signature, so no oracle is introduced).
    const timestampSeconds = Number(timestamp);
    if (
      !Number.isFinite(timestampSeconds) ||
      Math.abs(Date.now() / 1000 - timestampSeconds) > WEBHOOK_TIMESTAMP_MAX_SKEW_SECONDS
    ) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    if (!verifyWebhookSignature(rawBody, signature, timestamp)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const body = JSON.parse(rawBody);

    // Money-out events (refund, chargeback) are a different shape and a
    // different question: they take an entitlement away instead of granting
    // one. They are handled before the payment path, which requires a
    // `data.order.order_id` that a refund payload does not carry. The signature
    // above is the same HMAC for every Cashfree webhook, so an unsigned or
    // stale reversal never reaches this branch.
    const eventType = cashfreeEventType(body);
    if (classifyCashfreeEvent(eventType) !== 'other') {
      const outcome = await handleRefundEvent(body, requestId);
      logger.info('payment.reversal_event', {
        route: '/api/cashfree/webhook',
        requestId,
        eventType: eventType.slice(0, 80),
        outcome,
      });
      return NextResponse.json({ status: 'ok', reversal: outcome });
    }

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

    // Claim, grant and per-order marker commit together. A duplicate delivery
    // either finds the committed marker (this caller reports `already_fulfilled`
    // and sends no second term) or blocks on the unique claim until the winner
    // commits. Losing the race is safe; a claim is never taken without its
    // grant.
    //
    // This also covers the branch the old code answered with a bare "ok": a
    // duplicate that found the claim already spent. It is `already_fulfilled`
    // only when the order's own `fulfilled_at` marker exists. A claim with no
    // marker is a review case and is never reported as success.
    const result = await fulfillPaidOrder(pendingOrder, order);

    if (!result.ok && result.state === 'in_progress') {
      // A legacy/racing claim with no grant. Acknowledge the delivery so
      // Cashfree stops retrying an order that cannot be settled here, but never
      // claim success and never send a receipt. Reconciliation holds it.
      logger.error('payment.webhook_claim_without_grant', {
        route: '/api/cashfree/webhook',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
      });
      return NextResponse.json({ status: 'pending_review' });
    }

    if (!result.ok) {
      logger.error('payment.fulfillment_rejected', {
        route: '/api/cashfree/webhook',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
        reason: result.reason,
      });
      return NextResponse.json({ error: fulfillmentErrorMessage(result.reason) }, { status: 400 });
    }

    // The receipt asserts that access is live, so it is only sent against an
    // entitlement that is actually active. A fulfilled order later refunded
    // (a duplicate delivery arriving after the reversal) is acknowledged
    // without telling the buyer their access is on.
    const settledOwner = await findUserById(pendingOrder.userId);
    if (hasActivePaidGrant(settledOwner)) {
      await sendOrderReceiptOnce(pendingOrder, order);
    } else {
      logger.warn('payment.receipt_skipped_grant_inactive', {
        route: '/api/cashfree/webhook',
        requestId,
        userIdHash: hashUserId(pendingOrder.userId),
        orderId,
        userPlan: settledOwner?.plan ?? 'missing',
      });
    }

    logger.info('payment.order_fulfilled', { route: '/api/cashfree/webhook', requestId, userIdHash: hashUserId(pendingOrder.userId), orderId, plan: pendingOrder.plan });

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    logger.error('payment.webhook_failed', { route: '/api/cashfree/webhook', requestId, errorCode: msg.slice(0, 120) });
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
