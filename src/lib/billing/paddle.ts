import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import type { BillingPeriod, BillingPlan, BillingProvider, CheckoutConsent, CheckoutQuote, ProviderCheckout } from './contracts';

export function getPaddleEnvironment(): 'sandbox' | 'live' | null {
  const environment = process.env.PADDLE_ENVIRONMENT?.trim().toLowerCase();
  if (environment === 'sandbox' || environment === 'live') return environment;
  return null;
}

export function getPaddleClient(): Paddle | null {
  const apiKey = process.env.PADDLE_API_KEY?.trim();
  const environment = getPaddleEnvironment();
  if (!apiKey || !environment) return null;
  return new Paddle(apiKey, {
    environment: environment === 'sandbox' ? Environment.sandbox : Environment.production,
  });
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
  if (!priceId || !currency || !/^[A-Z]{3}$/.test(currency) ||
      !amountValue || !/^\d+(?:\.\d{1,2})?$/.test(amountValue) ||
      !Number.isFinite(amount) || amount <= 0) return null;
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
  if (!priceId || !currency || !/^[A-Z]{3}$/.test(currency) ||
      !amountValue || !/^\d+(?:\.\d{1,2})?$/.test(amountValue) ||
      !Number.isFinite(amount) || amount <= 0) return null;
  return { priceId, amount, currency, period: monthly ? 'monthly' : 'yearly' };
}

export function getSandboxPriceId(plan: BillingPlan): string | null {
  return getSandboxConfiguration(plan)?.priceId ?? null;
}

export function normalizePaddleAmount(value: string | number): string | null {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '') || '0'}`;
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
    throw new Error('Checkout quote no longer matches server configuration');
  }
  const price = await paddle.prices.get(config.priceId);
  const expectedInterval = config.period === 'monthly' ? 'month' : 'year';
  if (price.id !== config.priceId || price.status !== 'active' ||
      price.unitPrice.currencyCode !== config.currency ||
      normalizePaddleAmount(price.unitPrice.amount) !== normalizePaddleAmount(config.amount) ||
      price.trialPeriod !== null ||
      price.billingCycle?.interval !== expectedInterval ||
      price.billingCycle.frequency !== 1 ||
      price.unitPriceOverrides.length > 0) {
    throw new Error('Configured Paddle sandbox price does not match the quote');
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
