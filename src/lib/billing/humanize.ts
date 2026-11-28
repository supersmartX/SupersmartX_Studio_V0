/**
 * Pure billing display formatters. These deliberately live outside
 * `src/hooks/useAccountBilling.ts`, which is a `"use client"` module: server
 * components (for example `src/app/billing/page.tsx`) need to call these
 * directly, and Next.js cannot invoke a function exported from a client
 * module on the server. Keep this file free of React and directive comments.
 */

/**
 * Human-facing wording for a stored Paddle account status. The raw provider
 * states (`past_due`) are internal vocabulary and never shown as-is.
 */
export function humanizeAccountStatus(status: string | null | undefined): { label: string; tone: 'neutral' | 'warning' } {
  switch (status) {
    case 'active':
      return { label: 'Active', tone: 'neutral' };
    case 'past_due':
    case 'payment_failed':
      return { label: 'Payment needs attention', tone: 'warning' };
    case 'canceled':
    case 'cancelled':
      return { label: 'Canceled', tone: 'neutral' };
    case 'trialing':
      return { label: 'Trial', tone: 'neutral' };
    case 'paused':
      return { label: 'Paused', tone: 'neutral' };
    default:
      return { label: status ? status.replace(/_/g, ' ') : 'Free', tone: 'neutral' };
  }
}

/** Human-facing wording for a stored transaction status. */
export function humanizeTransactionStatus(status: string): string {
  switch (status) {
    case 'paid':
      return 'Paid';
    case 'completed':
      return 'Completed';
    case 'refunded':
      return 'Refunded';
    case 'partially_refunded':
      return 'Partially refunded';
    case 'disputed':
      return 'Disputed';
    case 'past_due':
      return 'Payment failed';
    case 'canceled':
    case 'cancelled':
      return 'Canceled';
    default:
      return status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }
}

/**
 * Stored instants render in UTC on purpose: the stored expiry is an instant,
 * and rendering it in the viewer's zone could show a date one day earlier than
 * the receipt e-mail.
 */
export function formatBillingDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
