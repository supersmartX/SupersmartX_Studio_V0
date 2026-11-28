'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { PricingModal } from '@/components/dialogs/PricingModal';
import { Toast } from '@/components/common/Toast';
import { useToast } from '@/hooks/useToast';
import { useAccountBilling } from '@/hooks/useAccountBilling';
import { formatBillingDate, humanizeAccountStatus } from '@/lib/billing/humanize';
import { isCreatorPlan } from '@/lib/entitlements';

/**
 * The account surface: profile, plan state, and the billing actions.
 *
 * The Header user menu stays a compact summary; every action that needs room
 * (the three-state cancellation flow, plan management, sign out) lives here,
 * where status lines can be read in full and the same shared
 * `useAccountBilling` hook powers both surfaces without drifting.
 */
export function SettingsClient() {
  const { data: session, status } = useSession();
  const user = session?.user;
  const isCreator = isCreatorPlan(user?.plan ?? 'free');
  const { showToast, toast, queueLength } = useToast();
  const { stats, paddle, cancelRequested, cancelNotice, cancelAtPeriodEnd } = useAccountBilling({ enabled: true });
  const [isPricingOpen, setIsPricingOpen] = useState(false);

  const accountStatus = paddle?.account?.status ?? null;
  const humanStatus = humanizeAccountStatus(accountStatus);
  const accessUntil = stats?.planActive && stats.planExpiresAt ? formatBillingDate(stats.planExpiresAt) : null;
  const expiredOn = stats && !stats.planActive && stats.planExpiresAt ? formatBillingDate(stats.planExpiresAt) : null;
  const paymentFailed = !!accountStatus && ['past_due', 'payment_failed'].includes(accountStatus);
  const canCancel =
    isCreator &&
    accountStatus === 'active' &&
    Boolean(paddle?.account?.paidThroughAt && new Date(paddle.account.paidThroughAt).getTime() > Date.now()) &&
    !paddle?.account?.cancellationConfirmed;

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 text-text-primary sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-text-secondary">Account</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-2 text-sm text-text-secondary">Your profile, plan and billing in one place.</p>
          </div>
          <Link href="/studio" className="rounded-md border border-border-default px-3 py-2 text-sm text-text-secondary hover:bg-elevated">
            Back to Studio
          </Link>
        </div>

        {/* Profile */}
        <section className="rounded-xl border border-border-default bg-surface p-5">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent text-[14px] font-bold overflow-hidden">
              {user?.image ? (
                <img src={user.image} alt="" className="w-full h-full object-cover" />
              ) : (
                (user?.name?.[0] || user?.email?.[0] || '?').toUpperCase()
              )}
            </span>
            <div className="min-w-0">
              <p className="font-semibold truncate">{user?.name || 'User'}</p>
              <p className="text-sm text-text-secondary truncate">{user?.email}</p>
            </div>
          </div>
        </section>

        {/* Plan & billing */}
        <section className="rounded-xl border border-border-default bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Plan &amp; billing</h2>
            <div className="flex items-center gap-2">
              <span
                className={`text-[11px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  isCreator ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary'
                }`}
              >
                {isCreator ? 'Creator' : 'Free'}
              </span>
              {accountStatus && (
                <span
                  className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${
                    humanStatus.tone === 'warning' ? 'text-warning' : 'text-text-secondary'
                  }`}
                >
                  {humanStatus.label}
                </span>
              )}
            </div>
          </div>

          <p className="mt-2 text-sm text-text-secondary">
            {isCreator
              ? 'Unlimited recording duration and sessions.'
              : 'Up to 10 min of recording per day, per browser profile.'}
          </p>

          <dl className="mt-4 space-y-1.5 text-sm">
            {accessUntil && (
              <div className="flex gap-2">
                <dt className="text-text-muted">Access until</dt>
                <dd className="text-text-primary">{accessUntil}</dd>
              </div>
            )}
            {expiredOn && (
              <div className="flex gap-2">
                <dt className="text-text-muted">Creator term ended</dt>
                <dd className="text-text-primary">{expiredOn}</dd>
              </div>
            )}
            {paddle?.account?.nextChargeAt && (
              <div className="flex gap-2">
                <dt className="text-text-muted">Next charge</dt>
                <dd className="text-text-primary">{formatBillingDate(paddle.account.nextChargeAt)}</dd>
              </div>
            )}
            {paddle?.account?.cancellationConfirmed && (
              <div className="flex gap-2">
                <dt className="text-text-muted">Cancellation</dt>
                <dd className="text-accent">Scheduled for the end of the paid period</dd>
              </div>
            )}
            {paddle?.account?.cancelAtPeriodEnd && !paddle?.account?.cancellationConfirmed && (
              <div className="flex gap-2">
                <dt className="text-text-muted">Cancellation</dt>
                <dd className="text-text-secondary">Pending confirmation…</dd>
              </div>
            )}
          </dl>

          {paymentFailed && (
            <p role="status" className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-[13px] text-warning">
              Your latest payment needs attention.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              onClick={() => setIsPricingOpen(true)}
              size="md"
            >
              {isCreator ? 'Manage plan' : expiredOn ? 'Renew Creator' : 'Upgrade to Creator'}
            </Button>
            <Link
              href="/billing"
              className="rounded-lg border border-border-default px-4 text-sm font-medium text-text-secondary leading-[40px] hover:bg-elevated hover:text-text-primary transition-colors"
            >
              Billing history
            </Link>
            {paddle?.account?.paymentMethodUpdateUrl && (
              <a
                href={paddle.account.paymentMethodUpdateUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-border-default px-4 text-sm font-medium text-accent-text leading-[40px] hover:bg-elevated transition-colors"
              >
                Retry payment or update payment method
              </a>
            )}
          </div>

          {canCancel && (
            <div className="mt-3 border-t border-border-subtle pt-3">
              <button
                type="button"
                disabled={cancelRequested}
                onClick={cancelAtPeriodEnd}
                className="text-[13px] font-medium text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {cancelRequested
                  ? 'Cancellation awaiting confirmation…'
                  : paddle?.account?.cancelAtPeriodEnd
                    ? 'Check cancellation status'
                    : 'Cancel at period end'}
              </button>
              <p className="mt-1 text-[11px] text-text-muted">
                Your access and recordings stay intact until the paid period ends.
              </p>
            </div>
          )}
          {cancelNotice && (
            <p role="status" aria-live="polite" className="mt-3 text-[13px] text-text-secondary">
              {cancelNotice}
            </p>
          )}
        </section>

        {/* Support + sign out */}
        <section className="rounded-xl border border-border-default bg-surface p-5">
          <h2 className="font-semibold">Other</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <Link href="/contact" className="text-accent-text hover:text-accent transition-colors">
              Contact support
            </Link>
            <button
              type="button"
              onClick={async () => {
                await signOut({ callbackUrl: '/' });
              }}
              disabled={status !== 'authenticated'}
              className="text-text-secondary hover:text-text-primary transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Sign out
            </button>
          </div>
        </section>
      </div>

      <PricingModal
        isOpen={isPricingOpen}
        onClose={() => setIsPricingOpen(false)}
        showToast={showToast}
        userPlan={(user?.plan as string) || 'free'}
        isAuthenticated={Boolean(user)}
      />
      <Toast message={toast?.message ?? null} queueLength={queueLength} />
    </main>
  );
}
