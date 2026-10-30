import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getServerPrice, getServerPricingForCountry, ALL_COUNTRIES } from '@/lib/pricing';
import {
  getCashfreeEnv,
  isCashfreeEnvConsistent,
  cashfreeBaseUrl,
  isCashfreeEnvUsable,
} from '@/lib/cashfree-fulfillment';
import {
  PendingOrderConflictError,
  acquireCheckoutLock,
  closePendingOrder,
  ensureOAuthUser,
  findUserByEmail,
  findUserById,
  markPendingOrderOpen,
  releaseCheckoutLock,
  reservePendingOrder,
} from '@/lib/db';
import { CHECKOUT_LOCK_TTL_MS } from '@/lib/pending-order-status';
import { reconcileUserCheckout, type CheckoutBlock } from '@/lib/pending-order-reconcile';
import { logger, getRequestId, hashUserId } from '@/lib/observe/logger';

// Resolved per request rather than captured at module load, so the production
// guard inside cashfreeBaseUrl() actually runs and a runtime env change cannot
// leave a stale host baked into the module.
function cashfreeBaseUrlForRequest(): string {
  return cashfreeBaseUrl();
}

// Derive valid currencies from canonical pricing source to stay in sync
const VALID_CURRENCIES = [...new Set(ALL_COUNTRIES.map(c => c.currency))];

const VALID_PLANS = ['free', 'creator_monthly', 'creator_yearly'];

interface CashfreeOrderRequest {
  plan: string;
  currency?: string;
  country?: string;
  name: string;
  email: string;
  phone: string;
}

