import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getServerPrice, getServerPricingForCountry, ALL_COUNTRIES } from '@/lib/pricing';
import { createPendingOrder } from '@/lib/db';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';

const CASHFREE_BASE_URL =
  process.env.CASHFREE_ENV === 'production'
    ? 'https://api.cashfree.com/pg'
    : 'https://sandbox.cashfree.com/pg';

// Derive valid currencies from canonical pricing source to stay in sync
const VALID_CURRENCIES = [...new Set(ALL_COUNTRIES.map(c => c.currency))];

const VALID_PLANS = ['free', 'creator_monthly', 'creator_yearly'];

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
  const requestId = getRequestId(request);
  try {
    const session = await auth();
    if (!session?.user?.id) {
      logger.warn('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: 'unauthorized' });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'x-request-id': requestId } });
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
      logger.warn('api.rate_limited', { route: '/api/cashfree/order', requestId, userIdHash: hashUserId(session.user.id) });
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': String(retryAfter || 60), 'x-request-id': requestId } }
      );
    }

    const body = await request.json();
    const { plan, currency, country, name, email, phone } = body as CashfreeOrderRequest;

    if (!plan || typeof plan !== 'string' || !VALID_PLANS.includes(plan)) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    if (plan === 'free') {
      return NextResponse.json({ error: 'Free plan does not require payment' }, { status: 400 });
    }

    // Resolve pricing by server-verified country (prevents client arbitrage).
    // Vercel/Cloudflare provide geo header; fallback to client country only in dev.
    const serverCountry = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null;
    const serverCountryValid = serverCountry && getServerPricingForCountry(serverCountry) ? serverCountry : null;
    const clientCountryValid = typeof country === 'string' && getServerPricingForCountry(country) ? country : null;
    // Prefer server geo when available (production), else client (local dev)
    const resolvedCountry = serverCountryValid || clientCountryValid;
    if (serverCountryValid && clientCountryValid && serverCountryValid !== clientCountryValid) {
      console.warn(`[PAYMENT] Country mismatch: server=${serverCountryValid} client=${clientCountryValid} user=${session.user.id}`);
    }
    const countryPricing = resolvedCountry ? getServerPricingForCountry(resolvedCountry) : null;
    const finalCurrency = countryPricing
      ? countryPricing.currency
      : currency && VALID_CURRENCIES.includes(currency)
        ? currency
        : 'USD';
    const serverAmount = resolvedCountry && countryPricing
      ? getServerPrice(plan, resolvedCountry)
      : getServerPrice(plan, finalCurrency);
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

    // Store order server-side for webhook verification
    await createPendingOrder({
      orderId: order.order_id,
      userId: session.user.id,
      plan,
      amount: serverAmount,
      currency: finalCurrency,
    });

    logger.info('payment.order_created', { route: '/api/cashfree/order', requestId, userIdHash: hashUserId(session.user.id), plan, currency: finalCurrency });

    const res = NextResponse.json({
      orderId: order.order_id,
      paymentSessionId: order.payment_session_id,
    });
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (error) {
    logger.error('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: (error as Error)?.message?.slice(0, 100) || 'unknown' });
    return NextResponse.json(
      { error: 'Failed to create payment order' },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}
