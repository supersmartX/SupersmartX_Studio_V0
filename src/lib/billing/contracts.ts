export type BillingPeriod = 'monthly' | 'yearly';

export type BillingPlan = 'creator_monthly' | 'creator_yearly';

export interface CheckoutQuote {
  plan: BillingPlan;
  period: BillingPeriod;
  currency: string;
  amount: number;
  consentVersion: '1';
  consentText: string;
  renewalLabel: string;
  liveCheckoutDisabled: true;
}

export interface CheckoutConsent {
  plan: BillingPlan;
  period: BillingPeriod;
  amount: number;
  currency: string;
  consentVersion: '1';
  consentHash: string;
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
