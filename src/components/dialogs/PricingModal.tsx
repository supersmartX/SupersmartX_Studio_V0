'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { CloseIcon } from '@/components/icons';
import { useSession } from 'next-auth/react';
import { detectCountry, getPricingForCountry, formatPrice, formatPriceZero, formatSavingsPercent, type RegionalPricing } from '@/lib/pricing';
import { loadCashfreeSDK } from '@/lib/cashfree';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import { PRICING_PLANS } from '@/constants';
import '@/styles/pricing.css';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
  userPlan?: string;
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
}

type BillingPeriod = 'monthly' | 'yearly';

type TierKey = keyof typeof PRICING_PLANS;

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

export function PricingModal({ isOpen, onClose, showToast, userPlan, isAuthenticated = false, onAuthRequired }: PricingModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const [step, setStep] = useState<'select' | 'form' | 'processing' | 'error'>('select');
  const [selectedTier, setSelectedTier] = useState<TierKey>('creator');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pricing, setPricing] = useState<RegionalPricing | null>(null);
  const [isLoadingPricing, setIsLoadingPricing] = useState(true);

  const selectedPlan = getPlanId(selectedTier, billingPeriod);
  const { data: session } = useSession();

  useEffect(() => {
    if (isOpen && !pricing) {
      setIsLoadingPricing(true);
      if (isAuthenticated) {
        detectCountry().then(country => {
          setPricing(getPricingForCountry(country));
          setIsLoadingPricing(false);
        });
      } else {
        setPricing(getPricingForCountry('US'));
        setIsLoadingPricing(false);
      }
    }
  }, [isOpen, pricing, isAuthenticated]);

  useEffect(() => {
    if (isOpen) {
      loadCashfreeSDK().catch(() => {});
    }
  }, [isOpen]);

  const currentPricing = pricing || getPricingForCountry('US');

  const format = (amount: number) => formatPrice(amount, currentPricing.symbol, currentPricing.locale);

  const formatZero = (amount: number) => formatPriceZero(amount, currentPricing.symbol, currentPricing.locale);

  const getUserPlanTier = (): TierKey | null => {
    if (!userPlan || userPlan === 'free') return 'free';
    if (userPlan.startsWith('creator')) return 'creator';
    if (userPlan.startsWith('pro')) return 'creator'; // Pro internal → show as Creator (not customer-facing)
    return null;
  };
  const currentTier = getUserPlanTier();

  const getTierPrice = (tier: TierKey, period: BillingPeriod): number => {
    if (tier === 'free') return 0;
    const key = `${tier}${period === 'monthly' ? 'Monthly' : 'Yearly'}` as keyof RegionalPricing;
    return (currentPricing[key] as number) || 0;
  };

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

    // Use session email/name directly — no separate form step, open Cashfree directly
    const effectiveEmail = (email || session?.user?.email || '').trim();
    const effectiveName = (name || session?.user?.name || 'User').trim();
    if (!effectiveEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(effectiveEmail)) {
      // Fallback to form if session has no email
      setStep('form');
      setErrorMessage('Please enter a valid email');
      return;
    }

    setStep('processing');
    setErrorMessage('');

    const planPrice = getTierPrice(selectedTier, billingPeriod);

    try {
      const cashfree = await loadCashfreeSDK();

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
        throw new Error(data.error || 'Failed to create order');
      }

      const baseUrl = window.location.origin;
      const result = await cashfree.checkout({
        paymentSessionId: data.paymentSessionId,
        redirectTarget: '_self',
        returnUrl: `${baseUrl}/support/success?order_id=${data.orderId}&plan=${selectedPlan}`,
      });

      if (result.error) {
        setStep('error');
        setErrorMessage(result.error.message || 'Payment was cancelled');
        return;
      }

      showToast('Redirecting to payment...');
      handleClose();
    } catch (err) {
      setStep('error');
      setErrorMessage(err instanceof Error ? err.message : 'Something went wrong');
    }
  }, [selectedPlan, selectedTier, billingPeriod, currentPricing, name, email, showToast, isAuthenticated, onAuthRequired, session]);

  const handleClose = useCallback(() => {
    setStep('select');
    setSelectedTier('creator');
    setBillingPeriod('monthly');
    setName('');
    setEmail('');
    setErrorMessage('');
    closeModal();
  }, [closeModal]);

  if (!shouldRender) return null;

  return (
    <div className={`fixed inset-0 z-modal isolate flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Choose Plan" {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-black/95 backdrop-blur-xl ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleClose}
      />

      <div className={`relative w-full max-w-[960px] bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-text-primary">
              {step === 'select' ? 'Choose Your Plan' : step === 'form' ? 'Complete Payment' : step === 'processing' ? 'Processing...' : 'Payment Error'}
            </h2>
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
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-text-secondary">Detecting your region...</p>
            </div>
          ) : (
            <>
              {step === 'select' && (
                <div className="flex flex-col gap-8">
                  {/* Billing period toggle */}
                  <div className="lsx-pricing-toggle">
                    <button
                      type="button"
                      onClick={() => setBillingPeriod('monthly')}
                      className={`lsx-pricing-toggle-btn ${billingPeriod === 'monthly' ? 'lsx-pricing-toggle-btn--active' : ''}`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setBillingPeriod('yearly')}
                      className={`lsx-pricing-toggle-btn ${billingPeriod === 'yearly' ? 'lsx-pricing-toggle-btn--active' : ''}`}
                    >
                      Yearly <span className="lsx-pricing-toggle-save">{formatSavingsPercent(currentPricing.creatorMonthly, currentPricing.creatorYearly)}</span>
                    </button>
                  </div>

                  {/* Plan cards */}
                  <div className="lsx-pricing-grid">
                    {TIERS.map((tier) => {
                      const plan = PRICING_PLANS[tier];
                      const badge = tier === currentTier ? 'Current Plan' : BADGES[tier];
                      const isSelected = selectedTier === tier;
                      const isCurrentPlan = tier === currentTier;
                      const price = getTierPrice(tier, billingPeriod);
                      const periodLabel = tier === 'free' ? '/forever' : billingPeriod === 'monthly' ? '/month' : '/year';

                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => !isCurrentPlan && setSelectedTier(tier)}
                          disabled={isCurrentPlan}
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
                              <p className="lsx-pricing-note">That&apos;s {format(getTierPrice(tier, 'yearly') / 12)}/month</p>
                            )}
                            {tier !== 'free' && billingPeriod === 'monthly' && (
                              <p className="lsx-pricing-note">Regional pricing</p>
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
                    variant={selectedTier === currentTier ? 'secondary' : 'primary'}
                    size="lg"
                    onClick={handleSubscribe}
                    disabled={selectedTier === currentTier}
                    className="lsx-pricing-btn"
                  >
                    {selectedTier === currentTier
                      ? 'Current Plan'
                      : selectedPlan === 'free'
                        ? PRICING_PLANS.free.cta
                        : `Subscribe for ${format(getTierPrice(selectedTier, billingPeriod))}${billingPeriod === 'monthly' ? '/mo' : '/yr'}`}
                  </Button>

                  <p className="text-xs text-text-muted text-center">
                    Secure checkout powered by Cashfree.
                  </p>
                </div>
              )}

              {step === 'form' && (
                <div className="flex flex-col gap-5">
                  <div className="bg-elevated rounded-xl p-5 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-text-primary">{PRICING_PLANS[selectedTier].name} {billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'}</span>
                      <span className="text-xs text-text-muted block mt-1">
                        Billed {billingPeriod === 'yearly' ? 'annually' : 'monthly'} in {currentPricing.currency}
                      </span>
                    </div>
                    <span className="text-xl font-bold text-text-primary">
                      {format(getTierPrice(selectedTier, billingPeriod))}
                    </span>
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Full Name</label>
                      <input
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={200}
                        className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-semibold uppercase tracking-wider text-text-muted">Email Address</label>
                      <input
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
                  </div>

                  {errorMessage && (
                    <p className="text-sm text-recording text-center">{errorMessage}</p>
                  )}

                  <div className="flex gap-3">
                    <Button variant="secondary" onClick={() => setStep('select')}>Back</Button>
                    <Button
                      variant="primary"
                      onClick={handleSubscribe}
                      disabled={!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                      className="flex-1"
                    >
                      Continue to Payment
                    </Button>
                  </div>

                  <p className="text-xs text-text-muted text-center">
                    Secure checkout powered by Cashfree. Cancel anytime.
                  </p>
                </div>
              )}

              {step === 'processing' && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-text-secondary">Creating payment session...</p>
                </div>
              )}

              {step === 'error' && (
                <div className="flex flex-col items-center gap-3 py-12">
                  <p className="text-sm text-recording">{errorMessage}</p>
                  <Button variant="secondary" onClick={() => setStep('form')}>Try Again</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
