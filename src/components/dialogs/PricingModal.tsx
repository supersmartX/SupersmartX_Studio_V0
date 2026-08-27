'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { CloseIcon } from '@/components/icons';
import { detectCountry, getPricingForCountry, formatPrice, type RegionalPricing } from '@/lib/pricing';
import { loadCashfreeSDK } from '@/lib/cashfree';
import { useModalAnimation } from '@/hooks/useModalAnimation';
import '@/styles/pricing.css';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
}

type BillingPeriod = 'monthly' | 'yearly';

const PLAN_DETAILS = {
  free: {
    name: 'Free',
    badge: null,
    features: [
      { text: 'Teleprompter (always free)', highlight: false },
      { text: 'Audio recording & download', highlight: false },
      { text: '3 video downloads free', highlight: false },
      { text: 'Videos up to 5 min duration', highlight: false },
    ],
  },
  creator: {
    name: 'Creator',
    badge: { text: 'Popular', color: 'lsx-pricing-badge' },
    features: [
      { text: 'Everything in Free', highlight: false },
      { text: 'Unlimited video downloads', highlight: true },
      { text: 'Unlimited recording length', highlight: true },
      { text: '1080p export quality', highlight: true },
      { text: 'All platform presets', highlight: false },
      { text: 'Crop & reframe for each platform', highlight: false },
    ],
  },
  pro: {
    name: 'Pro',
    badge: null,
    features: [
      { text: 'Everything in Creator', highlight: false },
      { text: '4K export quality', highlight: true },
      { text: 'Batch export (multiple platforms)', highlight: true },
      { text: 'Priority support', highlight: false },
    ],
  },
} as const;

const CHECK_ICON = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const COUNTRY_FLAGS: Record<string, string> = {
  US: '\u{1F1FA}\u{1F1F8}', GB: '\u{1F1EC}\u{1F1E7}', DE: '\u{1F1E9}\u{1F1EA}', FR: '\u{1F1EB}\u{1F1F7}', IN: '\u{1F1EE}\u{1F1F3}', JP: '\u{1F1EF}\u{1F1F5}', AU: '\u{1F1E6}\u{1F1FA}', CA: '\u{1F1E8}\u{1F1E6}',
  BR: '\u{1F1E7}\u{1F1F7}', MX: '\u{1F1F2}\u{1F1FD}', KR: '\u{1F1F0}\u{1F1F7}', IT: '\u{1F1EE}\u{1F1F9}', ES: '\u{1F1EA}\u{1F1F8}', NL: '\u{1F1F3}\u{1F1F1}', SE: '\u{1F1F8}\u{1F1EA}', SG: '\u{1F1F8}\u{1F1EC}',
  AE: '\u{1F1E6}\u{1F1EA}', SA: '\u{1F1F8}\u{1F1E6}', NG: '\u{1F1F3}\u{1F1EC}', KE: '\u{1F1F0}\u{1F1EA}', ZA: '\u{1F1FF}\u{1F1E6}', PH: '\u{1F1F5}\u{1F1ED}', ID: '\u{1F1EE}\u{1F1E9}', TH: '\u{1F1F9}\u{1F1ED}',
  VN: '\u{1F1FB}\u{1F1F3}', PK: '\u{1F1F5}\u{1F1F0}', BD: '\u{1F1E7}\u{1F1E9}', EG: '\u{1F1EA}\u{1F1EC}', GH: '\u{1F1EC}\u{1F1ED}', TR: '\u{1F1F9}\u{1F1F7}', PL: '\u{1F1F5}\u{1F1F1}', RO: '\u{1F1F7}\u{1F1F4}',
  CZ: '\u{1F1E8}\u{1F1FF}', PT: '\u{1F1F5}\u{1F1F9}', MY: '\u{1F1F2}\u{1F1FE}', CN: '\u{1F1E8}\u{1F1F3}', CH: '\u{1F1E8}\u{1F1ED}', NO: '\u{1F1F3}\u{1F1F4}', DK: '\u{1F1E9}\u{1F1F0}', NZ: '\u{1F1F3}\u{1F1FF}',
  FI: '\u{1F1EB}\u{1F1EE}', AT: '\u{1F1E6}\u{1F1F9}', BE: '\u{1F1E7}\u{1F1EA}', IE: '\u{1F1EE}\u{1F1EA}', EE: '\u{1F1EA}\u{1F1EA}', SI: '\u{1F1F8}\u{1F1EE}', LT: '\u{1F1F1}\u{1F1F9}', HR: '\u{1F1ED}\u{1F1F7}',
  CO: '\u{1F1E8}\u{1F1F4}', AR: '\u{1F1E6}\u{1F1F7}', CL: '\u{1F1E8}\u{1F1F1}', PE: '\u{1F1F5}\u{1F1EA}', HU: '\u{1F1ED}\u{1F1FA}', MM: '\u{1F1F2}\u{1F1F2}', NP: '\u{1F1F3}\u{1F1F5}', LK: '\u{1F1F1}\u{1F1F0}',
  UA: '\u{1F1FA}\u{1F1E6}', TZ: '\u{1F1F9}\u{1F1FF}', UG: '\u{1F1FA}\u{1F1EC}', ET: '\u{1F1EA}\u{1F1F9}', OM: '\u{1F1F4}\u{1F1F2}', QA: '\u{1F1F6}\u{1F1E6}', KW: '\u{1F1F0}\u{1F1FC}', LU: '\u{1F1F1}\u{1F1FA}',
};

