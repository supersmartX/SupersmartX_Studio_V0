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

// In-memory processed orders (per-instance only)
// For production, replace with Redis/Upstash with TTL
const processedOrders = new Map<string, number>(); // orderId -> timestamp
const PROCESSED_TTL = 24 * 60 * 60 * 1000; // 24 hours
const MAX_PROCESSED = 10000;

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

// Cleanup old processed orders
function cleanupProcessedOrders() {
  const now = Date.now();
  for (const [orderId, timestamp] of processedOrders.entries()) {
    if (now - timestamp > PROCESSED_TTL) {
      processedOrders.delete(orderId);
    }
  }
  // If still too many, remove oldest
  if (processedOrders.size > MAX_PROCESSED) {
    const entries = Array.from(processedOrders.entries())
      .sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, processedOrders.size - MAX_PROCESSED + 1000);
    toRemove.forEach(([id]) => processedOrders.delete(id));
  }
}

// Run cleanup every hour
setInterval(cleanupProcessedOrders, 60 * 60 * 1000);

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

    // Check if already processed (in-memory)
    if (processedOrders.has(orderId)) {
      return NextResponse.json({ status: 'ok' });
    }

    const order = await getOrderStatus(orderId);
    const paymentStatus = body.data?.payment?.payment_status;

    console.warn(`Webhook received: ${eventType} for order ${orderId} - status: ${paymentStatus || order.order_status}`);

    if (order.order_status === 'PAID' || paymentStatus === 'SUCCESS') {
      console.warn(`Payment successful for order ${orderId}: INR ${order.order_amount}`);
      processedOrders.set(orderId, Date.now());
      cleanupProcessedOrders();
    }

    return NextResponse.json({ status: 'ok' });
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}