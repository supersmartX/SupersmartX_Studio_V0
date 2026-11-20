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
  createSandboxCheckoutQuote,
  approvedPaddleCheckoutUrls,
  getPaddleCheckoutUrl,
  getPaddleEnvironment,
  getTrustedPaddleCountry,
  getSandboxQuote,
  isAuthoritativelyPaid,
  isSafePaddleCheckoutUrl,
  normalizePaddleAmount,
  toPaddleHandoffUrl,
  validatePaddlePaidTotals,
  validatePaddleAttribution,
  verifySandboxPriceRecord,
} from '@/lib/billing/paddle';

function validSandboxPrice(input: {
  id: string;
  amount: string;
  interval: 'month' | 'year';
  overrideAmount: string;
}): Parameters<typeof verifySandboxPriceRecord>[0] {
  return {
    id: input.id,
    productId: 'pro_creator',
    type: 'standard',
    status: 'active',
    unitPrice: { currencyCode: 'USD', amount: input.amount },
    trialPeriod: null,
    billingCycle: { interval: input.interval, frequency: 1 },
    quantity: { minimum: 1, maximum: 999999 },
    taxMode: 'location',
    unitPriceOverrides: [{
      countryCodes: ['IN'],
      unitPrice: { currencyCode: 'INR', amount: input.overrideAmount },
    }],
  } as unknown as Parameters<typeof verifySandboxPriceRecord>[0];
}

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
    expect(isAuthoritativelyPaid('billed')).toBe(false);
    expect(reservationStatusForRemote('billed')).toBe('pending');
    expect(isAuthoritativelyPaid('ready')).toBe(false);
  });

  it('fails closed without an explicit Paddle environment', () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', '');
    expect(getPaddleEnvironment()).toBeNull();
    expect(getSandboxQuote('creator_monthly')).toBeNull();
  });

  it('quotes India in INR and other countries at the configured USD base price', () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    expect(getSandboxQuote('creator_monthly', 'IN')).toMatchObject({
      amount: 349,
      currency: 'INR',
      period: 'monthly',
      liveCheckoutDisabled: true,
    });
    expect(getSandboxQuote('creator_monthly', 'US')).toMatchObject({
      amount: 7.99,
      currency: 'USD',
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

  it('accepts the exact India override while validating the USD base price', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    const price = validSandboxPrice({
      id: 'pri_monthly',
      amount: '799',
      interval: 'month',
      overrideAmount: '34900',
    });
    const getPrice = vi.fn().mockResolvedValue(price);
    const paddle = {
      prices: { get: getPrice },
    } as unknown as import('@paddle/paddle-node-sdk').Paddle;

    await expect(assertSandboxPriceMatches(paddle, 'creator_monthly'))
      .resolves.toMatchObject({ id: 'pri_monthly' });
    getPrice.mockResolvedValue({
      ...price,
      unitPrice: { ...price.unitPrice, amount: '798' },
    });
    await expect(assertSandboxPriceMatches(paddle, 'creator_monthly'))
      .rejects.toMatchObject({ reason: 'amount_mismatch' });
    await expect(assertSandboxPriceMatches({
      prices: {
        get: vi.fn().mockResolvedValue({
          ...price,
          billingCycle: { interval: 'year', frequency: 1 },
        }),
      },
    } as unknown as import('@paddle/paddle-node-sdk').Paddle, 'creator_monthly'))
      .rejects.toMatchObject({ reason: 'billing_cycle_mismatch' });
    getPrice.mockRejectedValue({ status: 403 });
    await expect(assertSandboxPriceMatches(paddle, 'creator_monthly'))
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
    expect(getSandboxQuote('creator_monthly')).toBeNull();
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
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_YEARLY', '65.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    expect(getSandboxQuote('creator_yearly', 'IN')).toMatchObject({
      plan: 'creator_yearly',
      period: 'yearly',
      amount: 2899,
      currency: 'INR',
      renewalLabel: 'Renews every 12 months',
    });
    expect(getSandboxQuote('creator_yearly', 'US')).toMatchObject({
      amount: 65.99,
      currency: 'USD',
    });
  });

  it('uses the trusted Vercel country header and ignores it outside Vercel', () => {
    vi.stubEnv('VERCEL', '1');
    expect(getTrustedPaddleCountry(new Headers({ 'x-vercel-ip-country': 'in' }))).toBe('IN');
    vi.stubEnv('VERCEL', '');
    expect(getTrustedPaddleCountry(new Headers({ 'x-vercel-ip-country': 'IN' }))).toBe('US');
  });

  it('signs the regional quote and binds it to the active configured Paddle price', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    vi.stubEnv('AUTH_SECRET', 'test-quote-signing-secret');
    const price = validSandboxPrice({
      id: 'pri_monthly',
      amount: '799',
      interval: 'month',
      overrideAmount: '34900',
    });
    const paddle = {
      prices: { get: vi.fn().mockResolvedValue(price) },
    } as unknown as import('@paddle/paddle-node-sdk').Paddle;

    await expect(createSandboxCheckoutQuote(paddle, 'creator_monthly', 'IN'))
      .resolves.toMatchObject({
        plan: 'creator_monthly',
        period: 'monthly',
        country: 'IN',
        amount: 349,
        currency: 'INR',
        quoteToken: expect.any(String),
      });
  });

  it('rejects malformed, duplicate, wrong-country and wrong-amount regional overrides', () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');
    const price = validSandboxPrice({
      id: 'pri_monthly',
      amount: '799',
      interval: 'month',
      overrideAmount: '34900',
    });
    expect(() => verifySandboxPriceRecord(price, 'creator_monthly')).not.toThrow();
    const invalidOverrides = [
      [{ countryCodes: ['US'], unitPrice: { currencyCode: 'INR', amount: '34900' } }],
      [{ countryCodes: ['IN'], unitPrice: { currencyCode: 'INR', amount: '35000' } }],
      [
        { countryCodes: ['IN'], unitPrice: { currencyCode: 'INR', amount: '34900' } },
        { countryCodes: ['IN'], unitPrice: { currencyCode: 'INR', amount: '34900' } },
      ],
      [null],
      [{ countryCodes: ['IN', 'US'], unitPrice: { currencyCode: 'INR', amount: '34900' } }],
    ];
    for (const unitPriceOverrides of invalidOverrides) {
      expect(() => verifySandboxPriceRecord({
        ...price,
        unitPriceOverrides,
      } as typeof price, 'creator_monthly')).toThrow();
    }
  });

  it('validates tax-inclusive and tax-exclusive totals without accepting inconsistent totals', () => {
    const fields = (subtotal: string, tax: string, total: string) => ({
      subtotal,
      discount: '0',
      tax,
      total,
    });
    const detail = (subtotal: string, tax: string, total: string) => ({
      totals: {
        ...fields(subtotal, tax, total),
        currencyCode: 'USD',
        credit: '0',
        creditToBalance: '0',
        balance: '0',
        grandTotal: total,
        grandTotalTax: tax,
      },
      lineItems: [{
        quantity: 1,
        unitTotals: fields(subtotal, tax, total),
        totals: fields(subtotal, tax, total),
      }],
    });
    expect(validatePaddlePaidTotals({
      ...detail('799', '64', '863'),
      currency: 'USD',
      quotedAmount: 7.99,
    })).toBe(true);
    expect(validatePaddlePaidTotals({
      ...detail('735', '64', '799'),
      currency: 'USD',
      quotedAmount: 7.99,
    })).toBe(true);
    expect(validatePaddlePaidTotals({
      ...detail('799', '64', '864'),
      currency: 'USD',
      quotedAmount: 7.99,
    })).toBe(false);
    expect(validatePaddlePaidTotals({
      ...detail('799', '64', '863'),
      currency: 'INR',
      quotedAmount: 7.99,
    })).toBe(false);
  });

  it('accepts only the configured HTTPS merchant payment page', () => {
    vi.stubEnv('PADDLE_CHECKOUT_URL', 'https://studio.example.com/pay');
    expect(isSafePaddleCheckoutUrl('https://studio.example.com/pay?_ptxn=txn_test')).toBe(true);
    for (const url of [
      'http://studio.example.com/pay', 'https://studio.example.com.attacker.example/pay',
      'https://studio.example.com/other', 'https://user@studio.example.com/pay',
      'https://studio.example.com/pay#fragment', 'https://checkout.paddle.com/pay',
    ]) expect(isSafePaddleCheckoutUrl(url)).toBe(false);
    vi.stubEnv('PADDLE_CHECKOUT_URL', '');
    expect(isSafePaddleCheckoutUrl('https://studio.example.com/pay')).toBe(false);
  });

  it('accepts every explicitly approved merchant payment page and nothing else', () => {
    vi.stubEnv('PADDLE_CHECKOUT_URL', 'https://studio.example.com/pay');
    vi.stubEnv('PADDLE_CHECKOUT_URLS', 'https://preview.example.com/pay, https://legacy.example.com/checkout');
    expect(approvedPaddleCheckoutUrls().map((url) => `${url.origin}${url.pathname}`)).toEqual([
      'https://preview.example.com/pay',
      'https://legacy.example.com/checkout',
      'https://studio.example.com/pay',
    ]);
    expect(getPaddleCheckoutUrl()).toBe('https://studio.example.com/pay');
    expect(isSafePaddleCheckoutUrl('https://preview.example.com/pay?_ptxn=txn_test')).toBe(true);
    expect(isSafePaddleCheckoutUrl('https://legacy.example.com/checkout?_ptxn=txn_test')).toBe(true);
    for (const url of [
      'https://preview.example.com/other',
      'https://preview.example.com.attacker.example/pay',
      'http://preview.example.com/pay',
      'https://preview.example.com/pay#fragment',
    ]) expect(isSafePaddleCheckoutUrl(url)).toBe(false);

    vi.stubEnv('PADDLE_CHECKOUT_URL', 'not a url');
    expect(getPaddleCheckoutUrl()).toBe('https://preview.example.com/pay');
    vi.stubEnv('PADDLE_CHECKOUT_URLS', 'http://insecure.example.com/pay');
    vi.stubEnv('PADDLE_CHECKOUT_URL', '');
    expect(getPaddleCheckoutUrl()).toBeNull();
    expect(isSafePaddleCheckoutUrl('http://insecure.example.com/pay')).toBe(false);
    vi.stubEnv('PADDLE_CHECKOUT_URLS', '');
  });

  it('hands the approved page to /pay with the exact transaction id', () => {
    vi.stubEnv('PADDLE_CHECKOUT_URL', 'https://studio.example.com/pay');
    const txn = 'txn_01h8j3k4m5n6p7q8r9s0t1u2v3';
    expect(toPaddleHandoffUrl('https://studio.example.com/pay', txn))
      .toBe(`https://studio.example.com/pay?_ptxn=${txn}`);
    expect(toPaddleHandoffUrl(`https://studio.example.com/pay?_ptxn=${txn}`, txn))
      .toBe(`https://studio.example.com/pay?_ptxn=${txn}`);
    expect(toPaddleHandoffUrl('https://studio.example.com/pay?_ptxn=txn_other', txn)).toBeNull();
    expect(toPaddleHandoffUrl('https://studio.example.com/checkout', txn)).toBeNull();
    expect(toPaddleHandoffUrl(`http://studio.example.com/pay?_ptxn=${txn}`, txn)).toBeNull();
    expect(toPaddleHandoffUrl('https://studio.example.com/pay', '')).toBeNull();
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
