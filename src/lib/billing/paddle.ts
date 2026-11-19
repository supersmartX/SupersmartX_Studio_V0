import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import type { BillingPeriod, BillingPlan, BillingProvider, CheckoutConsent, CheckoutQuote, ProviderCheckout } from './contracts';

export function getPaddleEnvironment(): 'sandbox' | 'live' | null {
  const environment = process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase();
  if (environment === 'sandbox' || environment === 'live') return environment;
  return null;
}

export function isPaddleCheckoutEnabled(): boolean {
  const environment = getPaddleEnvironment();
  if (environment === 'sandbox') return true;
  if (environment === 'live') {
    return process.env.PADDLE_LIVE_CHECKOUT_DISABLED !== 'true';
  }
  return false;
}

export function getPaddleClient(): Paddle | null {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  const environment = getPaddleEnvironment();
  if (!apiKey || !environment) return null;
  return new Paddle(apiKey, {
    environment: environment === 'sandbox' ? Environment.sandbox : Environment.production,
  });
}

type PaddleAmountUnit = 'major' | 'minor';

function currencyFractionDigits(currency: string): number | null {
  const code = currency.trim().toUpperCase();
  try {
    if (!/^[A-Z]{3}$/.test(code) || !Intl.supportedValuesOf('currency').includes(code)) {
      return null;
    }
    return new Intl.NumberFormat('en', { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

export function normalizePaddleAmount(
  value: string | number,
  currency: string,
  unit: PaddleAmountUnit = 'major',
): string | null {
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === null) return null;
  const text = String(value).trim();
  if (unit === 'minor') {
    if (!/^\d+$/.test(text)) return null;
    try {
      return BigInt(text).toString();
    } catch {
      return null;
    }
  }

  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  let fraction = match[2] ?? '';
  if (fraction.length > fractionDigits) {
    const excess = fraction.slice(fractionDigits);
    if (!/^0+$/.test(excess)) return null;
    fraction = fraction.slice(0, fractionDigits);
  }
  fraction = fraction.padEnd(fractionDigits, '0');
  try {
    const whole = match[1];
    if (whole === undefined) return null;
    const scale = BigInt(10) ** BigInt(fractionDigits);
    const wholeMinor = BigInt(whole) * scale;
    const fractionalMinor = fraction ? BigInt(fraction) : BigInt(0);
    return (wholeMinor + fractionalMinor).toString();
  } catch {
    return null;
  }
}

export function getSandboxConfiguration(plan: BillingPlan): {
  priceId: string;
  amount: number;
  currency: string;
  period: BillingPeriod;
} | null {
  const monthly = plan === 'creator_monthly';
  const priceId = process.env[monthly
    ? 'PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY'
    : 'PADDLE_SANDBOX_PRICE_CREATOR_YEARLY']?.trim();
  const amountValue = process.env[monthly
    ? 'PADDLE_SANDBOX_AMOUNT_MONTHLY'
    : 'PADDLE_SANDBOX_AMOUNT_YEARLY']?.trim();
  const currency = process.env.PADDLE_SANDBOX_CURRENCY?.trim().toUpperCase();
  const amount = amountValue ? Number(amountValue) : NaN;
  const amountMinor = amountValue && currency
    ? normalizePaddleAmount(amountValue, currency)
    : null;
  if (!priceId || !currency || !amountMinor || BigInt(amountMinor) <= BigInt(0) ||
      !Number.isFinite(amount) || amount <= 0 ||
      normalizePaddleAmount(amount, currency) !== amountMinor) return null;
  return { priceId, amount, currency, period: monthly ? 'monthly' : 'yearly' };
}

export function getPaddlePriceConfiguration(plan: BillingPlan): {
  priceId: string;
  amount: number;
  currency: string;
  period: BillingPeriod;
} | null {
  const environment = getPaddleEnvironment();
  if (environment === 'sandbox') return getSandboxConfiguration(plan);
  if (environment !== 'live') return null;
  const monthly = plan === 'creator_monthly';
  const priceId = process.env[monthly
    ? 'PADDLE_LIVE_PRICE_CREATOR_MONTHLY'
    : 'PADDLE_LIVE_PRICE_CREATOR_YEARLY']?.trim();
  const amountValue = process.env[monthly
    ? 'PADDLE_LIVE_AMOUNT_MONTHLY'
    : 'PADDLE_LIVE_AMOUNT_YEARLY']?.trim();
  const currency = process.env.PADDLE_LIVE_CURRENCY?.trim().toUpperCase();
  const amount = amountValue ? Number(amountValue) : NaN;
  const amountMinor = amountValue && currency
    ? normalizePaddleAmount(amountValue, currency)
    : null;
  if (!priceId || !currency || !amountMinor || BigInt(amountMinor) <= BigInt(0) ||
      !Number.isFinite(amount) || amount <= 0 ||
      normalizePaddleAmount(amount, currency) !== amountMinor) return null;
  return { priceId, amount, currency, period: monthly ? 'monthly' : 'yearly' };
}

export function getSandboxPriceId(plan: BillingPlan): string | null {
  return getSandboxConfiguration(plan)?.priceId ?? null;
}

export function isSafePaddleCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname === 'paddle.com' || url.hostname.endsWith('.paddle.com'));
  } catch {
    return false;
  }
}

