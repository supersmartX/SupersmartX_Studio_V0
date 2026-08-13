import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

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

const processedOrders = new Set<string>();

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

    if (processedOrders.has(orderId)) {
      return NextResponse.json({ status: 'ok' });
    }

    const order = await getOrderStatus(orderId);
    const paymentStatus = body.data?.payment?.payment_status;

    console.warn(`Webhook received: ${eventType} for order ${orderId} - status: ${paymentStatus || order.order_status}`);

    if (order.order_status === 'PAID' || paymentStatus === 'SUCCESS') {
      console.warn(`Payment successful for order ${orderId}: INR ${order.order_amount}`);
      processedOrders.add(orderId);

      if (processedOrders.size > 10000) {
        const firstEntries = Array.from(processedOrders).slice(0, 5000);
        firstEntries.forEach((id) => processedOrders.delete(id));
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
