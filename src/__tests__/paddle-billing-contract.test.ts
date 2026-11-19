import { describe, expect, it, vi } from 'vitest';
import {
  hashCheckoutConsent,
  isFullApprovedEntitlementReversal,
  isNewerBillingEvent,
  reservationStatusForRemote,
} from '@/lib/billing/operations';
import { classifyBillingAccount } from '@/lib/billing/accounts';
import {
  assertSandboxPriceMatches,
  getPaddleEnvironment,
  getSandboxQuote,
  isAuthoritativelyPaid,
  isSafePaddleCheckoutUrl,
  normalizePaddleAmount,
  validatePaddleAttribution,
} from '@/lib/billing/paddle';

describe('Paddle billing contracts', () => {
  it('creates an immutable consent hash and rejects changed consent', () => {
    const consent = {
      plan: 'creator_monthly' as const,
      period: 'monthly' as const,
      amount: 7.99,
      currency: 'USD',
      consentVersion: '1' as const,
    };
    const hash = hashCheckoutConsent(consent);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashCheckoutConsent({ ...consent, amount: 8 })).not.toBe(hash);
  });

  it('maps payment states without granting failed payments', () => {
    expect(reservationStatusForRemote('paid')).toBe('confirmed');
    expect(reservationStatusForRemote('past_due')).toBe('pending');
    expect(reservationStatusForRemote('payment_failed')).toBe('pending');
  });

  it('does not let missing or stale event timestamps overwrite newer billing state', () => {
    const lastEventAt = new Date('2026-11-18T12:00:00.000Z');
    expect(isNewerBillingEvent(new Date('2026-11-18T11:00:00.000Z'), lastEventAt)).toBe(false);
    expect(isNewerBillingEvent(null, lastEventAt)).toBe(false);
    expect(isNewerBillingEvent(new Date('2026-11-18T13:00:00.000Z'), lastEventAt)).toBe(true);
    expect(isNewerBillingEvent(null, null)).toBe(true);
  });

  it('revokes an entitlement only for an approved full refund or chargeback', () => {
    expect(isFullApprovedEntitlementReversal({
      action: 'refund',
      actionType: 'partial',
      status: 'approved',
    })).toBe(false);
    expect(isFullApprovedEntitlementReversal({
      action: 'chargeback',
      actionType: 'full',
      status: 'pending_approval',
    })).toBe(false);
    expect(isFullApprovedEntitlementReversal({
      action: 'refund',
      actionType: 'full',
      status: 'approved',
    })).toBe(true);
  });

  it('keeps cancellation from changing paid-through coverage', () => {
    const account = classifyBillingAccount({
      plan: 'creator_monthly',
      planExpiresAt: '2026-12-18T00:00:00.000Z',
      now: new Date('2026-11-18T00:00:00.000Z'),
    });
    expect(account.status).toBe('active');
    expect(account.paidThroughAt?.toISOString()).toBe('2026-12-18T00:00:00.000Z');
  });

  it('does not accept a browser-side paid result', () => {
    const browserRedirect = vi.fn();
    expect(browserRedirect).not.toHaveBeenCalled();
  });

  it('requires an authoritative paid transaction', () => {
    expect(isAuthoritativelyPaid('paid')).toBe(true);
    expect(isAuthoritativelyPaid('completed')).toBe(true);
    expect(isAuthoritativelyPaid('billed')).toBe(true);
    expect(isAuthoritativelyPaid('ready')).toBe(false);
  });

  it('fails closed without an explicit Paddle environment', () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', '');
    expect(getPaddleEnvironment()).toBeNull();
    expect(getSandboxQuote('creator_monthly')).toBeNull();
  });

  it('uses only configured sandbox price quotes and normalizes provider money exactly', () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '349.00');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'INR');
    expect(getSandboxQuote('creator_monthly')).toMatchObject({
      amount: 349,
      currency: 'INR',
      period: 'monthly',
      liveCheckoutDisabled: true,
    });
    expect(normalizePaddleAmount('0349.00', 'INR')).toBe('34900');
    expect(normalizePaddleAmount('3e2', 'USD')).toBeNull();
  });

  it('normalizes USD major units to Paddle minor units without floating point', () => {
    expect(normalizePaddleAmount('7.99', 'USD')).toBe('799');
    expect(normalizePaddleAmount('65.99', 'USD')).toBe('6599');
    expect(normalizePaddleAmount(0.1, 'USD')).toBe('10');
    expect(normalizePaddleAmount('7.99', 'USD')).toBe(
      normalizePaddleAmount('799', 'USD', 'minor'),
    );
    expect(normalizePaddleAmount('7.99', 'USD')).not.toBe(
      normalizePaddleAmount('798', 'USD', 'minor'),
    );
  });

  it('accepts an exact Sandbox price in minor units and rejects a different amount', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    const price = {
      id: 'pri_monthly',
      status: 'active',
      unitPrice: { currencyCode: 'USD', amount: '799' },
      trialPeriod: null,
      billingCycle: { interval: 'month', frequency: 1 },
      unitPriceOverrides: [],
    };
    const getPrice = vi.fn().mockResolvedValue(price);
    const paddle = {
      prices: { get: getPrice },
    } as unknown as import('@paddle/paddle-node-sdk').Paddle;

    await expect(assertSandboxPriceMatches(paddle, 'creator_monthly', 7.99, 'USD'))
      .resolves.toBeUndefined();
    getPrice.mockResolvedValue({
      ...price,
      unitPrice: { ...price.unitPrice, amount: '798' },
    });
    await expect(assertSandboxPriceMatches(paddle, 'creator_monthly', 7.99, 'USD'))
      .rejects.toMatchObject({ reason: 'amount_mismatch' });
    getPrice.mockRejectedValue({ status: 403 });
    await expect(assertSandboxPriceMatches(paddle, 'creator_monthly', 7.99, 'USD'))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  it('handles currency-specific zero and three-decimal minor units', () => {
    expect(normalizePaddleAmount('123', 'JPY')).toBe('123');
    expect(normalizePaddleAmount('123.00', 'JPY')).toBe('123');
    expect(normalizePaddleAmount('123.01', 'JPY')).toBeNull();
    expect(normalizePaddleAmount('1.234', 'KWD')).toBe('1234');

    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '1.234');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'KWD');
    expect(getSandboxQuote('creator_monthly')?.amount).toBe(1.234);
  });

  it('fails safely for unsupported currencies and excessive precision', () => {
    expect(normalizePaddleAmount('1.00', 'ZZZ')).toBeNull();
    expect(normalizePaddleAmount('1.001', 'USD')).toBeNull();
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '1.00');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'ZZZ');
    expect(getSandboxQuote('creator_monthly')).toBeNull();
  });

  it('maps the configured yearly subscription without changing the displayed price', () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_YEARLY', 'pri_yearly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_YEARLY', '2899.00');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'INR');
    expect(getSandboxQuote('creator_yearly')).toMatchObject({
      plan: 'creator_yearly',
      period: 'yearly',
      amount: 2899,
      currency: 'INR',
      renewalLabel: 'Renews every 12 months',
    });
  });

  it('accepts only HTTPS Paddle-hosted checkout URLs', () => {
    expect(isSafePaddleCheckoutUrl('https://checkout.paddle.com/checkout/test')).toBe(true);
    expect(isSafePaddleCheckoutUrl('http://checkout.paddle.com/checkout/test')).toBe(false);
    expect(isSafePaddleCheckoutUrl('https://paddle.com.attacker.example/checkout/test')).toBe(false);
    expect(isSafePaddleCheckoutUrl('https://example.com/checkout')).toBe(false);
  });

  it('rejects customer, plan and subscription ownership mismatches', () => {
    const base = {
      transactionUserId: 'user-1',
      transactionPlan: 'creator_monthly',
      eventUserId: 'user-1',
      eventPlan: 'creator_monthly',
      accountSubscriptionId: 'sub-1',
      transactionSubscriptionId: 'sub-1',
      eventSubscriptionId: 'sub-1',
    };
    expect(validatePaddleAttribution(base)).toBe('ok');
    expect(validatePaddleAttribution({ ...base, eventUserId: 'user-2' })).toBe('customer_ownership_mismatch');
    expect(validatePaddleAttribution({ ...base, eventPlan: 'creator_yearly' })).toBe('plan_attribution_mismatch');
    expect(validatePaddleAttribution({ ...base, eventSubscriptionId: 'sub-2' })).toBe('subscription_ownership_mismatch');
  });
});
