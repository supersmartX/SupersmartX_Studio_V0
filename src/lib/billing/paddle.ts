import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import crypto from 'crypto';
import type { BillingPeriod, BillingPlan, BillingProvider, CheckoutConsent, CheckoutQuote, ProviderCheckout } from './contracts';
import { getServerPricingForCountry } from '@/lib/pricing';

const SANDBOX_QUOTE_TTL_SECONDS = 15 * 60;

type PaddlePrice = Awaited<ReturnType<Paddle['prices']['get']>>;

interface SandboxQuoteDetails extends Omit<CheckoutQuote, 'quoteToken' | 'expiresAt'> {
  priceId: string;
  amountMinor: string;
  baseCurrency: string;
  baseAmountMinor: string;
}

export interface SandboxQuoteClaims {
  version: 2;
  plan: BillingPlan;
  period: BillingPeriod;
  country: string;
  currency: 'USD' | 'INR';
  amount: number;
  amountMinor: string;
  priceId: string;
  productId: string;
  baseCurrency: string;
  baseAmountMinor: string;
  issuedAt: number;
  expiresAt: number;
}

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

interface PaddleTotalsFields {
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

interface PaddlePaidTotals extends PaddleTotalsFields {
  currencyCode: string;
  credit: string;
  creditToBalance: string;
  balance: string;
  grandTotal: string;
  grandTotalTax: string;
}

interface PaddlePaidLineItem {
  quantity: number;
  unitTotals: PaddleTotalsFields | null;
  totals: PaddleTotalsFields | null;
}

function minorAmount(value: string, currency: string): bigint | null {
  const normalized = normalizePaddleAmount(value, currency, 'minor');
  if (normalized === null) return null;
  try {
    return BigInt(normalized);
  } catch {
    return null;
  }
}

function totalsAreConsistent(totals: PaddleTotalsFields, currency: string): boolean {
  const subtotal = minorAmount(totals.subtotal, currency);
  const discount = minorAmount(totals.discount, currency);
  const tax = minorAmount(totals.tax, currency);
  const total = minorAmount(totals.total, currency);
  return subtotal !== null && discount !== null && tax !== null && total !== null &&
    discount === BigInt(0) && tax >= BigInt(0) &&
    total === subtotal - discount + tax;
}

export function validatePaddlePaidTotals(input: {
  totals: PaddlePaidTotals | null;
  lineItems: PaddlePaidLineItem[];
  currency: string;
  quotedAmount: number;
}): boolean {
  const { totals, lineItems, currency } = input;
  if (!totals || totals.currencyCode !== currency || lineItems.length !== 1 ||
      lineItems[0]?.quantity !== 1 || !lineItems[0].unitTotals || !lineItems[0].totals ||
      !totalsAreConsistent(totals, currency) ||
      !totalsAreConsistent(lineItems[0].unitTotals, currency) ||
      !totalsAreConsistent(lineItems[0].totals, currency)) return false;

  const expectedMinor = normalizePaddleAmount(input.quotedAmount, currency);
  const quoted = expectedMinor === null ? null : BigInt(expectedMinor);
  if (quoted === null) return false;

  const lineUnit = lineItems[0].unitTotals;
  const line = lineItems[0].totals;
  const lineUnitSubtotal = minorAmount(lineUnit.subtotal, currency);
  const lineUnitTotal = minorAmount(lineUnit.total, currency);
  const overallSubtotal = minorAmount(totals.subtotal, currency);
  const overallDiscount = minorAmount(totals.discount, currency);
  const overallTax = minorAmount(totals.tax, currency);
  const overallTotal = minorAmount(totals.total, currency);
  const credit = minorAmount(totals.credit, currency);
  const creditToBalance = minorAmount(totals.creditToBalance, currency);
  const balance = minorAmount(totals.balance, currency);
  const grandTotal = minorAmount(totals.grandTotal, currency);
  const grandTotalTax = minorAmount(totals.grandTotalTax, currency);
  if (lineUnitSubtotal === null || lineUnitTotal === null ||
      overallSubtotal === null || overallDiscount === null || overallTax === null ||
      overallTotal === null || credit === null || creditToBalance === null ||
      balance === null || grandTotal === null || grandTotalTax === null) return false;

  return (lineUnitSubtotal === quoted || lineUnitTotal === quoted) &&
    line.subtotal === totals.subtotal &&
    line.discount === totals.discount &&
    line.tax === totals.tax &&
    line.total === totals.total &&
    overallDiscount === BigInt(0) &&
    credit === BigInt(0) &&
    creditToBalance === BigInt(0) &&
    balance === BigInt(0) &&
    grandTotal === overallTotal &&
    grandTotalTax === overallTax;
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
  | 'price_type_mismatch'
  | 'quantity_restrictions'
  | 'tax_mode_mismatch'
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

function getSandboxQuoteDetails(plan: BillingPlan, country: string): SandboxQuoteDetails | null {
  const config = getSandboxConfiguration(plan);
  if (!config || config.currency !== 'USD' || !/^[A-Z]{2}$/.test(country)) return null;
  const indiaPricing = country === 'IN' ? getServerPricingForCountry('IN') : null;
  if (country === 'IN' && !indiaPricing) return null;
  const amount = country === 'IN'
    ? plan === 'creator_monthly' ? indiaPricing?.creatorMonthly : indiaPricing?.creatorYearly
    : config.amount;
  const currency = country === 'IN' ? 'INR' : 'USD';
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0) return null;
  const amountMinor = normalizePaddleAmount(amount, currency);
  const baseAmountMinor = normalizePaddleAmount(config.amount, config.currency);
  if (!amountMinor || !baseAmountMinor) return null;
  return {
    plan,
    period: config.period,
    country,
    currency,
    amount,
    amountMinor,
    baseCurrency: config.currency,
    baseAmountMinor,
    priceId: config.priceId,
    consentVersion: '2',
    consentText: 'I approve this purchase and understand that the Creator subscription renews at the displayed interval until canceled. Paddle calculates any applicable tax from the billing location and displays the final total before payment.',
    renewalLabel: config.period === 'yearly' ? 'Renews every 12 months' : 'Renews every month',
    liveCheckoutDisabled: true,
  };
}

export function getSandboxQuote(
  plan: BillingPlan,
  country = 'US',
): Omit<CheckoutQuote, 'quoteToken' | 'expiresAt'> | null {
  const details = getSandboxQuoteDetails(plan, country);
  if (!details) return null;
  return {
    plan: details.plan,
    period: details.period,
    country: details.country,
    currency: details.currency,
    amount: details.amount,
    consentVersion: details.consentVersion,
    consentText: details.consentText,
    renewalLabel: details.renewalLabel,
    liveCheckoutDisabled: details.liveCheckoutDisabled,
  };
}

function quoteSigningSecret(): string | null {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  return secret?.trim() || null;
}

function signQuotePayload(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function encodeQuoteToken(claims: SandboxQuoteClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${signQuotePayload(payload, secret)}`;
}

export function getTrustedPaddleCountry(headers: Headers): string {
  if (process.env.VERCEL !== '1') return 'US';
  const country = headers.get('x-vercel-ip-country')?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : 'US';
}

export function verifySandboxQuoteToken(
  token: string,
  at = new Date(),
): SandboxQuoteClaims | null {
  const secret = quoteSigningSecret();
  if (!secret || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = Buffer.from(signQuotePayload(payload, secret));
  const provided = Buffer.from(signature);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) return null;
  try {
    const raw = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<SandboxQuoteClaims>;
    if (raw.version !== 2 ||
        (raw.plan !== 'creator_monthly' && raw.plan !== 'creator_yearly') ||
        typeof raw.period !== 'string' ||
        typeof raw.country !== 'string' || !/^[A-Z]{2}$/.test(raw.country) ||
        (raw.currency !== 'USD' && raw.currency !== 'INR') ||
        typeof raw.amount !== 'number' || !Number.isFinite(raw.amount) ||
        typeof raw.amountMinor !== 'string' || !/^\d+$/.test(raw.amountMinor) ||
        typeof raw.priceId !== 'string' || !raw.priceId.trim() ||
        typeof raw.productId !== 'string' || !raw.productId.trim() ||
        typeof raw.baseCurrency !== 'string' ||
        typeof raw.baseAmountMinor !== 'string' || !/^\d+$/.test(raw.baseAmountMinor) ||
        typeof raw.issuedAt !== 'number' || !Number.isSafeInteger(raw.issuedAt) ||
        typeof raw.expiresAt !== 'number' || !Number.isSafeInteger(raw.expiresAt) ||
        raw.expiresAt - raw.issuedAt !== SANDBOX_QUOTE_TTL_SECONDS) return null;
    const details = getSandboxQuoteDetails(raw.plan, raw.country);
    if (!details ||
        raw.period !== details.period ||
        raw.currency !== details.currency ||
        raw.amount !== details.amount ||
        raw.amountMinor !== details.amountMinor ||
        raw.priceId !== details.priceId ||
        raw.baseCurrency !== details.baseCurrency ||
        raw.baseAmountMinor !== details.baseAmountMinor) return null;
    const timestamp = at.getTime() / 1000;
    if (!Number.isFinite(timestamp) || raw.issuedAt > timestamp + 60 || raw.expiresAt < timestamp) return null;
    return raw as SandboxQuoteClaims;
  } catch {
    return null;
  }
}

export function verifySandboxPriceRecord(price: PaddlePrice, plan: BillingPlan): void {
  const config = getSandboxConfiguration(plan);
  if (!config || config.currency !== 'USD') throw new PaddlePriceMismatchError('quote_configuration');
  const expectedInterval = config.period === 'monthly' ? 'month' : 'year';
  if (price.id !== config.priceId || !price.productId) {
    throw new PaddlePriceMismatchError('price_identity');
  }
  if (price.status !== 'active') throw new PaddlePriceMismatchError('price_inactive');
  if (price.type !== 'standard') throw new PaddlePriceMismatchError('price_type_mismatch');
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
  const quantity = price.quantity;
  if (!quantity || !Number.isSafeInteger(quantity.minimum) || !Number.isSafeInteger(quantity.maximum) ||
      quantity.minimum < 1 || quantity.maximum < quantity.minimum || quantity.minimum > 1 || quantity.maximum < 1) {
    throw new PaddlePriceMismatchError('quantity_restrictions');
  }
  if (price.taxMode !== 'location') throw new PaddlePriceMismatchError('tax_mode_mismatch');

  const expectedIndiaAmount = getServerPricingForCountry('IN');
  const expectedAmount = expectedIndiaAmount
    ? plan === 'creator_monthly' ? expectedIndiaAmount.creatorMonthly : expectedIndiaAmount.creatorYearly
    : null;
  const expectedMinor = expectedAmount === null ? null : normalizePaddleAmount(expectedAmount, 'INR');
  const overrides = price.unitPriceOverrides;
  const override = Array.isArray(overrides) && overrides.length === 1 ? overrides[0] : null;
  if (!override || !Array.isArray(override.countryCodes) ||
      override.countryCodes.length !== 1 ||
      override.countryCodes[0] !== 'IN' ||
      !override.unitPrice ||
      override.unitPrice.currencyCode !== 'INR' ||
      !expectedMinor ||
      normalizePaddleAmount(override.unitPrice.amount, 'INR', 'minor') !== expectedMinor) {
    throw new PaddlePriceMismatchError('price_override');
  }
}

export async function assertSandboxPriceMatches(
  paddle: Paddle,
  plan: BillingPlan,
): Promise<PaddlePrice> {
  if (getPaddleEnvironment() !== 'sandbox') throw new Error('Paddle sandbox is not selected');
  const config = getSandboxConfiguration(plan);
  if (!config || config.currency !== 'USD') {
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
  verifySandboxPriceRecord(price, plan);
  return price;
}

export async function createSandboxCheckoutQuote(
  paddle: Paddle,
  plan: BillingPlan,
  country: string,
  now = new Date(),
): Promise<CheckoutQuote> {
  const details = getSandboxQuoteDetails(plan, country);
  if (!details) throw new PaddlePriceMismatchError('quote_configuration');
  const price = await assertSandboxPriceMatches(paddle, plan);
  if (now.getTime() < 0 || !Number.isFinite(now.getTime())) throw new Error('Invalid quote issue time');
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + SANDBOX_QUOTE_TTL_SECONDS;
  const claims: SandboxQuoteClaims = {
    version: 2,
    plan,
    period: details.period,
    country,
    currency: details.currency,
    amount: details.amount,
    amountMinor: details.amountMinor,
    priceId: details.priceId,
    productId: price.productId,
    baseCurrency: details.baseCurrency,
    baseAmountMinor: details.baseAmountMinor,
    issuedAt,
    expiresAt,
  };
  const secret = quoteSigningSecret();
  if (!secret) throw new Error('Paddle quote signing is not configured');
  const quoteToken = encodeQuoteToken(claims, secret);
  return {
    plan,
    period: details.period,
    country,
    currency: details.currency,
    amount: details.amount,
    consentVersion: '2',
    consentText: details.consentText,
    renewalLabel: details.renewalLabel,
    liveCheckoutDisabled: true,
    quoteToken,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
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
    const quote = input.quoteToken ? verifySandboxQuoteToken(input.quoteToken) : null;
    if (!quote || quote.plan !== input.plan || quote.period !== input.period ||
        quote.amount !== input.amount || quote.currency !== input.currency ||
        quote.productId === '') {
      throw new PaddlePriceMismatchError('quote_configuration');
    }
    const price = await assertSandboxPriceMatches(this.paddle, input.plan);
    if (price.id !== quote.priceId || price.productId !== quote.productId) {
      throw new PaddlePriceMismatchError('price_identity');
    }

    const transaction = await this.paddle.transactions.create({
      items: [{ priceId: quote.priceId, quantity: 1 }],
      currencyCode: quote.currency,
      collectionMode: 'automatic',
      customData: {
        sup_user_id: input.userId,
        sup_plan: input.plan,
        sup_consent_hash: input.consentHash,
        sup_consent_version: input.consentVersion,
        sup_reservation_id: input.reservationId,
        sup_quote_token: input.quoteToken,
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