function sanitizeInput(input: string): string {
  return input.replace(/[<>"'&]/g, '').trim().slice(0, 200);
}

function sanitizePhone(input: string): string {
  return input.replace(/[^0-9+\-\s()]/g, '').trim().slice(0, 20);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.()
    || Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * A Cashfree create response that may never have produced an order.
 *
 * `status` decides recovery: a definite 400/422 is a rejection, so the reserved
 * row is closed immediately. Anything else — timeout, connection reset, 5xx,
 * unreadable body — could still have created the order, so the reservation is
 * left in `creating` for the orphan probe to resolve against the gateway.
 */
class CashfreeCreateError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = 'CashfreeCreateError';
    this.status = status;
  }
}

function isDefiniteGatewayRejection(error: unknown): error is CashfreeCreateError {
  return error instanceof CashfreeCreateError && (error.status === 400 || error.status === 422);
}

async function createCashfreeOrder(data: {
  orderId: string;
  amount: number;
  currency: string;
  plan: string;
  name: string;
  email: string;
  phone: string;
}) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

  const sanitizedPhone = sanitizePhone(data.phone);
  if (!isValidPhone(sanitizedPhone)) {
    // Nothing was sent, so this is a definite rejection of the reservation.
    throw new CashfreeCreateError('Invalid phone number: must contain 8-15 digits', 400);
  }

  const payload = {
    order_id: data.orderId,
    order_amount: data.amount,
    order_currency: data.currency,
    customer_details: {
      customer_id: `user-${generateId().slice(0, 8)}`,
      customer_name: sanitizeInput(data.name) || 'User',
      customer_email: sanitizeInput(data.email),
      customer_phone: sanitizedPhone,
    },
    order_meta: {
      return_url: `${baseUrl}/studio?payment=success&order_id={order_id}&plan=${data.plan}`,
      notify_url: `${baseUrl}/api/cashfree/webhook`,
    },
  };

  let response: Response;
  try {
    response = await fetch(`${cashfreeBaseUrlForRequest()}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-id': process.env.CASHFREE_APP_ID!,
        'x-client-secret': process.env.CASHFREE_SECRET_KEY!,
        'x-api-version': process.env.CASHFREE_API_VERSION || '2023-08-01',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // The request may or may not have reached Cashfree. Never a rejection.
    throw new CashfreeCreateError(
      `Cashfree request failed: ${error instanceof Error ? error.message : String(error)}`,
      null,
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const snippet = body.slice(0, 500).replace(/"x-client-secret"\s*:\s*"[^"]+"/g, '"x-client-secret":"[REDACTED]"');
    throw new CashfreeCreateError(
      `Cashfree API ${response.status}: ${snippet || response.statusText}`,
      response.status,
    );
  }

  try {
    return await response.json();
  } catch {
    // A 200 whose body cannot be read is not proof of failure: the order may
    // exist. Leave the reservation to the orphan probe.
    throw new CashfreeCreateError('Cashfree API returned an unreadable body', null);
  }
}

/** The response body every reconciliation refusal carries. */
function blockResponse(block: CheckoutBlock, requestId: string): NextResponse {
  return NextResponse.json(block.body, {
    status: block.httpStatus,
    headers: {
      'x-request-id': requestId,
      'Retry-After': String(block.body.retryAfterSeconds),
    },
  });
}

function inProgressResponse(requestId: string): NextResponse {
  return NextResponse.json(
    {
      error: 'A checkout for this account is already being processed. Please try again in a few seconds.',
      code: 'checkout_in_progress',
      retryAfterSeconds: 5,
    },
    { status: 409, headers: { 'x-request-id': requestId, 'Retry-After': '5' } },
  );
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

    // CASHFREE_ENV selects the Cashfree environment on its own, independently of
    // NODE_ENV: a production deployment may deliberately point at Sandbox while
    // testing. Only an unset, misspelt or otherwise invalid value refuses here —
    // the guard never substitutes one Cashfree environment for the other.
    if (!isCashfreeEnvUsable()) {
      logger.error('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: 'cashfree_env_invalid' });
      return NextResponse.json(
        { error: 'Payment is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'x-request-id': requestId } }
      );
    }

    // Refuse to create an order when the browser's Cashfree mode disagrees with
    // the server's: checkout would render against one environment while the
    // order and its webhook belong to the other, so it could never activate.
    if (!isCashfreeEnvConsistent()) {
      logger.error('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: 'env_mismatch' });
      return NextResponse.json(
        { error: 'Payment is temporarily unavailable. Please try again shortly.' },
        { status: 503, headers: { 'x-request-id': requestId } }
      );
    }

    const forwarded = request.headers.get('x-forwarded-for');
    // Last entry, matching the login limiter: a client-supplied XFF prefix is
    // spoofable, while the proxy-appended tail is the received peer.
    const ip = forwarded ? forwarded.split(',').pop()?.trim() || 'unknown' : request.headers.get('x-real-ip') || 'unknown';

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
    // Production trusts ONLY the platform geo header (Vercel/Cloudflare); the
    // client country/currency are a dev-only fallback, as documented in
    // docs/ENTITLEMENTS.md. With no usable header in production the server's
    // default region prices the order — the client's values are ignored and no
    // new geo source is invented (the unresolved deployment is reported here).
    const isProduction = process.env.NODE_ENV === 'production';
    const serverCountry = request.headers.get('x-vercel-ip-country') || request.headers.get('cf-ipcountry') || null;
    const serverCountryValid = serverCountry && getServerPricingForCountry(serverCountry) ? serverCountry : null;
    const clientCountryValid = !isProduction && typeof country === 'string' && getServerPricingForCountry(country) ? country : null;
    const resolvedCountry = serverCountryValid || clientCountryValid;
    if (isProduction && !serverCountryValid) {
      logger.warn('payment.geo_unresolved', { route: '/api/cashfree/order', requestId, userIdHash: hashUserId(session.user.id) });
    }
    if (serverCountryValid && clientCountryValid && serverCountryValid !== clientCountryValid) {
      logger.warn('payment.country_mismatch', {
        route: '/api/cashfree/order',
        requestId,
        userIdHash: hashUserId(session.user.id),
        serverCountry: serverCountryValid,
        clientCountry: clientCountryValid,
      });
    }
    const countryPricing = resolvedCountry ? getServerPricingForCountry(resolvedCountry) : null;
    const finalCurrency = countryPricing
      ? countryPricing.currency
      : !isProduction && currency && VALID_CURRENCIES.includes(currency)
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

    if (!phone || typeof phone !== 'string' || !isValidPhone(sanitizePhone(phone))) {
      return NextResponse.json({ error: 'Invalid phone number: 8-15 digits required (include country code, e.g. +919999999999)' }, { status: 400 });
    }

    // Resolve the durable identity the pending order (and the entitlement) hangs
    // off, and make sure the row the pending_orders FK needs exists *before* the
    // reservation. Postgres enforces that FK unconditionally, so provisioning
    // after the gateway call would leave a paid order with nowhere to record it.
    // Covers: 1) ephemeral fallback DB loss after TURSO fix, 2) OAuth users not
    // in users table.
    let effectiveUserId = session.user.id;
    try {
      const byId = await findUserById(effectiveUserId);
      if (!byId && session.user.email) {
        const byEmail = await findUserByEmail(session.user.email);
        if (byEmail) {
          effectiveUserId = byEmail.id;
        } else {
          // Create stub OAuth/ephemeral user to satisfy pending_orders FK
          const stubHash = `$oauth$${generateId()}`; // not usable for login, OAuth only
          try {
            await ensureOAuthUser({
              id: effectiveUserId,
              email: session.user.email,
              name: (session.user.name || name || 'User').slice(0, 200),
              passwordHash: stubHash,
            });
          } catch (e) {
            // A silently dropped stub row breaks the pending_orders FK and,
            // later, ownership resolution for the paid order. Log it (hashed id,
            // no email) instead of hiding it.
            logger.error('payment.stub_user_insert_failed', {
              route: '/api/cashfree/order',
              requestId,
              userIdHash: hashUserId(effectiveUserId),
              errorType: e instanceof Error ? e.name : 'unknown',
              errorCode: (e instanceof Error ? e.message : String(e)).slice(0, 200),
            });
          }
        }
      }
    } catch (e) {
      logger.error('payment.user_provision_failed', {
        route: '/api/cashfree/order',
        requestId,
        userIdHash: hashUserId(session.user.id),
        errorType: e instanceof Error ? e.name : 'unknown',
      });
    }

    // One checkout per user at a time, serialized end to end.
    //
    // The unique index alone only stops a second *reservation*; the dangerous
    // window is earlier — reconciliation reads historical rows and may call the
    // gateway for each, so two concurrent checkouts could both conclude "nothing
    // is live" and then race to create. This lock covers reconcile → reserve →
    // create, and is the reason an unverified historical order cannot be
    // bypassed by a concurrent attempt.
    const lockToken = generateId();
    const locked = await acquireCheckoutLock(effectiveUserId, lockToken, CHECKOUT_LOCK_TTL_MS);
    if (!locked) {
      logger.warn('payment.checkout_in_progress', {
        route: '/api/cashfree/order',
        requestId,
        userIdHash: hashUserId(effectiveUserId),
      });
      return inProgressResponse(requestId);
    }

    try {
      // Resolve every earlier order that could still be paid before a new one is
      // created. Nothing is released for being old: the gateway decides, and an
      // unreadable answer refuses the checkout rather than opening a second one.
      const gate = await reconcileUserCheckout(effectiveUserId, { requestId, source: 'checkout' });
      if (!gate.ok) {
        logger.warn('payment.checkout_blocked', {
          route: '/api/cashfree/order',
          requestId,
          userIdHash: hashUserId(effectiveUserId),
          code: gate.block.body.code,
          orderId: gate.block.body.orderId,
        });
        return blockResponse(gate.block, requestId);
      }

      const orderId = `sxs-${plan}-${generateId()}`;
      try {
        await reservePendingOrder({
          orderId,
          userId: effectiveUserId,
          plan,
          amount: serverAmount,
          currency: finalCurrency,
        });
      } catch (e) {
        // The partial unique index is the mutex: another live order appeared
        // between reconciliation and reservation (a webhook renewal, or a lock
        // whose TTL expired). Report it as contention, never create the order.
        if (e instanceof PendingOrderConflictError) {
          logger.warn('payment.checkout_conflict', {
            route: '/api/cashfree/order',
            requestId,
            userIdHash: hashUserId(effectiveUserId),
          });
          return inProgressResponse(requestId);
        }
        throw e;
      }

      let order: { order_id: string; payment_session_id: string };
      try {
        order = await createCashfreeOrder({
          orderId,
          amount: serverAmount,
          currency: finalCurrency,
          plan,
          name: name || 'User',
          email,
          phone,
        });
      } catch (e) {
        if (isDefiniteGatewayRejection(e)) {
          // Cashfree refused the request outright, so no payable order exists.
          // Releasing the reservation here is what stops a bad phone number from
          // blocking this user's checkout for the orphan-probe window.
          await closePendingOrder(orderId, 'gateway_rejected_create', ['creating']);
          const msg = e.message;
          const clientMsg = msg.includes('Invalid phone')
            ? msg
            : 'Invalid payment details: check phone number (8-15 digits with country code)';
          logger.warn('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: msg.slice(0, 200) });
          return NextResponse.json(
            { error: clientMsg },
            { status: 400, headers: { 'x-request-id': requestId } },
          );
        }
        // Unknown outcome: keep the row in `creating`. Its existence is the
        // recovery handle — the reconcile path probes this order id until
        // Cashfree either has it (and it is adopted) or three spaced 404s prove
        // it does not. Creating a replacement here could charge the buyer twice.
        logger.error('payment.order_create_indeterminate', {
          route: '/api/cashfree/order',
          requestId,
          orderId,
          userIdHash: hashUserId(effectiveUserId),
          errorCode: e instanceof Error ? e.message.replace(/x-client-secret[^,}]*/gi, '[REDACTED]').slice(0, 200) : 'unknown',
        });
        return NextResponse.json(
          { error: 'Payment is temporarily unavailable. Please try again shortly.' },
          { status: 503, headers: { 'x-request-id': requestId } },
        );
      }

      // The order exists at the gateway. From here it is a live checkout and the
      // staleness rule applies to it like any other.
      if (order.order_id !== orderId) {
        // Cashfree echoes the order_id it was given; anything else would mean the
        // row we reserved can never be settled by this order's webhook.
        logger.error('payment.order_id_mismatch', {
          route: '/api/cashfree/order',
          requestId,
          reservedOrderId: orderId,
          gatewayOrderId: order.order_id,
        });
      }
      const markedOpen = await markPendingOrderOpen(order.order_id);
      if (!markedOpen) {
        // Only a concurrent settlement (webhook before the browser got the
        // session) can move the row out of `creating` under this lock. The
        // order itself is valid, so the buyer still gets the session.
        logger.warn('payment.order_open_transition_missed', {
          route: '/api/cashfree/order',
          requestId,
          orderId: order.order_id,
        });
      }

      logger.info('payment.order_created', {
        route: '/api/cashfree/order',
        requestId,
        userIdHash: hashUserId(session.user.id),
        plan,
        currency: finalCurrency,
      });

      const res = NextResponse.json({
        orderId: order.order_id,
        paymentSessionId: order.payment_session_id,
        // Authoritative environment for this order, so the browser can confirm its
        // SDK mode matches instead of silently checking out against the other one.
        env: getCashfreeEnv(),
        // The amount Cashfree was told to charge, and the region it came from.
        // The sheet's price comes from a third-party geo lookup and a week-long
        // cache, so it can disagree with this; the browser re-quotes from here
        // instead of assuming the price it rendered is the price being charged.
        amount: serverAmount,
        currency: finalCurrency,
        country: resolvedCountry,
      });
      res.headers.set('x-request-id', requestId);
      return res;
    } finally {
      // Token-owned release: a lock whose TTL expired and was taken over by
      // another request is left to that request.
      await releaseCheckoutLock(effectiveUserId, lockToken).catch(() => undefined);
    }
  } catch (error) {
    const msg = (error as Error)?.message || 'unknown';
    // Surface validation / Cashfree 400 errors as 400 instead of 500
    if (msg.includes('Invalid phone') || msg.includes('customer_phone') || msg.includes('Cashfree API 400')) {
      logger.warn('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: msg.slice(0, 200) });
      const clientMsg = msg.includes('Invalid phone')
        ? msg
        : 'Invalid payment details: check phone number (8-15 digits with country code)';
      return NextResponse.json(
        { error: clientMsg },
        { status: 400, headers: { 'x-request-id': requestId } }
      );
    }
    logger.error('payment.order_failed', { route: '/api/cashfree/order', requestId, errorCode: msg.slice(0, 100) || 'unknown' });
    return NextResponse.json(
      { error: 'Failed to create payment order' },
      { status: 500, headers: { 'x-request-id': requestId } }
    );
  }
}