export type PaddlePriceMismatchReason =
  | 'quote_configuration'
  | 'price_identity'
  | 'price_inactive'
  | 'currency_mismatch'
  | 'amount_mismatch'
  | 'trial_enabled'
  | 'billing_cycle_mismatch'
  | 'price_override';

export class PaddlePriceMismatchError extends Error {
  constructor(readonly reason: PaddlePriceMismatchReason) {
    super('Configured Paddle sandbox price does not match the quote');
    this.name = 'PaddlePriceMismatchError';
  }
}

export class PaddlePriceLookupError extends Error {
  constructor(readonly statusCode: number | null) {
    super('Paddle sandbox price lookup failed');
    this.name = 'PaddlePriceLookupError';
  }
}

export function getSandboxQuote(plan: BillingPlan): CheckoutQuote | null {
  const config = getSandboxConfiguration(plan);
  if (!config) return null;
  return {
    plan,
    period: config.period,
    currency: config.currency,
    amount: config.amount,
    consentVersion: '1',
    consentText: 'I approve this purchase and understand that the Creator subscription renews at the displayed interval until canceled.',
    renewalLabel: config.period === 'yearly' ? 'Renews every 12 months' : 'Renews every month',
    liveCheckoutDisabled: true,
  };
}

export async function assertSandboxPriceMatches(
  paddle: Paddle,
  plan: BillingPlan,
  amount: number,
  currency: string,
): Promise<void> {
  if (getPaddleEnvironment() !== 'sandbox') throw new Error('Paddle sandbox is not selected');
  const config = getSandboxConfiguration(plan);
  if (!config || config.amount !== amount || config.currency !== currency.toUpperCase()) {
    throw new PaddlePriceMismatchError('quote_configuration');
  }
  let price;
  try {
    price = await paddle.prices.get(config.priceId);
  } catch (error) {
    const statusCode = typeof error === 'object' && error !== null && 'status' in error &&
      typeof error.status === 'number'
      ? error.status
      : typeof error === 'object' && error !== null && 'statusCode' in error &&
        typeof error.statusCode === 'number'
        ? error.statusCode
        : null;
    throw new PaddlePriceLookupError(statusCode);
  }
  const expectedInterval = config.period === 'monthly' ? 'month' : 'year';
  if (price.id !== config.priceId) throw new PaddlePriceMismatchError('price_identity');
  if (price.status !== 'active') throw new PaddlePriceMismatchError('price_inactive');
  if (price.unitPrice.currencyCode !== config.currency) {
    throw new PaddlePriceMismatchError('currency_mismatch');
  }
  if (normalizePaddleAmount(price.unitPrice.amount, config.currency, 'minor') !==
      normalizePaddleAmount(config.amount, config.currency)) {
    throw new PaddlePriceMismatchError('amount_mismatch');
  }
  if (price.trialPeriod !== null) throw new PaddlePriceMismatchError('trial_enabled');
  if (price.billingCycle?.interval !== expectedInterval || price.billingCycle.frequency !== 1) {
    throw new PaddlePriceMismatchError('billing_cycle_mismatch');
  }
  if ((price.unitPriceOverrides?.length ?? 0) > 0) {
    throw new PaddlePriceMismatchError('price_override');
  }
}

