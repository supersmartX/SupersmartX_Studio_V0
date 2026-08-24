import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getServerPrice } from '@/lib/pricing';

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

const VALID_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'BRL', 'MXN', 'NGN', 'ZAR', 'SGD', 'AED', 'SAR', 'PKR', 'BDT', 'PHP', 'IDR', 'MYR', 'THB', 'KRW', 'VND'];

const VALID_PLANS = ['free', 'pro_monthly', 'pro_yearly'];

interface CashfreeOrderRequest {
  plan: string;
  currency?: string;
  country?: string;
  name: string;
  email: string;
  phone?: string;
}

function sanitizeInput(input: string): string {
  return input.replace(/[<>"'&]/g, '').trim().slice(0, 200);
}

function sanitizePhone(input: string): string {
  return input.replace(/[^0-9+\-\s()]/g, '').trim().slice(0, 15);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() 
    || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

async function createCashfreeOrder(data: { amount: number; currency: string; plan: string; name: string; email: string; phone?: string }) {
  const orderId = `sxs-${data.plan}-${generateId()}`;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const payload = {
    order_id: orderId,
    order_amount: data.amount,
    order_currency: data.currency,
    customer_details: {
      customer_id: `user-${generateId().slice(0, 8)}`,
      customer_name: sanitizeInput(data.name) || 'User',
      customer_email: sanitizeInput(data.email),
      customer_phone: sanitizePhone(data.phone || ''),
    },
    order_meta: {
      return_url: `${baseUrl}/support/success?order_id={order_id}&plan=${data.plan}`,
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

// Use globalThis to persist across invocations within the same serverless isolate
const g = globalThis as unknown as { __rateLimitMap?: Map<string, { count: number; resetAt: number }> };
if (!g.__rateLimitMap) g.__rateLimitMap = new Map();
const rateLimitMap = g.__rateLimitMap;
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 5;

function checkRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();

  if (rateLimitMap.size > 1000) {
    for (const [key, entry] of rateLimitMap.entries()) {
      if (now >= entry.resetAt) rateLimitMap.delete(key);
    }
  }

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

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    const { plan, currency, name, email, phone } = body as CashfreeOrderRequest;

    if (!plan || typeof plan !== 'string' || !VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    if (plan === 'free') {
      return NextResponse.json({ error: 'Free plan does not require payment' }, { status: 400 });
    }

    const finalCurrency = currency && VALID_CURRENCIES.includes(currency) ? currency : 'INR';
    const serverAmount = getServerPrice(plan, finalCurrency);
    if (serverAmount === null) {
      return NextResponse.json({ error: 'Invalid plan or currency' }, { status: 400 });
    }

    if (name && (typeof name !== 'string' || name.length > 200)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
    }

    if (!email || typeof email !== 'string' || !isValidEmail(email) || email.length > 254) {
      return NextResponse.json({ error: 'Invalid email' }, { status: 400 });
    }

    const order = await createCashfreeOrder({
      amount: serverAmount,
      currency: finalCurrency,
      plan,
      name: name || 'User',
      email,
      phone,
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
