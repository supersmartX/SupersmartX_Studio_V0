import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { sendPaymentConfirmationEmail, sendAdminNotification } from '@/lib/email';
import { updateUserPlanById } from '@/lib/db';
import { isWebhookProcessed, markWebhookProcessed, findPendingOrder } from '@/lib/db';
import { getServerPrice } from '@/lib/pricing';

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

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

async function getOrderStatus(orderId: string) {
  const response = await fetch(`${CASHFREE_BASE_URL}/orders/${orderId}`, {
    method: 'GET',
    headers: {
      'x-client-id': process.env.CASHFREE_APP_ID || '',
      'x-client-secret': process.env.CASHFREE_SECRET_KEY || '',
      'x-api-version': process.env.CASHFREE_API_VERSION || '2023-08-01',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch order status: ${response.status}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
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
    const eventType = body.type;
    const orderId = body.data?.order?.order_id;

    if (!orderId) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }

    // Database-backed deduplication — survives cold starts
    const alreadyProcessed = await isWebhookProcessed(orderId);
    if (alreadyProcessed) {
      return NextResponse.json({ status: 'ok' });
    }

    // Look up the pending order server-side — no plan derivation from order ID
    const pendingOrder = await findPendingOrder(orderId);
    if (!pendingOrder) {
      console.error('Webhook received for unknown order:', orderId);
      return NextResponse.json({ error: 'Unknown order' }, { status: 400 });
    }

    const order = await getOrderStatus(orderId);
    const paymentStatus = body.data?.payment?.payment_status;

    if (order.order_status === 'PAID' || paymentStatus === 'SUCCESS') {
      // Verify amount and currency matches what we stored server-side
      const paidAmount = Number(order.order_amount);
      const paidCurrency = order.order_currency;
      if (Math.abs(paidAmount - pendingOrder.amount) > 0.01) {
        console.error('Amount mismatch for order:', orderId, {
          expected: pendingOrder.amount,
          paid: paidAmount,
        });
        return NextResponse.json({ error: 'Amount mismatch' }, { status: 400 });
      }
      if (paidCurrency && pendingOrder.currency && paidCurrency !== pendingOrder.currency) {
        console.error('Currency mismatch for order:', orderId, {
          expected: pendingOrder.currency,
          paid: paidCurrency,
        });
        return NextResponse.json({ error: 'Currency mismatch' }, { status: 400 });
      }

      const plan = pendingOrder.plan as 'pro_monthly' | 'pro_yearly' | 'creator_monthly' | 'creator_yearly';
      const billingPeriod = plan.includes('yearly') ? 'yearly' as const : 'monthly' as const;

      // Calculate expiry
      const expiresAt = new Date();
      if (billingPeriod === 'yearly') {
        expiresAt.setFullYear(expiresAt.getFullYear() + 1);
      } else {
        expiresAt.setMonth(expiresAt.getMonth() + 1);
      }

      // Activate plan by userId (not email)
      await updateUserPlanById(pendingOrder.userId, plan, expiresAt.toISOString());
      await markWebhookProcessed(orderId);

      // Send confirmation email (best-effort)
      const emailData = {
        orderId,
        plan,
        amount: paidAmount,
        currency: pendingOrder.currency,
        customerName: order.customer_details?.customer_name || '',
        customerEmail: order.customer_details?.customer_email || '',
        billingPeriod,
      };

      await Promise.allSettled([
        sendPaymentConfirmationEmail(emailData),
        sendAdminNotification(emailData),
      ]);
    } else {
      // Still mark as processed to avoid retrying non-success webhooks
      await markWebhookProcessed(orderId);
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