export function isAuthoritativelyPaid(status: unknown): boolean {
  return status === 'paid' || status === 'completed' || status === 'billed';
}

export function validatePaddleAttribution(input: {
  transactionUserId: unknown;
  transactionPlan: unknown;
  eventUserId: string | null;
  eventPlan: unknown;
  accountSubscriptionId: string | null;
  transactionSubscriptionId: unknown;
  eventSubscriptionId: unknown;
}): 'ok' | 'customer_ownership_mismatch' | 'plan_attribution_mismatch' | 'subscription_ownership_mismatch' {
  if (input.transactionUserId && input.eventUserId && input.transactionUserId !== input.eventUserId) {
    return 'customer_ownership_mismatch';
  }
  if (input.transactionPlan && input.eventPlan && input.transactionPlan !== input.eventPlan) {
    return 'plan_attribution_mismatch';
  }
  const transactionSubscription = input.transactionSubscriptionId ? String(input.transactionSubscriptionId) : null;
  const eventSubscription = input.eventSubscriptionId ? String(input.eventSubscriptionId) : null;
  if (transactionSubscription && eventSubscription && transactionSubscription !== eventSubscription) {
    return 'subscription_ownership_mismatch';
  }
  if (input.accountSubscriptionId && eventSubscription &&
      input.accountSubscriptionId !== eventSubscription) {
    return 'subscription_ownership_mismatch';
  }
  return 'ok';
}

export class PaddleBillingProvider implements BillingProvider {
  constructor(private readonly paddle: Paddle) {}

  async createSandboxCheckout(input: CheckoutConsent & { userId: string; reservationId: string }): Promise<ProviderCheckout> {
    if (getPaddleEnvironment() !== 'sandbox') {
      throw new Error('Paddle live checkout is disabled');
    }
    const config = getSandboxConfiguration(input.plan);
    if (!config) throw new Error('Paddle sandbox price is not configured');
    await assertSandboxPriceMatches(this.paddle, input.plan, input.amount, input.currency);

    const transaction = await this.paddle.transactions.create({
      items: [{ priceId: config.priceId, quantity: 1 }],
      collectionMode: 'automatic',
      customData: {
        sup_user_id: input.userId,
        sup_plan: input.plan,
        sup_consent_hash: input.consentHash,
        sup_consent_version: input.consentVersion,
        sup_reservation_id: input.reservationId,
      },
    });

    return {
      providerOperationId: transaction.id,
      transactionId: transaction.id,
      checkoutUrl: transaction.checkout?.url ?? null,
      status: 'created',
    };
  }

  getSubscription(subscriptionId: string) {
    return this.paddle.subscriptions.get(subscriptionId);
  }

  getTransaction(transactionId: string) {
    return this.paddle.transactions.get(transactionId);
  }

  cancelAtPeriodEnd(subscriptionId: string) {
    if (getPaddleEnvironment() !== 'sandbox') {
      throw new Error('Paddle live subscription mutations are disabled');
    }
    return this.paddle.subscriptions.cancel(subscriptionId, { effectiveFrom: 'next_billing_period' });
  }
}
