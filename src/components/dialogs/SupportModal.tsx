'use client';

import { useState, useCallback, useEffect } from 'react';
import { CloseIcon } from '@/components/icons';
import { loadCashfreeSDK } from '@/lib/cashfree';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast: (message: string) => void;
}

const PRESET_AMOUNTS = [50, 100, 250, 500];

export function SupportModal({ isOpen, onClose, showToast }: SupportModalProps) {
  const [step, setStep] = useState<'form' | 'processing' | 'error'>('form');
  const [amount, setAmount] = useState<number>(100);
  const [customAmount, setCustomAmount] = useState('');
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const finalAmount = customAmount ? parseInt(customAmount, 10) : amount;

  useEffect(() => {
    if (isOpen) {
      loadCashfreeSDK().catch(() => {
        // SDK load failure is non-fatal; we'll catch it on submit
      });
    }
  }, [isOpen]);

  const handleSubmit = useCallback(async () => {
    if (!finalAmount || finalAmount < 1) {
      setErrorMessage('Please enter a valid amount');
      return;
    }

    if (finalAmount > 10000) {
      setErrorMessage('Maximum amount is ₹10,000');
      return;
    }

    setStep('processing');
    setErrorMessage('');

    try {
      const cashfree = await loadCashfreeSDK();

      const response = await fetch('/api/cashfree/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: finalAmount,
          name: name || 'Supporter',
          email: `supporter-${Date.now()}@supersmartx.com`,
          message,
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
        returnUrl: `${baseUrl}/support/success?order_id=${data.orderId}`,
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
  }, [finalAmount, name, message, showToast]);

  const handleClose = useCallback(() => {
    setStep('form');
    setAmount(100);
    setCustomAmount('');
    setName('');
    setMessage('');
    setErrorMessage('');
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Support SupersmartX">
      <div
        className="absolute inset-0 bg-canvas/80 backdrop-blur-md animate-fade-in"
        onClick={handleClose}
      />

      <div className="relative w-full max-w-sm bg-surface border border-border-default rounded-xl shadow-2xl animate-scale-in overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h2 className="text-sm font-semibold text-text-primary">
            Support SupersmartX
          </h2>
          <button
            onClick={handleClose}
            className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-elevated transition-colors"
            aria-label="Close"
          >
            <CloseIcon className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {step === 'form' && (
            <>
              <div className="text-center">
                <span className="text-3xl" role="img" aria-label="coffee">&#9749;</span>
                <h3 className="text-base font-bold text-text-primary mt-2 mb-1">
                  Enjoying SupersmartX?
                </h3>
                <p className="text-[13px] text-text-secondary">
                  Your support helps me keep building and improving it.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Choose an amount
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {PRESET_AMOUNTS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => { setAmount(preset); setCustomAmount(''); }}
                      className={`py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        amount === preset && !customAmount
                          ? 'bg-accent text-white shadow-lg shadow-accent/20'
                          : 'bg-elevated text-text-secondary hover:text-text-primary hover:bg-subtle border border-border-subtle'
                      }`}
                    >
                      &#8377;{preset}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-text-muted">&#8377;</span>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    placeholder="Custom"
                    value={customAmount}
                    onChange={(e) => setCustomAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2.5 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                    Name (optional)
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
                    Message (optional)
                  </label>
                  <textarea
                    placeholder="Say something nice..."
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    rows={2}
                    maxLength={500}
                    className="w-full px-3 py-2.5 bg-elevated border border-border-subtle rounded-lg text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors resize-none"
                  />
                </div>
              </div>

              {errorMessage && (
                <p className="text-xs text-recording text-center">{errorMessage}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={!finalAmount || finalAmount < 1}
                className="w-full py-3 bg-coffee hover:bg-coffee-hover text-slate-900 rounded-lg font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue to Payment
              </button>

              <p className="text-[10px] text-text-muted text-center">
                Secure checkout powered by Cashfree
              </p>
            </>
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
              <button
                onClick={() => setStep('form')}
                className="px-4 py-2 bg-elevated text-text-secondary rounded-lg text-sm hover:bg-subtle transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
