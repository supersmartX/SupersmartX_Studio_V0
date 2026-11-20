import { getPaddleCheckoutUrl, getPaddleEnvironment } from './paddle';

export type BillingReadinessIssue =
  | 'paddle_environment'
  | 'paddle_api_key'
  | 'paddle_webhook_secret'
  | 'billing_worker_secret'
  | 'paddle_checkout_url'
  | 'paddle_client_token';

/**
 * A checkout may only take money when its fulfilment path is complete.
 *
 * Webhook receipts are stored by the webhook route but applied by the worker,
 * and the worker authenticates with CRON_SECRET. Without that secret a paid
 * transaction would be recorded and never grant access, so checkout stays
 * closed instead of charging a customer it cannot fulfil.
 */
export function getBillingReadiness(): { ready: boolean; issues: BillingReadinessIssue[] } {
  const issues: BillingReadinessIssue[] = [];
  if (getPaddleEnvironment() !== 'sandbox') issues.push('paddle_environment');
  if (!process.env.PADDLE_API_KEY?.trim()) issues.push('paddle_api_key');
  if (!process.env.PADDLE_WEBHOOK_SECRET?.trim()) issues.push('paddle_webhook_secret');
  if (!process.env.CRON_SECRET?.trim()) issues.push('billing_worker_secret');

  const checkoutUrl = getPaddleCheckoutUrl();
  if (!checkoutUrl) {
    issues.push('paddle_checkout_url');
  } else if (new URL(checkoutUrl).pathname.replace(/\/+$/, '') === '/pay' &&
      !/^test_[A-Za-z0-9]+$/.test(process.env.PADDLE_CLIENT_TOKEN?.trim() ?? '')) {
    // The hosted page is our own /pay page, which cannot initialise Paddle.js
    // without a sandbox client token.
    issues.push('paddle_client_token');
  }

  return { ready: issues.length === 0, issues };
}
