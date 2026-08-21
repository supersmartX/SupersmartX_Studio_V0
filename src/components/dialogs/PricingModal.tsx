'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { CloseIcon } from '@/components/icons';
import { detectCountry, getPricingForCountry, formatPrice, type RegionalPricing } from '@/lib/pricing';
import { loadCashfreeSDK } from '@/lib/cashfree';
import { useModalAnimation } from '@/hooks/useModalAnimation';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
}

const PRO_FEATURES = [
  'Everything in Free',
  'Unlimited video downloads',
  'Unlimited recording length',
  '4K export quality',
  'Priority support',
  'Custom branding',
  'Cloud sync',
] as const;

const FREE_FEATURES = [
  'Teleprompter (always free)',
  'Audio recording & download',
  '3 video downloads free',
  'Videos up to 5 min duration',
] as const;

const COUNTRY_FLAGS: Record<string, string> = {
  US: '🇺🇸', GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', IN: '🇮🇳', JP: '🇯🇵', AU: '🇦🇺', CA: '🇨🇦',
  BR: '🇧🇷', MX: '🇲🇽', KR: '🇰🇷', IT: '🇮🇹', ES: '🇪🇸', NL: '🇳🇱', SE: '🇸🇪', SG: '🇸🇬',
  AE: '🇦🇪', SA: '🇸🇦', NG: '🇳🇬', KE: '🇰🇪', ZA: '🇿🇦', PH: '🇵🇭', ID: '🇮🇩', TH: '🇹🇭',
  VN: '🇻🇳', PK: '🇵🇰', BD: '🇧🇩', EG: '🇪🇬', GH: '🇬🇭', TR: '🇹🇷', PL: '🇵🇱', RO: '🇷🇴',
  CZ: '🇨🇿', PT: '🇵🇹', MY: '🇲🇾', CN: '🇨🇳', CH: '🇨🇭', NO: '🇳🇴', DK: '🇩🇰', NZ: '🇳🇿',
  FI: '🇫🇮', AT: '🇦🇹', BE: '🇧🇪', IE: '🇮🇪', EE: '🇪🇪', SI: '🇸🇮', LT: '🇱🇹', HR: '🇭🇷',
  CO: '🇨🇴', AR: '🇦🇷', CL: '🇨🇱', PE: '🇵🇪', HU: '🇭🇺', MM: '🇲🇲', NP: '🇳🇵', LK: '🇱🇰',
  UA: '🇺🇦', TZ: '🇹🇿', UG: '🇺🇬', ET: '🇪🇹', OM: '🇴🇲', QA: '🇶🇦', KW: '🇰🇼', LU: '🇱🇺',
};

