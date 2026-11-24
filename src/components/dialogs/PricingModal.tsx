'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { CloseIcon } from '@/components/icons';
import { formatPrice, formatPriceZero, formatSavingsPercent, type RegionalPricing } from '@/lib/pricing';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import { useSession } from 'next-auth/react';
import { useRegionalPricing } from '@/hooks/useRegionalPricing';
import { PRICING_PLANS } from '@/constants';
import type { CheckoutQuote } from '@/lib/billing/contracts';
import { CHECKOUT_NOTICE, checkoutNoticeFor, type CheckoutNoticeKind } from './checkoutNotice';
import '@/styles/pricing.css';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
  userPlan?: string;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  initialTier?: TierKey;
  initialBillingPeriod?: BillingPeriod;
}

type BillingPeriod = 'monthly' | 'yearly';

type TierKey = keyof typeof PRICING_PLANS;

interface ActiveSubscriptionNotice {
  plan: string;
  status: string;
  nextChargeAt: string | null;
  paidThroughAt: string | null;
  cancelAtPeriodEnd: boolean;
}

async function requestCheckoutQuote(period: BillingPeriod): Promise<CheckoutQuote> {
  const response = await fetch('/api/paddle/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ period }),
  });
  const quote = await response.json().catch(() => ({ error: 'Failed to create quote' }));
  if (!response.ok) throw new Error(quote.error || 'Failed to create quote');
  if (typeof quote.plan !== 'string' || typeof quote.period !== 'string' ||
      typeof quote.country !== 'string' || typeof quote.amount !== 'number' ||
      typeof quote.currency !== 'string' || typeof quote.quoteToken !== 'string' ||
      typeof quote.expiresAt !== 'string') {
    throw new Error('Paddle returned an invalid quote');
  }
  return quote as CheckoutQuote;
}

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TIERS: TierKey[] = ['free', 'creator'];

const BADGES: Partial<Record<TierKey, string>> = { creator: 'Most Popular' };

function getPlanId(tier: TierKey, period: BillingPeriod): string {
  if (tier === 'free') return 'free';
  return `${tier}_${period}`;
}

