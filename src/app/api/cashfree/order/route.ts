import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

interface CashfreeOrderRequest {
  amount: number;
  name: string;
  email: string;
  phone?: string;
  message?: string;
}

function sanitizeInput(input: string): string {
  return input.replace(/[<>"'&]/g, '').trim().slice(0, 200);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateId(): string {
  // Works in both Node.js and Edge runtime
  return globalThis.crypto?.randomUUID?.() 
    || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function createCashfreeOrder(data: CashfreeOrderRequest) {
  const orderId = `sxs-support-${generateId()}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const payload = {
    order_id: orderId,
    order_amount: data.amount,
    order_currency: 'INR',
    customer_details: {
      customer_id: `user-${generateId().slice(0, 8)}`,
      customer_name: sanitizeInput(data.name) || 'Supporter',
      customer_email: sanitizeInput(data.email),
      customer_phone: data.phone || '9999999999',
    },
    order_meta: {
      return_url: `${baseUrl}/support/success?order_id={order_id}`,
      notify_url: `${baseUrl}/api/cashfree/webhook`,
    },
  };

  const response = await fetch(`${CASHFREE_BASE_URL}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': process.env.CASHFREE_APP_ID!,
      'x-client-secret': process.env.CASHFREE_SECRET_KEY!,
      'x-api-version': process.env.CASHFREE_API_VERSION || '2023-08-01',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Cashfree API returned ${response.status}`);
  }

  return response.json();
}

// Simple in-memory rate limit (per-instance only)
// For production multi-instance, replace with Redis/Upstash
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (entry && now < entry.resetAt) {
    if (entry.count >= RATE_LIMIT_MAX) {
      return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
    }
    entry.count++;
    return { allowed: true };
  }

  rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
  return { allowed: true };
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitMap.entries()) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(ip);
    }
  }
}, 5 * 60 * 1000);

export async function POST(request: NextRequest) {
  try {
    if (!process.env.CASHFREE_APP_ID || !process.env.CASHFREE_SECRET_KEY) {
      return NextResponse.json(
        { error: 'Payment gateway not configured' },
        { status: 503 }
      );
    }

    const forwarded = request.headers.get('x-forwarded-for');
    const ip = forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || 'unknown';

    const { allowed, retryAfter } = checkRateLimit(ip);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfter || 60) } }
      );
    }

    const body = await request.json();
    const { amount, name, email, phone, message } = body as CashfreeOrderRequest;

    if (typeof amount !== 'number' || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    if (name && (typeof name !== 'string' || name.length > 200)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !isValidEmail(email) || email.length > 254) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    if (message && (typeof message !== 'string' || message.length > 500)) {
      return NextResponse.json({ error: 'Invalid message' }, { status: 400 });
    }

    const order = await createCashfreeOrder({
      amount,
      name: name || 'Supporter',
      email,
      phone,
      message,
    });

    return NextResponse.json({
      orderId: order.order_id,
      paymentSessionId: order.payment_session_id,
    });
  } catch (error) {
    console.error('Cashfree order creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create payment order' },
      { status: 500 }
    );
  }
}