export function PricingModal({ isOpen, onClose, showToast }: PricingModalProps) {
  const { isClosing, shouldRender, handleClose: closeModal, swipeHandlers } = useModalAnimation(isOpen, onClose);
  const [step, setStep] = useState<'select' | 'form' | 'processing' | 'error'>('select');
  const [selectedPlan, setSelectedPlan] = useState<string>('pro_monthly');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pricing, setPricing] = useState<RegionalPricing | null>(null);
  const [isLoadingPricing, setIsLoadingPricing] = useState(true);

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
  const countryFlag = COUNTRY_FLAGS[currentPricing.country] || '🌍';

  const format = (amount: number) => formatPrice(amount, currentPricing.symbol, currentPricing.locale);

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

    const planPrice = selectedPlan === 'pro_monthly' ? currentPricing.monthly : currentPricing.yearly;

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
  }, [selectedPlan, currentPricing, name, email, showToast]);

  const handleClose = useCallback(() => {
    setStep('select');
    setSelectedPlan('pro_monthly');
    setName('');
    setEmail('');
    setErrorMessage('');
    closeModal();
  }, [closeModal]);

  if (!shouldRender) return null;

  const monthlyPrice = currentPricing.monthly;
  const yearlyPrice = currentPricing.yearly;
  const yearlyOriginal = currentPricing.yearlyOriginal;

  return (
    <div className={`fixed inset-0 z-modal flex items-center justify-center p-4 ${isClosing ? 'pointer-events-none' : ''}`} role="dialog" aria-modal="true" aria-label="Choose Plan" {...swipeHandlers}>
      <div
        className={`absolute inset-0 bg-canvas/80 backdrop-blur-md ${isClosing ? 'animate-fade-out' : 'animate-fade-in'}`}
        onClick={handleClose}
      />

      <div className={`relative w-full max-w-lg bg-surface border border-border-default rounded-xl shadow-2xl ${isClosing ? 'animate-scale-out' : 'animate-scale-in'} overflow-hidden max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle shrink-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {step === 'select' ? 'Choose Your Plan' : step === 'form' ? 'Complete Payment' : step === 'processing' ? 'Processing...' : 'Payment Error'}
            </h2>
            {!isLoadingPricing && (
              <span className="text-[10px] text-text-muted bg-elevated px-2 py-0.5 rounded-full">
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

        {/* Content */}
        <div className="p-5 overflow-y-auto flex-1 min-h-0">
          {isLoadingPricing ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-text-secondary">Detecting your region...</p>
            </div>
          ) : (
            <>
              {step === 'select' && (
                <div className="flex flex-col gap-4">
                  {/* Plan cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {/* Free */}
                    <button
                      onClick={() => setSelectedPlan('free')}
                      className={`relative flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left ${
                        selectedPlan === 'free'
                          ? 'border-accent bg-accent/5'
                          : 'border-border-subtle hover:border-border-default bg-elevated'
                      }`}
                    >
                      <span className="text-sm font-semibold text-text-primary">Free</span>
                      <span className="text-lg font-bold text-text-primary mt-1">Free</span>
                      <span className="text-xs text-text-muted mt-0.5">/forever</span>
                    </button>

                    {/* Monthly */}
                    <button
                      onClick={() => setSelectedPlan('pro_monthly')}
                      className={`relative flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left ${
                        selectedPlan === 'pro_monthly'
                          ? 'border-accent bg-accent/5'
                          : 'border-border-subtle hover:border-border-default bg-elevated'
                      }`}
                    >
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-accent text-white text-[9px] font-bold rounded-full uppercase">
                        Popular
                      </span>
                      <span className="text-sm font-semibold text-text-primary">Pro</span>
                      <span className="text-lg font-bold text-text-primary mt-1">
                        {format(monthlyPrice)}
                      </span>
                      <span className="text-xs text-text-muted">/month</span>
                    </button>

                    {/* Yearly */}
                    <button
                      onClick={() => setSelectedPlan('pro_yearly')}
                      className={`relative flex flex-col items-start p-4 rounded-xl border-2 transition-all text-left ${
                        selectedPlan === 'pro_yearly'
                          ? 'border-accent bg-accent/5'
                          : 'border-border-subtle hover:border-border-default bg-elevated'
                      }`}
                    >
                      <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-emerald-500 text-white text-[9px] font-bold rounded-full uppercase">
                        Save 17%
                      </span>
                      <span className="text-sm font-semibold text-text-primary">Pro</span>
                      <span className="text-lg font-bold text-text-primary mt-1">
                        {format(yearlyPrice)}
                      </span>
                      <span className="text-xs text-text-muted">/year</span>
                      <span className="text-xs text-text-muted line-through mt-0.5">
                        {format(yearlyOriginal)}
                      </span>
                    </button>
                  </div>

                  {/* Features */}
                  <div className="bg-elevated rounded-xl p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                      {selectedPlan === 'free' ? 'Free' : 'Pro'} Plan Includes
                    </h3>
                    <ul className="space-y-2">
                      {(selectedPlan === 'free' ? FREE_FEATURES : PRO_FEATURES).map((feature) => (
                        <li key={feature} className="flex items-start gap-2 text-sm text-text-secondary">
                          <svg className="w-4 h-4 text-success shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {feature}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* CTA */}
                  <Button
                    variant="primary"
                    size="lg"
                    onClick={() => selectedPlan === 'free' ? handleSubscribe() : setStep('form')}
                    className="w-full"
                  >
                    {selectedPlan === 'free'
                      ? 'Get Started Free'
                      : `Subscribe for ${format(selectedPlan === 'pro_monthly' ? monthlyPrice : yearlyPrice)}/${selectedPlan === 'pro_monthly' ? 'mo' : 'yr'}`}
                  </Button>

                  <p className="text-[10px] text-text-muted text-center">
                    Prices in {currentPricing.currency}. Secure checkout powered by Cashfree.
                  </p>
                </div>
              )}

              {step === 'form' && (
                <div className="flex flex-col gap-4">
                  {/* Order summary */}
                  <div className="bg-elevated rounded-xl p-4 flex items-center justify-between">
                    <div>
                      <span className="text-sm font-semibold text-text-primary">{selectedPlan === 'pro_monthly' ? 'Pro Monthly' : 'Pro Yearly'}</span>
                      <span className="text-xs text-text-muted block mt-0.5">
                        Billed {selectedPlan === 'pro_yearly' ? 'annually' : 'monthly'} in {currentPricing.currency}
                      </span>
                    </div>
                    <span className="text-lg font-bold text-text-primary">
                      {format(selectedPlan === 'pro_monthly' ? monthlyPrice : yearlyPrice)}
                    </span>
                  </div>

                  {/* Form */}
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Full Name
                      </label>
                      <input
                        type="text"
                        placeholder="Your name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={200}
                        className="w-full px-3 py-2.5 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                        Email Address
                      </label>
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        maxLength={254}
                        className="w-full px-3 py-2.5 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                      />
                    </div>
                  </div>

                  {errorMessage && (
                    <p className="text-xs text-recording text-center">{errorMessage}</p>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setStep('select')}
                    >
                      Back
                    </Button>
                    <Button
                      variant="primary"
                      onClick={handleSubscribe}
                      disabled={!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)}
                      className="flex-1"
                    >
                      Continue to Payment
                    </Button>
                  </div>

                  <p className="text-[10px] text-text-muted text-center">
                    Secure checkout powered by Cashfree. Cancel anytime.
                  </p>
                </div>
              )}

              {step === 'processing' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <p className="text-sm text-text-secondary">Creating payment session...</p>
                </div>
              )}

              {step === 'error' && (
                <div className="flex flex-col items-center gap-3 py-8">
                  <p className="text-sm text-recording">{errorMessage}</p>
                  <Button
                    variant="secondary"
                    onClick={() => setStep('form')}
                  >
                    Try Again
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