function getPlanId(tier: string, period: BillingPeriod): string {
  if (tier === 'free') return 'free';
  return `${tier}_${period}`;
}

export function PricingModal({ isOpen, onClose, showToast }: PricingModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const [step, setStep] = useState<'select' | 'form' | 'processing' | 'error'>('select');
  const [selectedTier, setSelectedTier] = useState<'free' | 'creator' | 'pro'>('creator');
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>('monthly');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pricing, setPricing] = useState<RegionalPricing | null>(null);
  const [isLoadingPricing, setIsLoadingPricing] = useState(true);

  const selectedPlan = getPlanId(selectedTier, billingPeriod);

  useEffect(() => {
    if (isOpen && !pricing) {
      setIsLoadingPricing(true);
      detectCountry().then(country => {
        setPricing(getPricingForCountry(country));
        setIsLoadingPricing(false);
      });
    }
  }, [isOpen, pricing]);

  useEffect(() => {
    if (isOpen) {
      loadCashfreeSDK().catch(() => {});
    }
  }, [isOpen]);

  const currentPricing = pricing || getPricingForCountry('IN');
  const countryFlag = COUNTRY_FLAGS[currentPricing.country] || '\u{1F30D}';

  const format = (amount: number) => formatPrice(amount, currentPricing.symbol, currentPricing.locale);

  const getTierPrice = (tier: 'free' | 'creator' | 'pro', period: BillingPeriod): number => {
    if (tier === 'free') return 0;
    const key = `${tier}${period === 'monthly' ? 'Monthly' : 'Yearly'}` as keyof RegionalPricing;
    return (currentPricing[key] as number) || 0;
  };

  const handleSubscribe = useCallback(async () => {
    if (selectedPlan === 'free') {
      showToast('Free plan activated!');
      handleClose();
      return;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
        body: JSON.stringify({
          plan: selectedPlan,
          currency: currentPricing.currency,
          country: currentPricing.country,
          amount: planPrice,
          name: name || 'User',
          email,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
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
  }, [selectedPlan, selectedTier, billingPeriod, currentPricing, name, email, showToast]);

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

  const tiers = ['free', 'creator', 'pro'] as const;

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
            {!isLoadingPricing && (
              <span className="text-[11px] text-text-muted bg-elevated px-2.5 py-1 rounded-full">
                {countryFlag} {currentPricing.currency}
              </span>
            )}
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
                  {/* Billing period toggle — same as landing page */}
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
                      Yearly <span className="lsx-pricing-toggle-save">Save 17%</span>
                    </button>
                  </div>

                  {/* Plan cards — same markup as landing page */}
                  <div className="lsx-pricing-grid">
                    {tiers.map((tier) => {
                      const plan = PLAN_DETAILS[tier];
                      const isSelected = selectedTier === tier;
                      const price = getTierPrice(tier, billingPeriod);
                      const periodLabel = tier === 'free' ? '/forever' : billingPeriod === 'monthly' ? '/month' : '/year';

                      return (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => setSelectedTier(tier)}
                          className={`lsx-pricing-card ${isSelected ? 'lsx-pricing-card--selected' : ''}`}
                        >
                          {plan.badge && (
                            <div className="lsx-pricing-badge">{plan.badge.text}</div>
                          )}
                          <div className="lsx-pricing-card-header">
                            <h3 className="lsx-pricing-plan">{plan.name}</h3>
                            <div className="lsx-pricing-price">
                              {price === 0 ? '$0' : format(price)}
                              <span className="lsx-pricing-period">{periodLabel}</span>
                            </div>
                            {tier !== 'free' && billingPeriod === 'yearly' && (
                              <p className="lsx-pricing-note">That&apos;s {format(getTierPrice(tier, 'yearly') / 12)}/month</p>
                            )}
                            {tier !== 'free' && billingPeriod === 'monthly' && (
                              <p className="lsx-pricing-note">PPP-adjusted by region</p>
                            )}
                          </div>
                          <ul className="lsx-pricing-features">
                            {plan.features.map((feature) => (
                              <li key={feature.text} className={`lsx-pricing-feature ${feature.highlight ? 'lsx-pricing-feature--highlight' : ''}`}>
                                {CHECK_ICON}
                                {feature.text}
                              </li>
                            ))}
                          </ul>
                        </button>
                      );
                    })}
                  </div>

                  {/* CTA */}
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => selectedPlan === 'free' ? handleSubscribe() : setStep('form')}
                    className="lsx-pricing-btn"
                    style={{ maxWidth: 960, margin: '0 auto', width: '100%' }}
                  >
                    {selectedPlan === 'free'
                      ? 'Get Started Free'
                      : `Subscribe for ${format(getTierPrice(selectedTier, billingPeriod))}${billingPeriod === 'monthly' ? '/mo' : '/yr'}`}
                  </Button>

                  <p className="text-xs text-text-muted text-center">
                    Prices in {currentPricing.currency}. Secure checkout powered by Cashfree.
                  </p>
                </div>
              )}

              {step === 'form' && (
                <div className="flex flex-col gap-5">
                  <div className="bg-elevated rounded-xl p-5 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-text-primary">{PLAN_DETAILS[selectedTier].name} {billingPeriod === 'yearly' ? 'Yearly' : 'Monthly'}</span>
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
                        maxLength={254}
                        className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                      />
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
