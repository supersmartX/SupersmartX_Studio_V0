'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Stored billing facts from `/api/user/stats` (the DB is the authority). An
 * expired plan is indistinguishable from never having bought one without the
 * stored date, so the session's plan alone is not enough.
 */
export interface AccountBillingStatus {
  planExpiresAt: string | null;
  planActive: boolean;
}

export interface PaddleBillingSummary {
  account: {
    status: string;
    paidThroughAt: string | null;
    nextChargeAt: string | null;
    cancelAtPeriodEnd: boolean;
    cancellationConfirmed: boolean;
    paymentMethodUpdateUrl?: string | null;
  } | null;
  transactions: Array<{
    id: string;
    status: string;
    amount: number;
    currency: string;
    paidAt: string | null;
    refundedAt: string | null;
    disputedAt: string | null;
  }>;
}

interface UseAccountBillingOptions {
  /** When false, nothing is fetched and cancellation is inert. */
  enabled: boolean;
}

interface UseAccountBillingResult {
  stats: AccountBillingStatus | null;
  paddle: PaddleBillingSummary | null;
  cancelRequested: boolean;
  cancelNotice: string | null;
  cancelAtPeriodEnd: () => Promise<void>;
}

/**
 * Shared account-billing state: the stored expiry from `/api/user/stats`, the
 * Paddle summary from `/api/paddle/billing`, and the period-end cancellation
 * mutation with its three outcomes (confirmed / pending reconciliation /
 * failed).
 *
 * Extracted verbatim from the Header user menu so the new /settings page can
 * offer the identical cancellation flow without a second drifting copy. The
 * version guard matters: a billing read that started BEFORE a cancellation
 * mutation must never overwrite the post-mutation state, in either host.
 */
export function useAccountBilling({ enabled }: UseAccountBillingOptions): UseAccountBillingResult {
  const [stats, setStats] = useState<AccountBillingStatus | null>(null);
  const [paddle, setPaddle] = useState<PaddleBillingSummary | null>(null);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const cancelMutationVersion = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const currentVersion = cancelMutationVersion.current;
    let cancelled = false;
    fetch('/api/user/stats', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { planExpiresAt?: string | null; planActive?: boolean } | null) => {
        if (cancelled || !data) return;
        setStats({
          planExpiresAt: data.planExpiresAt ?? null,
          planActive: Boolean(data.planActive),
        });
      })
      .catch(() => {
        // Status is an enhancement: the surface still renders without it.
      });
    fetch('/api/paddle/billing', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: PaddleBillingSummary | null) => {
        // Discard stale billing reads that started before a cancellation mutation
        if (!cancelled && data && cancelMutationVersion.current === currentVersion) {
          setPaddle(data);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const cancelAtPeriodEnd = useCallback(async () => {
    setCancelRequested(true);
    setCancelNotice(null);
    cancelMutationVersion.current += 1;
    try {
      const res = await fetch('/api/paddle/cancel', {
        method: 'POST',
        credentials: 'same-origin',
      });
      const result = await res.json().catch(() => null) as { status?: string } | null;
      if (res.ok && result?.status === 'cancellation_requested') {
        setCancelNotice('Cancellation is confirmed for the end of your paid period.');
        setPaddle((current) => current ? {
          ...current,
          account: current.account ? { ...current.account, cancelAtPeriodEnd: true, cancellationConfirmed: true } : current.account,
        } : current);
        setCancelRequested(false);
      } else if (res.status === 202 && result?.status === 'cancellation_pending_reconciliation') {
        setCancelNotice('Paddle has not confirmed cancellation yet. Your current access remains active. Click again to check status.');
        setPaddle((current) => current ? {
          ...current,
          account: current.account ? { ...current.account, cancelAtPeriodEnd: true } : current.account,
        } : current);
        // Allow retry to check status
        setCancelRequested(false);
      } else {
        throw new Error('Cancellation could not be confirmed');
      }
    } catch {
      setCancelRequested(false);
      setCancelNotice('Cancellation could not be confirmed. Check your billing status before submitting another request.');
    }
  }, []);

  return { stats, paddle, cancelRequested, cancelNotice, cancelAtPeriodEnd };
}

/**
 * Human-facing wording for a stored Paddle account status. The raw provider
 * states (`past_due`) are internal vocabulary and never shown as-is.
 */
export function humanizeAccountStatus(status: string | null | undefined): { label: string; tone: 'neutral' | 'warning' } {  switch (status) {
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