export function PricingModal({ isOpen, onClose, showToast, userPlan, isAuthenticated = false, onAuthRequired, initialTier, initialBillingPeriod }: PricingModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const [step, setStep] = useState<'select' | 'processing' | 'error'>('select');
  const [selectedTier, setSelectedTier] = useState<TierKey>('creator');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [pendingReservationId, setPendingReservationId] = useState<string | null>(null);
  const [activeSubscription, setActiveSubscription] = useState<ActiveSubscriptionNotice | null>(null);
  const [notice, setNotice] = useState<CheckoutNoticeKind | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  // One checkout creation and hand-off at a time. Two handlers firing
  // before React re-renders (a double tap, Enter plus click) would otherwise
  // POST twice or open the same payment session in two tabs.
  const submitLock = useRef(false);
  const { update } = useSession();

  const selectedPlan = getPlanId(selectedTier, billingPeriod);
  // Region detection only runs while the sheet is open, so a page that merely
  // mounts it makes no third-party request. The hook guarantees the loading
  // state always terminates and falls back to the US table.
  const { pricing: currentPricing, isLoading: isLoadingPricing } = useRegionalPricing(isOpen);


  // Apply the landing/studio plan intent on open (e.g. ?checkout=creator_monthly
  // preselects Creator Monthly) and start from the plan grid.
  useEffect(() => {
    if (!isOpen) return;
    if (initialTier) setSelectedTier(initialTier);
    if (initialBillingPeriod) setBillingPeriod(initialBillingPeriod);
    setStep('select');
    setNotice(null);
    setPendingReservationId(null);
    setActiveSubscription(null);
    setIsCheckingStatus(false);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setPendingReservationId(null);
      setNotice(null);
      setStep('select');
    }
  }, [isOpen]);

  const format = (amount: number) => formatPrice(amount, currentPricing.symbol, currentPricing.locale);

  const formatZero = (amount: number) => formatPriceZero(amount, currentPricing.symbol, currentPricing.locale);

  const getUserPlanTier = (): TierKey | null => {
    if (!userPlan || userPlan === 'free') return 'free';
    if (userPlan.startsWith('creator')) return 'creator';
    if (userPlan.startsWith('pro')) return 'creator'; // Pro internal → show as Creator (not customer-facing)
    return null;
  };
  const currentTier = getUserPlanTier();
  const isFreeCurrent = selectedTier === currentTier && selectedTier === 'free';

  const getTierPrice = (tier: TierKey, period: BillingPeriod): number => {
    if (tier === 'free') return 0;
    const key = `${tier}${period === 'monthly' ? 'Monthly' : 'Yearly'}` as keyof RegionalPricing;
    return (currentPricing[key] as number) || 0;
  };

  const handleClose = useCallback(() => {
    setStep('select');
    setSelectedTier('creator');
    setBillingPeriod('monthly');
    setNotice(null);
    setPendingReservationId(null);
    setActiveSubscription(null);
    setIsCheckingStatus(false);
    closeModal();
  }, [closeModal]);

  // The dialog panel — the boundary for the Tab trap below, and the root the
  // initial-focus effect queries. Declared up here because the trap effect
  // closes over it.
  const dialogRef = useRef<HTMLDivElement>(null);
  // The control that opened this dialog, so closing hands focus back to it.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Escape dismisses; Tab is trapped inside the sheet. This dialog is modal in
  // every other respect (backdrop, scroll lock, aria-modal), so keyboard focus
  // must not be able to fall out onto the page behind it.
  useEffect(() => {
    if (!shouldRender) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = Array.from(
        root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !root.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !root.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [shouldRender, handleClose]);

  const handleSubscribe = useCallback(async () => {
    if (!isAuthenticated) {
      handleClose();
      onAuthRequired?.();
      showToast('Please log in or create an account to continue');
      return;
    }
    if (selectedPlan === 'free') {
      showToast('Free plan activated!');
      handleClose();
      return;
    }
    if (submitLock.current) return;
    submitLock.current = true;
    setStep('processing');
    setIsCheckingStatus(false);
    setNotice(null);
    try {
      // One quote, then the existing reservation-protected checkout. The
      // server re-verifies this quote, the live price, the account identity
      // and the consent hash before any provider transaction is created.
      const quote = await requestCheckoutQuote(billingPeriod);
      if (quote.plan !== selectedPlan) {
        setNotice('unavailable');
        setStep('error');
        return;
      }
      const consent = {
        plan: quote.plan,
        period: quote.period,
        amount: quote.amount,
        currency: quote.currency,
        consentVersion: '2' as const,
        quoteToken: quote.quoteToken,
      };
      const canonical = JSON.stringify(consent);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
      const consentHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const checkoutResponse = await fetch('/api/paddle/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ ...consent, consentHash }),
      });
       const checkout = await checkoutResponse.json().catch(() => ({})) as {
         status?: unknown;
         error?: unknown;
         state?: unknown;
         subscription?: ActiveSubscriptionNotice;
         reservationId?: unknown;
          transactionId?: unknown;
         checkoutUrl?: unknown;
       };
      if (!checkoutResponse.ok) {
        if (checkout.state === 'active_subscription' && checkout.subscription) {
          setActiveSubscription(checkout.subscription);
        }
        if (typeof checkout.reservationId === 'string') {
          setPendingReservationId(checkout.reservationId);
        }
        setNotice(checkoutNoticeFor(checkoutResponse.status, checkout));
        setStep('error');
        return;
      }
      if (checkout.status === 'payment_received') {
        // A checkout creation response is never sufficient proof of payment.
        // Keep the customer in a recoverable state; only the status endpoint
        // plus entitlement grant can complete activation.
        if (typeof checkout.reservationId === 'string') {
          setPendingReservationId(checkout.reservationId);
        }
        setNotice('unknown');
        setStep('error');
        return;
      }
      if (typeof checkout.checkoutUrl !== 'string' || !checkout.checkoutUrl) {
        setNotice('temporary');
        setStep('error');
        return;
      }
      setPendingReservationId(null);
      showToast('Redirecting to Paddle...');
      try {
        sessionStorage.setItem('sxs-checkout-return', JSON.stringify({
          transactionId: typeof checkout.transactionId === 'string' ? checkout.transactionId : null,
          reservationId: typeof checkout.reservationId === 'string' ? checkout.reservationId : null,
          createdAt: Date.now(),
        }));
      } catch {}
      window.location.assign(checkout.checkoutUrl);
    } catch {
      setNotice('temporary');
      setStep('error');
    } finally {
      submitLock.current = false;
    }
  }, [selectedPlan, billingPeriod, showToast, isAuthenticated, onAuthRequired, handleClose]);

  const handleCheckPendingCheckout = useCallback(async () => {
    if (!pendingReservationId || submitLock.current) return;
    submitLock.current = true;
    setStep('processing');
    setIsCheckingStatus(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/paddle/checkout/status?reservationId=${encodeURIComponent(pendingReservationId)}`,
        { credentials: 'same-origin', cache: 'no-store' },
      );
      const checkout = await response.json().catch(() => ({})) as {
        status?: unknown;
        checkoutUrl?: unknown;
        retryAllowed?: unknown;
      };
      if (response.ok && checkout.status === 'payment_received') {
        // Payment status is not entitlement status. Keep the reservation
        // visible and let the user explicitly re-check until the worker grants
        // the entitlement.
        setNotice('activating');
        setStep('processing');
        return;
      }
      if (response.ok && typeof checkout.checkoutUrl === 'string') {
        window.location.assign(checkout.checkoutUrl);
        return;
      }
      if (response.ok && checkout.retryAllowed === true) {
        // The backend verified the earlier attempt ended without a live
        // transaction, so a new attempt cannot duplicate a payment.
        setPendingReservationId(null);
        setNotice('cancelled');
      } else {
        // Any other answer means the outcome is still unknown: never invite a
        // second payment while the first may be processing.
        setNotice('unknown');
      }
      setStep('error');
    } catch {
      setNotice('unknown');
      setStep('error');
    } finally {
      submitLock.current = false;
      setIsCheckingStatus(false);
    }
  }, [pendingReservationId]);

  useEffect(() => {
    if (!isOpen || (notice !== 'checking' && notice !== 'activating') || !pendingReservationId) return;
    let cancelled = false;
    let completed = false;
    let polling = false;
    let attempts = 0;
    const maxAttempts = 15;
    const timer = setInterval(async () => {
      if (cancelled || completed || polling) return;
      polling = true;
      attempts += 1;
      try {
        const response = await fetch(`/api/paddle/checkout/status?reservationId=${encodeURIComponent(pendingReservationId)}`, { credentials: 'same-origin', cache: 'no-store' });
        if (cancelled || completed) return;
        if (response.ok) {
          const body = await response.json().catch(() => ({})) as { account?: { status?: string; paidThroughAt?: string | null }; status?: string };
          // If checkout status says payment_received, verify entitlement via billing API
          if (body?.status === 'payment_received') {
            const billingResponse = await fetch('/api/paddle/billing', { credentials: 'same-origin', cache: 'no-store' });
            if (cancelled || completed) return;
            if (billingResponse.ok) {
              const billing = await billingResponse.json().catch(() => ({})) as { account?: { status?: string; paidThroughAt?: string | null } };
              const account = billing?.account;
              if (account?.status === 'active' && account.paidThroughAt && new Date(account.paidThroughAt).getTime() > Date.now()) {
                completed = true;
                clearInterval(timer);
                try { await update(); } catch {}
                if (cancelled) return;
                setNotice(null);
                setStep('select');
                setPendingReservationId(null);
                showToast('Creator access activated.');
                return;
              }
            }
            // payment_received but entitlement not yet active - continue polling
          }
        }
      } catch {}
      finally {
        polling = false;
      }
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        if (!cancelled && !completed) {
          setNotice('timeout');
        }
      }
    }, 2000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [isOpen, notice, pendingReservationId, update, showToast]);

  // UX-012: this dialog has always had NO initial focus — focus stayed on the
  // trigger behind it, so keyboard and screen-reader users opened the pricing
  // sheet with nothing focused inside it. Same rule the shared Modal uses (an
  // explicit opt-in marker, else the first control that is not the header
  // Close). Deliberately NOT a refactor into the shared Modal: unifying the
  // dialog systems is Phase 6 work and out of this phase's scope.
  useEffect(() => {
    if (!shouldRender || isLoadingPricing) return;
    const root = dialogRef.current;
    if (!root) return;

    const explicit = root.querySelector<HTMLElement>('[data-modal-initial-focus]');
    // A disabled marker (here: the CTA when the viewer already holds the
    // selected tier) cannot take focus, so it must not end the search.
    if (explicit && !explicit.hasAttribute('disabled')) {
      explicit.focus();
      return;
    }
    const focusable = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusable.length === 0) return;
    const firstTaskControl =
      focusable.find((el) => el.getAttribute('aria-label') !== 'Close') ?? focusable[0];
    firstTaskControl.focus();
    // `step` is a dependency on purpose: replacing the plan grid with the
    // processing panel or an outcome message is a new task, and focus may not
    // stay on a control that no longer exists.
    // `isLoadingPricing` is the important one: while the geo lookup is in
    // flight the body is the UX-013 skeleton, whose bars are aria-hidden
    // placeholders with no focusable control in them — so focusing here would
    // find the header Close as the only candidate and land focus on "leave".
    // Waiting until real content exists is what makes the task-control rule
    // below mean anything.
  }, [shouldRender, step, isLoadingPricing]);

  // Record the trigger when the sheet opens; hand focus back once it is gone.
  // Only restores when focus would otherwise be lost, so a dialog stacked on
  // top of this one keeps its own focus.
  useEffect(() => {
    if (shouldRender) {
      const active = document.activeElement;
      returnFocusRef.current = active instanceof HTMLElement ? active : null;
      return;
    }
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    const active = document.activeElement;
    const focusIsLost =
      active === null ||
      active === document.body ||
      active === document.documentElement ||
      !active.isConnected;
    if (target && target.isConnected && focusIsLost) {
      target.focus();
    }
  }, [shouldRender]);

  if (!shouldRender) return null;

  // §7 (label/title mismatch): the dialog's accessible name was hard-coded to
  // "Choose Plan" while the visible heading changes with the step, so on the
  // payment form, while processing, and on error the screen-reader name
  // announced a screen the user was not looking at. One source of truth for
  // both, so they cannot drift apart again.
  const dialogTitle =
    step === 'select' ? 'Choose Your Plan'
    : step === 'processing' ? (isCheckingStatus ? CHECKOUT_NOTICE.checking.title : 'Preparing Secure Checkout')
    : notice ? CHECKOUT_NOTICE[notice].title
    : 'Checkout';

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label={dialogTitle} {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleClose}
      />

      <div ref={dialogRef} className={`relative w-full max-w-[960px] bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">{dialogTitle}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-2.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 min-h-0">
          {isLoadingPricing ? (
            /* UX-013: this was a centred spinner (~130px) standing in for a
               plan grid several times that height, so the dialog jumped every
               time regional pricing resolved. The skeleton mirrors the shape it
               stands in for — toggle row, then one card per tier with a price
               bar — so the swap is close to height-neutral. Deliberately built
               from plain elements rather than the lsx-pricing-* classes so it
               cannot drift out of sync with the real layout. Pulse only; the
               global prefers-reduced-motion rule in globals.css neutralises it. */
            <div role="status" aria-label="Loading prices" className="flex flex-col gap-8">
              <div className="flex gap-2" aria-hidden="true">
                <div className="h-9 w-24 rounded-md bg-elevated animate-pulse" />
                <div className="h-9 w-32 rounded-md bg-elevated animate-pulse" />
              </div>
              <div className="grid gap-4 sm:grid-cols-2" aria-hidden="true">
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="flex flex-col gap-3 rounded-xl border border-border-subtle p-6"
                  >
                    <div className="h-4 w-20 rounded bg-elevated animate-pulse" />
                    <div className="h-8 w-28 rounded bg-elevated animate-pulse" />
                    <div className="h-3 w-full rounded bg-elevated animate-pulse" />
                    <div className="h-3 w-5/6 rounded bg-elevated animate-pulse" />
                    <div className="h-3 w-4/6 rounded bg-elevated animate-pulse" />
                  </div>
                ))}
              </div>
              <p className="sr-only">Detecting your region to load prices.</p>
            </div>
          ) : (
            <>
              {step === 'select' && (
                <div className="flex flex-col gap-8">
                  {/* Billing period toggle */}
                  <div className="lsx-pricing-toggle" role="group" aria-label="Billing period">
                    <button
                      type="button"
                      onClick={() => setBillingPeriod('monthly')}
                      aria-pressed={billingPeriod === 'monthly'}
                      className={`lsx-pricing-toggle-btn ${billingPeriod === 'monthly' ? 'lsx-pricing-toggle-btn--active' : ''}`}
                    >
                      1 month
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingPeriod('yearly')}
                      aria-pressed={billingPeriod === 'yearly'}
                      className={`lsx-pricing-toggle-btn ${billingPeriod === 'yearly' ? 'lsx-pricing-toggle-btn--active' : ''}`}
                    >
                      1 year <span className="lsx-pricing-toggle-save">{formatSavingsPercent(currentPricing.creatorMonthly, currentPricing.creatorYearly)}</span>
                    </button>
                  </div>

                  {/* Plan cards */}
                  <div className="lsx-pricing-grid">
                    {TIERS.map((tier) => {
                      const plan = PRICING_PLANS[tier];
                      const badge = tier === currentTier ? 'Current Plan' : BADGES[tier];
                      const isSelected = selectedTier === tier;
                      const isCurrentPlan = tier === currentTier;
                      const isSelectable = tier !== 'free' && (!isCurrentPlan || currentTier !== 'free');
                      const price = getTierPrice(tier, billingPeriod);
                      const periodLabel = tier === 'free' ? '/forever' : billingPeriod === 'monthly' ? ' for 1 month' : ' for 1 year';

                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => setSelectedTier(tier)}
                          disabled={!isSelectable}
                          className={`lsx-pricing-card ${isSelected ? 'lsx-pricing-card--selected' : ''} ${tier !== 'free' ? 'lsx-pricing-card--pro' : ''} ${isCurrentPlan ? 'lsx-pricing-card--current' : ''}`}
                        >
                          {badge && (
                            <div className="lsx-pricing-badge">{badge}</div>
                          )}
                          <div className="lsx-pricing-card-header">
                            <h3 className="lsx-pricing-plan">{plan.name}</h3>
                            <div className="lsx-pricing-price">
                              {price === 0 ? formatZero(0) : format(price)}
                              <span className="lsx-pricing-period">{periodLabel}</span>
                            </div>
                            {tier !== 'free' && billingPeriod === 'yearly' && (
                              <p className="lsx-pricing-note">Renews every 12 months until canceled.</p>
                            )}
                            {tier !== 'free' && billingPeriod === 'monthly' && (
                              <p className="lsx-pricing-note">Renews every month until canceled.</p>
                            )}
                          </div>
                          <ul className="lsx-pricing-features">
                            {plan.features.map((f) => (
                              <li key={f.text} className={`lsx-pricing-feature ${f.highlight ? 'lsx-pricing-feature--highlight' : ''}`}>
                                {CHECK_ICON}
                                {f.text}
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>

                  {/* CTA */}
                  <Button
                    variant={isFreeCurrent ? 'secondary' : 'primary'}
                    size="lg"
                    onClick={handleSubscribe}
                    disabled={isFreeCurrent}
                    className="lsx-pricing-btn"
                    data-modal-initial-focus
                  >
                    {isFreeCurrent
                      ? 'Current Plan'
                      : selectedPlan === 'free'
                        ? PRICING_PLANS.free.cta
                        : `Subscribe — ${format(getTierPrice(selectedTier, billingPeriod))}${billingPeriod === 'monthly' ? ' / month' : ' / year'}`}
                  </Button>

                  <p className="text-xs text-text-muted text-center">
                    Secure recurring subscription powered by Paddle. Cancel any time to stop future renewals.
                  </p>
                </div>
              )}

              {step === 'processing' && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-text-secondary text-center" aria-live="polite">
                    {isCheckingStatus
                      ? CHECKOUT_NOTICE.checking.message
                      : 'Connecting to our secure payment provider.'}
                  </p>
                </div>
              )}

              {step === 'error' && notice && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="w-12 h-12 rounded-full bg-recording/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-recording" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div className="text-center">
                    {(notice === 'conflict' || notice === 'payment_retry') && activeSubscription ? (
                      <div className="mt-2 space-y-1 text-sm text-text-secondary">
                        <p>You're subscribed to {activeSubscription.plan === 'creator_yearly' ? 'Creator Yearly' : 'Creator Monthly'}.</p>
                        {notice === 'payment_retry' && <p>Your latest payment needs attention. Use the payment recovery link in your account menu.</p>}
                        {activeSubscription.cancelAtPeriodEnd && activeSubscription.paidThroughAt ? (
                          <p>Your access continues until {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(activeSubscription.paidThroughAt))}.</p>
                        ) : activeSubscription.nextChargeAt ? (
                          <p>Next billing date: {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(activeSubscription.nextChargeAt))}.</p>
                        ) : activeSubscription.paidThroughAt ? (
                          <p>Access through {new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date(activeSubscription.paidThroughAt))}.</p>
                        ) : null}
                        <p>Manage your subscription from the account menu.</p>
                      </div>
                    ) : (
                      <p className="text-sm text-text-secondary">{CHECKOUT_NOTICE[notice].message}</p>
                    )}
                    {notice !== 'conflict' && notice !== 'payment_retry' && <p className="text-xs text-text-secondary mt-1">Your current access stays unchanged until a payment is verified.</p>}
                    {(notice === 'unknown' || notice === 'timeout' || notice === 'temporary' || notice === 'cancelled') && (
                      <Link href="/contact" className="mt-3 inline-block text-xs text-accent underline" onClick={handleClose}>
                        Need help with this payment?
                      </Link>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 w-full max-w-[220px]">
                    {notice === 'unknown' && pendingReservationId ? (
                      <Button variant="secondary" onClick={handleCheckPendingCheckout}>Check previous checkout</Button>
                    ) : notice === 'checking' && pendingReservationId ? (
                      <Button variant="secondary" onClick={handleCheckPendingCheckout}>Check checkout status</Button>
                    ) : notice === 'activating' && pendingReservationId ? (
                      <Button variant="secondary" onClick={handleCheckPendingCheckout}>Check activation</Button>
                    ) : notice === 'timeout' && pendingReservationId ? (
                      <Button variant="secondary" onClick={handleCheckPendingCheckout}>Check safely</Button>
                    ) : notice === 'conflict' || notice === 'payment_retry' ? (
                      <Button variant="secondary" onClick={handleClose}>Close and manage from account menu</Button>
                    ) : notice === 'temporary' || notice === 'cancelled' ? (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setNotice(null);
                          setStep('select');
                        }}
                      >
                        Try again
                      </Button>
                    ) : null}
                    <Button variant="ghost" onClick={handleClose}>Close</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
