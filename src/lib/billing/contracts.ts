export type BillingPeriod = 'monthly' | 'yearly';

export type BillingPlan = 'creator_monthly' | 'creator_yearly';

export interface CheckoutQuote {
  plan: BillingPlan;
  period: BillingPeriod;
  country: string;
  currency: 'USD' | 'INR';
  amount: number;
  consentVersion: '2';
  consentText: string;
  renewalLabel: string;
  liveCheckoutDisabled: boolean;
  quoteToken: string;
  expiresAt: string;
}

export interface CheckoutConsent {
  plan: BillingPlan;
  period: BillingPeriod;
  amount: number;
  currency: string;
  consentVersion: '1' | '2';
  quoteToken?: string;
  consentHash: string;
}

/** Current HTTP enrollment contract; version 1 remains readable for history. */
export interface CheckoutRequest extends CheckoutConsent {
  consentVersion: '2';
  quoteToken: string;
}

export interface ProviderCheckout {
  providerOperationId: string;
  transactionId: string | null;
  checkoutUrl: string | null;
  status: 'created' | 'mock-created';
}

export interface BillingProvider {
  createSandboxCheckout(input: CheckoutConsent & { userId: string; reservationId: string }): Promise<ProviderCheckout>;
  getSubscription(subscriptionId: string): Promise<unknown>;
  getTransaction(transactionId: string): Promise<unknown>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<unknown>;
}
