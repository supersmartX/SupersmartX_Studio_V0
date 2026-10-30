'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { CloseIcon } from '@/components/icons';
import { useSession } from 'next-auth/react';
import { formatPrice, formatPriceZero, formatPriceForCurrency, formatSavingsPercent, serverPriceMatchesDisplayed, type RegionalPricing } from '@/lib/pricing';
import { loadCashfreeSDK, resolveCashfreeMode } from '@/lib/cashfree';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import { useRegionalPricing } from '@/hooks/useRegionalPricing';
import { PRICING_PLANS } from '@/constants';
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
  initialStep?: 'select' | 'form';
}

type BillingPeriod = 'monthly' | 'yearly';

type TierKey = keyof typeof PRICING_PLANS;

/** A created Cashfree order, held while the customer accepts its price. */
interface PendingCheckout {
  orderId: string;
  paymentSessionId: string;
  amount: number;
  currency: string;
}

/**
 * What this tab remembers about the checkout it created, so a retry can resume
 * that exact order instead of colliding with the one-order-at-a-time guard.
 *
 * `accepted` is the line between the two ways a checkout is abandoned: the
 * customer confirmed the price and the payment page then failed or was closed
 * (`true` — resuming is what they asked for), or they never accepted it, e.g.
 * they cancelled on the confirmation panel (`false` — the price has to be
 * accepted again before anything is charged).
 *
 * Kept in sessionStorage rather than component state so a reload on the way
 * back from the payment page does not erase the distinction; it is scoped to
 * the tab and cleared as soon as the session proves unusable.
 */
interface OpenCheckoutRecord extends PendingCheckout {
  plan: string;
  accepted: boolean;
}

const OPEN_CHECKOUT_KEY = 'sxs-open-checkout';

function readOpenCheckout(): OpenCheckoutRecord | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(OPEN_CHECKOUT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OpenCheckoutRecord> | null;
    if (
      !parsed ||
      typeof parsed.orderId !== 'string' ||
      typeof parsed.paymentSessionId !== 'string' ||
      typeof parsed.amount !== 'number' ||
      typeof parsed.currency !== 'string' ||
      typeof parsed.plan !== 'string'
    ) {
      return null;
    }
    return {
      orderId: parsed.orderId,
      paymentSessionId: parsed.paymentSessionId,
      amount: parsed.amount,
      currency: parsed.currency,
      plan: parsed.plan,
      accepted: parsed.accepted === true,
    };
  } catch {
    return null;
  }
}

function writeOpenCheckout(record: OpenCheckoutRecord | null) {
  if (typeof window === 'undefined') return;
  try {
    if (record) window.sessionStorage.setItem(OPEN_CHECKOUT_KEY, JSON.stringify(record));
    else window.sessionStorage.removeItem(OPEN_CHECKOUT_KEY);
  } catch {
    // Storage unavailable (private mode, quota). Resume then degrades to
    // re-accepting the open checkout — never to a silent second charge.
  }
}

/** The open order the server refused to duplicate, as reported by the 409. */
interface OpenCheckoutBlock {
  orderId: string;
  paymentSessionId: string | null;
  amount: number | null;
  currency: string | null;
  plan: string | null;
  status: string | null;
  retryAfterSeconds: number;
  /** True only when this tab recorded accepting this exact order. */
  alreadyAccepted: boolean;
}


