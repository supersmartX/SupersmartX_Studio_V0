'use client';

import { useState, useEffect, useCallback } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useSession } from 'next-auth/react';

interface ActivationModalProps {
  isOpen: boolean;
  plan: string;
  orderId: string | null;
  onClose: () => void;
}

export function ActivationModal({ isOpen, plan, orderId, onClose }: ActivationModalProps) {
  const { update } = useSession();
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending');
  const [pollCount, setPollCount] = useState(0);

  const planName = plan.includes('yearly') ? 'Creator Yearly' : 'Creator Monthly';

  // Poll session to detect when webhook has activated the plan
  useEffect(() => {
    if (!isOpen || status === 'confirmed') return;

    const poll = async () => {
      try {
        const result = await update();
        const userPlan = result && typeof result === 'object' && 'plan' in result ? (result as { plan: string }).plan : null;
        if (userPlan && userPlan !== 'free') {
          setStatus('confirmed');
          return;
        }
      } catch {}
      setPollCount((c) => c + 1);
    };

    // Poll every 2 seconds, max 15 times (30 seconds)
    if (pollCount < 15) {
      const timer = setTimeout(poll, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, status, pollCount, update]);

  const handleContinue = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      ariaLabel="Creator plan activated"
      maxWidth="max-w-sm"
    >
      <div className="flex flex-col items-center gap-4 py-2">
        {status === 'confirmed' ? (
          <>
            <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
              <svg className="w-7 h-7 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-text-primary">You&apos;re a Creator</h3>
              <p className="text-[13px] text-text-secondary mt-1">
                {planName} is now active.
              </p>
            </div>
            {orderId && (
              <p className="text-[11px] text-text-muted">Order {orderId}</p>
            )}
            <Button size="md" className="w-full" onClick={handleContinue}>
              Continue creating
            </Button>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-text-primary">Confirming your plan...</h3>
              <p className="text-[13px] text-text-secondary mt-1">
                Payment received. We&apos;re activating {planName}.
              </p>
            </div>
            {pollCount >= 15 && (
              <div className="text-center">
                <p className="text-[12px] text-text-muted">
                  Taking longer than expected. Your plan will activate shortly.
                </p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={handleContinue}>
                  Continue anyway
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
