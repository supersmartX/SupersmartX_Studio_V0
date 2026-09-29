'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useSession } from 'next-auth/react';

interface ActivationModalProps {
  isOpen: boolean;
  plan: string;
  orderId: string | null;
  onClose: () => void;
}

const MAX_POLLS = 15;
const POLL_INTERVAL_MS = 2000;

function planIsActive(plan: unknown): boolean {
  return typeof plan === 'string' && plan !== 'free';
}

export function ActivationModal({ isOpen, plan, orderId, onClose }: ActivationModalProps) {
  const { update } = useSession();
  const [status, setStatus] = useState<'pending' | 'confirmed'>('pending');
  const [pollCount, setPollCount] = useState(0);

  const planName = plan.includes('yearly') ? 'Creator Yearly' : 'Creator Monthly';

  const confirmedRef = useRef(false);

  // Each return trip is a fresh confirmation attempt. Without this reset a
  // second purchase would inherit the first one's `confirmed` state (or its
  // exhausted poll budget) and never re-verify. `confirmedRef` must be reset in
  // the same pass: a new orderId can arrive while the modal is still open, and
  // a stale `true` would make the poller return without ever setting `confirmed`.
  useEffect(() => {
    if (!isOpen) return;
    confirmedRef.current = false;
    setStatus('pending');
    setPollCount(0);
  }, [isOpen, orderId]);

  useEffect(() => {
    if (!isOpen || status === 'confirmed') return;
    if (pollCount >= MAX_POLLS) return;

    const timer = setTimeout(async () => {
      // Ask the server to re-verify the order while we wait for the webhook:
      // the return trip may land before the webhook does.
      if (orderId) {
        try {
          const res = await fetch(`/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`, {
            method: 'POST',
          });
          if (res.ok) {
            const body = (await res.json().catch(() => null)) as { status?: string } | null;
            if (body?.status === 'activated') {
              if (!confirmedRef.current) {
                confirmedRef.current = true;
                setStatus('confirmed');
              }
              return;
            }
          }
        } catch {}
      }

      try {
        // `plan` lives on session.user, not on the session root.
        const result = await update();
        const userPlan = result?.user?.plan;
        if (planIsActive(userPlan)) {
          if (!confirmedRef.current) {
            confirmedRef.current = true;
            setStatus('confirmed');
          }
          return;
        }
      } catch {}

      setPollCount((c) => c + 1);
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [isOpen, status, pollCount, orderId, update]);

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
                Checking your payment with our provider and activating {planName}.
              </p>
            </div>
            {pollCount >= MAX_POLLS && (
              <div className="text-center">
                <p className="text-[12px] text-text-muted">
                  Taking longer than expected. Your plan will activate as soon as your payment is
                  confirmed — you can keep using the free tier in the meantime.
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