function checkoutErrorMessage(err: unknown): string {
  // Never surface a raw technical string (a fetch failure, a Prisma message,
  // a DOMException). Anything that isn't a short, human sentence is replaced.
  const raw = err instanceof Error ? err.message : '';
  const looksTechnical = !raw || raw.length > 120 || /exception|prisma|undefined|cannot read|null|stack|\/[a-z]+\/|::|error:/i.test(raw);
  return looksTechnical
    ? 'We could not reach the payment service. Check your connection and try again.'
    : raw;
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

export function PricingModal({ isOpen, onClose, showToast, userPlan, isAuthenticated = false, onAuthRequired, initialTier, initialBillingPeriod, initialStep }: PricingModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const [step, setStep] = useState<'select' | 'form' | 'processing' | 'confirm-price' | 'resume-checkout' | 'error'>('select');
  const [selectedTier, setSelectedTier] = useState<TierKey>('creator');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  const [openCheckout, setOpenCheckout] = useState<OpenCheckoutBlock | null>(null);
  // One order creation and one SDK hand-off at a time. Two handlers firing
  // before React re-renders (a double tap, Enter plus click) would otherwise
  // POST twice or open the same payment session in two tabs.
  const submitLock = useRef(false);
  const checkoutLock = useRef(false);

  const selectedPlan = getPlanId(selectedTier, billingPeriod);
  const { data: session } = useSession();
  // Region detection only runs while the sheet is open, so a page that merely
  // mounts it makes no third-party request. The hook guarantees the loading
  // state always terminates and falls back to the US table.
  const { pricing: currentPricing, isLoading: isLoadingPricing } = useRegionalPricing(isOpen);

  useEffect(() => {
    if (isOpen) {
      loadCashfreeSDK().catch(() => {});
    }
  }, [isOpen]);

  // Apply landing/studio checkout intent on open (e.g. ?checkout=creator_monthly → payment form directly)
  useEffect(() => {
    if (!isOpen) return;
    if (initialTier) setSelectedTier(initialTier);
    if (initialBillingPeriod) setBillingPeriod(initialBillingPeriod);
    if (initialStep) {
      // Prefill from session when jumping straight to payment form
      if (initialStep === 'form') {
        if (session?.user?.email) setEmail((prev) => prev || session.user.email as string);
        if (session?.user?.name) setName((prev) => prev || (session.user.name as string) || prev);
      }
      setStep(initialStep);
    } else {
      setStep('select');
    }
    setErrorMessage('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // Buying another term of the plan you already hold is a renewal, not an
  // invalid selection: the server extends the stored expiry by one term.
  const isExtending = selectedTier === currentTier && selectedTier !== 'free';
  const isFreeCurrent = selectedTier === currentTier && selectedTier === 'free';
  const termLabel = billingPeriod === 'yearly' ? '1 year' : '1 month';

  const getTierPrice = (tier: TierKey, period: BillingPeriod): number => {
    if (tier === 'free') return 0;
    const key = `${tier}${period === 'monthly' ? 'Monthly' : 'Yearly'}` as keyof RegionalPricing;
    return (currentPricing[key] as number) || 0;
  };

  /** The price this sheet has shown for the current selection. */
  const displayedPrice = getTierPrice(selectedTier, billingPeriod);

  const isValidPhone = (v: string) => {
    const digits = v.replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  };

  const handleClose = useCallback(() => {
    setStep('select');
    setSelectedTier('creator');
    setBillingPeriod('monthly');
    setName('');
    setEmail('');
    setPhone('');
    setErrorMessage('');
    setPendingCheckout(null);
    setOpenCheckout(null);
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

  /** Hands an already-created order to Cashfree. The only path to checkout. */
  const completeCheckout = useCallback(async (checkout: PendingCheckout) => {
    if (checkoutLock.current) return;
    checkoutLock.current = true;
    setStep('processing');
    setErrorMessage('');
    // Recorded before the hand-off: whatever happens on the payment page, this
    // order's price has now been accepted, which is what lets a later retry
    // resume it instead of demanding a fresh decision.
    writeOpenCheckout({ ...checkout, plan: selectedPlan, accepted: true });
    try {
      const cashfree = await loadCashfreeSDK();
      const baseUrl = window.location.origin;
      const result = await cashfree.checkout({
        paymentSessionId: checkout.paymentSessionId,
        redirectTarget: '_self',
        returnUrl: `${baseUrl}/studio?payment=success&order_id=${checkout.orderId}&plan=${selectedPlan}`,
      });

      if (result.error) {
        // The payment page refused this session (expired, already used). Forget
        // the acceptance so a retry re-confirms the price and asks the server
        // for a fresh order, rather than looping on a dead session.
        writeOpenCheckout(null);
        setStep('error');
        setErrorMessage(result.error.message || 'Payment was cancelled');
        return;
      }

      showToast('Redirecting to payment...');
      handleClose();
    } catch (err) {
      // A transport/SDK failure says nothing about the session's validity, so
      // the acceptance stands and the same checkout can be resumed.
      setStep('error');
      setErrorMessage(checkoutErrorMessage(err));
    } finally {
      checkoutLock.current = false;
    }
  }, [selectedPlan, showToast, handleClose]);

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

    // Always require form step to collect phone (Cashfree requires customer_phone)
    if (step === 'select') {
      // Prefill from session if empty
      if (!email && session?.user?.email) setEmail(session.user.email);
      if (!name && session?.user?.name) setName(session.user.name);
      setStep('form');
      return;
    }

    // step === 'form' -> validate and create order
    const effectiveEmail = (email || session?.user?.email || '').trim();
    const effectiveName = (name || session?.user?.name || 'User').trim();
    const effectivePhone = phone.trim();
    if (!effectiveEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveEmail)) {
      setErrorMessage('Please enter a valid email');
      return;
    }
    if (!effectivePhone || !isValidPhone(effectivePhone)) {
      setErrorMessage('Please enter a valid phone number (8-15 digits, include country code e.g. +919999999999)');
      return;
    }

    if (submitLock.current) return;
    submitLock.current = true;

    setStep('processing');
    setErrorMessage('');

    const planPrice = getTierPrice(selectedTier, billingPeriod);

    try {
      // Resolve the build-time mode before anything is instantiated. The SDK
      // instance is memoised for the whole session and its mode is fixed when the
      // script loads, so an unset or unrecognised value must stop checkout here
      // rather than silently becoming sandbox.
      const browserMode = resolveCashfreeMode();
      if (!browserMode) {
        setStep('error');
        setErrorMessage('Payment is temporarily unavailable. Please try again shortly.');
        return;
      }

      const response = await fetch('/api/cashfree/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          plan: selectedPlan,
          currency: currentPricing.currency,
          country: currentPricing.country,
          amount: planPrice,
          name: effectiveName,
          email: effectiveEmail,
          phone: effectivePhone,
        }),
      });

      const data = await response.json().catch(() => ({ error: 'Failed to create order' }));

      if (!response.ok) {
        if (response.status === 401) {
          handleClose();
          onAuthRequired?.();
          showToast('Please log in or create an account to continue');
          return;
        }
        // The account already has a payable order and the server will not
        // create a second one. That refusal is correct, but it is not the
        // buyer's dead end: the open order can be described, resumed by them
        // explicitly, and the block lifts on its own after a known interval.
        if (response.status === 409 && data.code === 'pending_order_open') {
          const orderId = typeof data.orderId === 'string' ? data.orderId : null;
          const openPlan = typeof data.plan === 'string' ? data.plan : null;
          const openAmount = typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : null;
          const openCurrency = typeof data.currency === 'string' && data.currency ? data.currency : null;
          const remembered = readOpenCheckout();
          setOpenCheckout({
            orderId: orderId ?? '',
            paymentSessionId: typeof data.paymentSessionId === 'string' ? data.paymentSessionId : null,
            amount: openAmount,
            currency: openCurrency,
            plan: openPlan,
            status: typeof data.status === 'string' ? data.status : null,
            retryAfterSeconds:
              typeof data.retryAfterSeconds === 'number' && Number.isFinite(data.retryAfterSeconds)
                ? Math.max(1, data.retryAfterSeconds)
                : 60,
            // Only an acceptance this tab recorded for this exact order counts.
            // Anything else (a different order, a declined confirmation, a lost
            // record) must be accepted again before a payment page opens.
            alreadyAccepted: Boolean(
              remembered &&
              remembered.accepted &&
              remembered.orderId === orderId &&
              remembered.plan === openPlan &&
              remembered.amount === openAmount &&
              remembered.currency === openCurrency,
            ),
          });
          setStep('resume-checkout');
          return;
        }
        throw new Error(data.error || 'Failed to create order');
      }

      // The SDK was instantiated with a build-time mode. If the server created
      // this order in the other Cashfree environment, checkout would never
      // settle against it — stop here rather than sending the user to a payment
      // page whose order can never activate.
      if (data.env && data.env !== browserMode) {
        setStep('error');
        setErrorMessage('Payment is temporarily unavailable. Please try again shortly.');
        return;
      }

      // The charge follows the server's region, not the one this sheet
      // resolved — a VPN, a different geo database, or a region cached up to a
      // week ago all put the two at odds. An order whose price cannot be read
      // is not safe to hand to the payment page either.
      const serverAmount = typeof data.amount === 'number' && Number.isFinite(data.amount) ? data.amount : null;
      const serverCurrency = typeof data.currency === 'string' && data.currency ? data.currency : null;
      if (
        serverAmount === null ||
        serverCurrency === null ||
        typeof data.orderId !== 'string' ||
        typeof data.paymentSessionId !== 'string'
      ) {
        setStep('error');
        setErrorMessage('Payment is temporarily unavailable. Please try again shortly.');
        return;
      }

      const checkout: PendingCheckout = {
        orderId: data.orderId,
        paymentSessionId: data.paymentSessionId,
        amount: serverAmount,
        currency: serverCurrency,
      };

      // Remember the order before anything can fail. If the payment page never
      // opens, the retry finds it here instead of colliding with it.
      writeOpenCheckout({ ...checkout, plan: selectedPlan, accepted: false });

      // Never charge a price the customer has not seen. A difference stops
      // here, with the order still open, and only their explicit confirmation
      // sends it to checkout.
      if (!serverPriceMatchesDisplayed(
        { amount: planPrice, currency: currentPricing.currency },
        { amount: checkout.amount, currency: checkout.currency },
      )) {
        setPendingCheckout(checkout);
        setStep('confirm-price');
        return;
      }

      await completeCheckout(checkout);
    } catch (err) {
      setStep('error');
      setErrorMessage(checkoutErrorMessage(err));
    } finally {
      submitLock.current = false;
    }
  }, [selectedPlan, selectedTier, billingPeriod, currentPricing, name, email, phone, step, showToast, isAuthenticated, onAuthRequired, session, handleClose, completeCheckout]);

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
    // `step` is a dependency on purpose: moving select -> form is a new task,
    // and focus should follow the user into the first field of that step.
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
    : step === 'form' ? 'Complete Payment'
    : step === 'confirm-price' ? 'Confirm Price'
    : step === 'resume-checkout' ? (openCheckout?.status === 'PAID' ? 'Payment Received' : 'Resume Checkout')
    : step === 'processing' ? 'Processing...'
    : 'Payment Error';

  // The open order, described only from what the server reported.
  const openChargeLabel =
    openCheckout && openCheckout.amount !== null && openCheckout.currency !== null
      ? formatPriceForCurrency(openCheckout.amount, openCheckout.currency)
      : null;
  const openPlanLabel = openCheckout?.plan
    ? `Creator ${openCheckout.plan.includes('yearly') ? 'Yearly' : 'Monthly'}`
    : 'Creator plan';
  const openMinutes = openCheckout ? Math.max(1, Math.ceil(openCheckout.retryAfterSeconds / 60)) : 1;
  const openMinuteLabel = openMinutes === 1 ? '1 minute' : `${openMinutes} minutes`;
  const openIsPaid = openCheckout?.status === 'PAID';
  // Resuming means opening *this* order's payment session: possible only when
  // the server reported one, priced it, and it is for the plan on this sheet.
  // A paid order is never resumable — its payment already went through.
  const openIsResumable = Boolean(
    openCheckout &&
    !openIsPaid &&
    openCheckout.paymentSessionId &&
    openChargeLabel &&
    openCheckout.plan === selectedPlan,
  );
  const openPlanDiffers = Boolean(openCheckout?.plan && openCheckout.plan !== selectedPlan);

  /** Re-open the payment page for the order the server is holding open. */
  const resumeOpenCheckout = () => {
    if (
      !openCheckout ||
      // Belt and braces: the button is not rendered for a paid order, and this
      // function spends money, so it refuses one even if that ever changes.
      openIsPaid ||
      !openCheckout.paymentSessionId ||
      openCheckout.amount === null ||
      openCheckout.currency === null
    ) {
      return;
    }
    void completeCheckout({
      orderId: openCheckout.orderId,
      paymentSessionId: openCheckout.paymentSessionId,
      amount: openCheckout.amount,
      currency: openCheckout.currency,
    });
  };

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
                      // A paid plan can always buy another term: the purchase
                      // extends the stored expiry instead of being rejected.
                      // Free stays unselectable — while it is the current plan
                      // there is nothing to buy, and while a paid plan is held
                      // it is not a downgrade path.
                      const canBuyAnotherTerm = isCurrentPlan && tier !== 'free';
                      const isSelectable = canBuyAnotherTerm || (tier !== 'free' && !isCurrentPlan);
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
                              <p className="lsx-pricing-note">One-time payment for 1 year of access (equivalent to {format(getTierPrice(tier, 'yearly') / 12)}/month).</p>
                            )}
                            {tier !== 'free' && billingPeriod === 'monthly' && (
                              <p className="lsx-pricing-note">One-time payment for 1 month of access.</p>
                            )}
                            {canBuyAnotherTerm && (
                              <p className="lsx-pricing-note">
                                Adds {billingPeriod === 'yearly' ? '1 year' : '1 month'} to your current access.
                              </p>
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
                      : isExtending
                        ? `Extend by ${termLabel} — ${format(getTierPrice(selectedTier, billingPeriod))}`
                        : selectedPlan === 'free'
                          ? PRICING_PLANS.free.cta
                          : `Pay once for ${format(getTierPrice(selectedTier, billingPeriod))}${billingPeriod === 'monthly' ? ' / 1 month' : ' / 1 year'}`}
                  </Button>

                  <p className="text-xs text-text-muted text-center">
                    {isExtending
                      ? `Extends your access by ${termLabel} from its current end date. One-time payment, no automatic renewal.`
                      : 'Secure checkout powered by Cashfree.'}
                  </p>
                </div>
              )}

              {step === 'form' && (
                <div className="flex flex-col gap-5">
                  <div className="bg-elevated rounded-xl p-5 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-text-primary">{PRICING_PLANS[selectedTier].name} {billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'}</span>
                      <span className="text-xs text-text-muted block mt-1">
                        One-time payment for {billingPeriod === 'yearly' ? '1 year' : '1 month'} of access in {currentPricing.currency}
                      </span>
                    </div>
                    <span className="text-xl font-bold text-text-primary">
                      {format(getTierPrice(selectedTier, billingPeriod))}
                    </span>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <label htmlFor="pricing-name" className="text-xs font-semibold uppercase tracking-wider text-text-muted">Full Name</label>
                      <input
                        id="pricing-name"
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={200}
                        className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label htmlFor="pricing-email" className="text-xs font-semibold uppercase tracking-wider text-text-muted">Email Address</label>
                      <input
                        id="pricing-email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => {
                          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                            setErrorMessage('Please enter a valid email');
                          } else {
                            setErrorMessage('');
                          }
                        }}
                        maxLength={254}
                        className={`w-full px-4 py-3 bg-elevated border rounded-lg text-sm text-text-primary placeholder-text-muted outline-none transition-colors ${
                          email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
                            ? 'border-recording focus:border-recording'
                            : 'border-border-subtle focus:border-accent'
                        }`}
                      />
                      {email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (
                        <p className="text-[11px] text-recording">Please enter a valid email address</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      <label htmlFor="pricing-phone" className="text-xs font-semibold uppercase tracking-wider text-text-muted">Phone Number <span className="normal-case text-[10px]">(with country code)</span></label>
                      <input
                        id="pricing-phone"
                        type="tel"
                        placeholder="+919999999999"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onBlur={() => {
                          if (phone && !isValidPhone(phone)) {
                            setErrorMessage('Please enter a valid phone number (8-15 digits, include country code)');
                          } else if (errorMessage.includes('phone')) {
                            setErrorMessage('');
                          }
                        }}
                        maxLength={20}
                        className={`w-full px-4 py-3 bg-elevated border rounded-lg text-sm text-text-primary placeholder-text-muted outline-none transition-colors ${
                          phone && !isValidPhone(phone)
                            ? 'border-recording focus:border-recording'
                            : 'border-border-subtle focus:border-accent'
                        }`}
                      />
                      {phone && !isValidPhone(phone) ? (
                        <p className="text-[11px] text-recording">Include country code, 8-15 digits (e.g. +919999999999, +14155552671)</p>
                      ) : (
                        <p className="text-[11px] text-text-muted">Required by Cashfree for payment verification</p>
                      )}
                    </div>
                  </div>

                  {errorMessage && (
                    <p className="text-sm text-recording text-center">{errorMessage}</p>
                  )}

                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setStep('select')}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={handleSubscribe}
                      disabled={!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !isValidPhone(phone)}
                      className="flex-1"
                    >
                      Continue to Payment
                    </Button>
                  </div>

                  <p className="text-xs text-text-muted text-center">
                    Secure checkout powered by Cashfree. Access lasts for the purchased term with no automatic renewal.
                  </p>
                </div>
              )}

              {step === 'confirm-price' && pendingCheckout && (
                <div className="flex flex-col gap-5">
                  <div className="rounded-xl border border-border-subtle bg-elevated p-5">
                    <p className="text-sm font-semibold text-text-primary">Your region&apos;s price is different</p>
                    <p className="text-xs text-text-secondary mt-2">
                      We showed {format(displayedPrice)}, but the payment service will charge{' '}
                      <span className="font-semibold text-text-primary">
                        {formatPriceForCurrency(pendingCheckout.amount, pendingCheckout.currency)}
                      </span>{' '}
                      for {PRICING_PLANS[selectedTier].name} {billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'}.
                      This happens when your location differs from the region we detected. No payment has been taken yet.
                    </p>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={() => completeCheckout(pendingCheckout)}
                      data-modal-initial-focus
                    >
                      Accept and pay {formatPriceForCurrency(pendingCheckout.amount, pendingCheckout.currency)}
                    </Button>
                    <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                  </div>
                </div>
              )}

              {step === 'resume-checkout' && openCheckout && (
                <div className="flex flex-col gap-5">
                  <div className="rounded-xl border border-border-subtle bg-elevated p-5">
                    <p className="text-sm font-semibold text-text-primary">
                      {openIsPaid
                        ? 'Your earlier payment is being confirmed'
                        : openIsResumable && openCheckout.alreadyAccepted
                          ? 'Finish your earlier checkout'
                          : openIsResumable
                            ? 'You have an unfinished checkout'
                            : 'An earlier checkout is still open'}
                    </p>

                    {openIsPaid ? (
                      <p className="text-xs text-text-secondary mt-2">
                        {openChargeLabel ? (
                          <>We have received your payment of <span className="font-semibold text-text-primary">{openChargeLabel}</span> for {openPlanLabel}. </>
                        ) : (
                          <>We have received your earlier payment. </>
                        )}
                        Your plan is activated as soon as the confirmation reaches our servers, which usually takes under a minute. There is nothing more to pay.
                      </p>
                    ) : openIsResumable ? (
                      <p className="text-xs text-text-secondary mt-2">
                        <span className="font-semibold text-text-primary">{openChargeLabel}</span> for {openPlanLabel}{' '}
                        {openCheckout.alreadyAccepted
                          ? 'is already confirmed, but the payment page closed before it completed.'
                          : 'is still open for payment.'}{' '}
                        Resuming reuses that same checkout, so you cannot be charged twice. A new payment can be started in about {openMinuteLabel}.
                      </p>
                    ) : (
                      <p className="text-xs text-text-secondary mt-2">
                        {openPlanDiffers ? (
                          <>The checkout that is still open is for {openPlanLabel}, not the plan you selected here. That blocks a new payment for about {openMinuteLabel}.</>
                        ) : (
                          <>An unfinished checkout{openChargeLabel ? <> for <span className="font-semibold text-text-primary">{openChargeLabel}</span></> : null} is still open, which blocks a new payment for about {openMinuteLabel}.</>
                        )}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    {openIsResumable && (
                      <Button
                        variant="primary"
                        size="lg"
                        onClick={resumeOpenCheckout}
                        data-modal-initial-focus
                      >
                        {openCheckout.alreadyAccepted ? 'Resume payment' : 'Accept and pay'}{openChargeLabel ? ` ${openChargeLabel}` : ''}
                      </Button>
                    )}
                    <Button variant="ghost" onClick={handleClose}>
                      {openIsPaid ? 'Close' : 'Not now'}
                    </Button>
                  </div>
                </div>
              )}

              {step === 'processing' && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  {/* Truthful for both paths through this step: a fresh order is
                      being created, or an existing one's payment page is being
                      reopened. */}
                  <p className="text-sm text-text-secondary">Preparing secure checkout...</p>
                </div>
              )}

              {step === 'error' && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="w-12 h-12 rounded-full bg-recording/10 flex items-center justify-center">
                    <svg className="w-6 h-6 text-recording" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-text-primary">Payment wasn&apos;t completed</p>
                    {/* The reason the payment page gave (or a safe generic one
                        for a transport failure) was held in state but never
                        shown, so "try again" was blind advice. */}
                    {errorMessage && (
                      <p className="text-xs text-text-secondary mt-1">{errorMessage}</p>
                    )}
                    <p className="text-xs text-text-secondary mt-1">Your Free plan is still active. You can try again whenever you&apos;re ready.</p>
                  </div>
                  <div className="flex flex-col gap-2 w-full max-w-[200px]">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        // Clear the stale failure so the form doesn't reopen
                        // showing an error for a submit the user hasn't made yet.
                        setErrorMessage('');
                        setStep('form');
                      }}
                    >
                      Try again
                    </Button>
                    <Button variant="ghost" onClick={handleClose}>Continue with Free</Button>
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
