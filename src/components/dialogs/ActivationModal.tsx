'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useSession } from 'next-auth/react';

interface ActivationModalProps {
  isOpen: boolean;
  plan: string;
  orderId: string | null;
  /**
   * How the modal left, so the studio can undo the parts of the upgrade that
   * only make sense once a plan is actually live.
   *   'confirmed'  — the plan is active; restore the format the user was after.
   *   'unresolved' — we gave up waiting, but the webhook may still land.
   *   'failed'     — Cashfree says this order is dead. Nothing was activated
   *                  and nothing should be treated as if it were.
   */
  onClose: (outcome: ActivationOutcome) => void;
  /** Reopen checkout from the failure state, keeping the same order intent. */
  onRetry?: () => void;
}

export type ActivationOutcome = 'confirmed' | 'unresolved' | 'failed';

const MAX_POLLS = 15;
const POLL_INTERVAL_MS = 2000;

function planIsActive(plan: unknown): boolean {
  return typeof plan === 'string' && plan !== 'free';
}

export function ActivationModal({ isOpen, plan, orderId, onClose, onRetry }: ActivationModalProps) {
  const { update } = useSession();
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>('pending');
  const [pollCount, setPollCount] = useState(0);

  const planName = plan.includes('yearly') ? 'Creator (1 year)' : 'Creator (1 month)';

  const confirmedRef = useRef(false);
  const failedRef = useRef(false);
  // `onClose` is a fresh closure every render of the studio page; reading the
  // outcome through a ref keeps the modal's dismiss paths reporting what
  // actually happened rather than whatever the last render captured.
  const outcomeRef = useRef<ActivationOutcome>('unresolved');

  // Each return trip is a fresh confirmation attempt. Without this reset a
  // second purchase would inherit the first one's `confirmed` state (or its
  // exhausted poll budget) and never re-verify. `confirmedRef` must be reset in
  // the same pass: a new orderId can arrive while the modal is still open, and
  // a stale `true` would make the poller return without ever setting `confirmed`.
  useEffect(() => {
    if (!isOpen) return;
    confirmedRef.current = false;
    failedRef.current = false;
    outcomeRef.current = 'unresolved';
    setStatus('pending');
    setPollCount(0);
  }, [isOpen, orderId]);

  /**
   * Flip to "confirmed" only after the *session* has been refreshed, not just
   * once the server says the order settled.
   *
   * The studio behind this modal is rendered from `session.user.plan` — platform
   * locks, export limits, the upgrade prompt. Announcing "You're a Creator"
   * over a session that still says `free` is the one bug that makes a genuinely
   * successful purchase look broken: the user is told they paid, then watches
   * Free restrictions persist until a manual reload. So refresh first, then
   * claim success.
   *
   * The server's `activated` verdict is what we actually trust — it read
   * Cashfree directly. The refresh is best-effort, so a dropped session fetch
   * must not strand the buyer on the spinner with a plan that is already live.
   */
  const settleAndConfirm = useCallback(async () => {
    try {
      await update();
    } catch {}
    if (!confirmedRef.current) {
      confirmedRef.current = true;
      outcomeRef.current = 'confirmed';
      setStatus('confirmed');
    }
  }, [update]);

  useEffect(() => {
    if (!isOpen || status === 'confirmed') return;
    // A dead order is an answer, not a delay. Keep polling it and the buyer
    // watches a spinner for 30 seconds and is then told their plan is on its
    // way — for a payment that was declined before it ever left their bank.
    if (status === 'failed') return;
    if (pollCount >= MAX_POLLS) return;

    const timer = setTimeout(async () => {
      // Ask the server to re-verify the order while we wait for the webhook:
      // the return trip routinely beats the webhook, and the server can read
      // Cashfree's authoritative order state even when the webhook has not
      // landed. The server answers with one of three verdicts — `failed` is
      // terminal, `pending` is "the webhook race is still on", `activated`
      // means the plan write is done.
      if (orderId) {
        try {
          const res = await fetch(`/api/cashfree/verify?order_id=${encodeURIComponent(orderId)}`, {
            method: 'POST',
          });
          if (res.ok) {
            const body = (await res.json().catch(() => null)) as { status?: string } | null;
            if (body?.status === 'activated') {
              // The order is settled and the plan is written. Nothing is being
              // "confirmed" on the buyer's behalf any more — just make sure the
              // session sees it before we say so.
              await settleAndConfirm();
              return;
            }
            if (body?.status === 'failed' && !failedRef.current) {
              failedRef.current = true;
              outcomeRef.current = 'failed';
              setStatus('failed');
              return;
            }
          }
        } catch {}
      }

      try {
        // The webhook may have arrived on its own and written the plan without
        // our help. Reading the session is how we notice; it also carries the
        // plan into the session, which is what the studio renders from.
        // `plan` lives on session.user, not on the session root.
        const result = await update();
        const userPlan = result?.user?.plan;
        if (planIsActive(userPlan)) {
          if (!confirmedRef.current) {
            confirmedRef.current = true;
            outcomeRef.current = 'confirmed';
            setStatus('confirmed');
          }
          return;
        }
      } catch {}

      setPollCount((c) => c + 1);
    }, POLL_INTERVAL_MS);

    return () => clearTimeout(timer);
  }, [isOpen, status, pollCount, orderId, update, settleAndConfirm]);

  const handleClose = useCallback(() => {
    onClose(outcomeRef.current);
  }, [onClose]);

  const handleContinue = useCallback(() => {
    if (status === 'confirmed') {
      outcomeRef.current = 'confirmed';
    } else if (status === 'pending' && pollCount >= MAX_POLLS) {
      outcomeRef.current = 'unresolved';
    }
    onClose(outcomeRef.current);
  }, [onClose, status, pollCount]);

  if (!isOpen) return null;

  // While the webhook is still in flight the dialog must not describe itself as
  // an activation, to a screen reader any more than to the eye. The label is
  // the single most-read string on the screen for anyone using a reader.
  const ariaLabel =
    status === 'failed'
      ? 'Payment unsuccessful'
      : status === 'confirmed'
        ? 'Creator plan activated'
        : 'Confirming your payment';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel={ariaLabel}
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
        ) : status === 'failed' ? (
          <>
            <div className="w-14 h-14 rounded-full bg-warning/10 flex items-center justify-center">
              <svg className="w-7 h-7 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-text-primary">Payment didn&apos;t go through</h3>
              <p className="text-[13px] text-text-secondary mt-1">
                You&apos;re still on Free. Nothing was charged and your recording is right
                where you left it — you can export it to YouTube 16:9 now, or try the
                upgrade again.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full">
              {onRetry && (
                <Button size="md" className="w-full" onClick={() => { onClose('failed'); onRetry(); }}>
                  Try again
                </Button>
              )}
              <Button variant="secondary" size="md" className="w-full" onClick={handleContinue}>
                Continue with Free
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-accent/10 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
            <div className="text-center">
              <h3 className="text-[18px] font-bold text-text-primary">Confirming your payment...</h3>
              <p className="text-[13px] text-text-secondary mt-1">
                Your bank is settling the {planName} payment. Your plan switches on the moment
                it lands — your recording stays exactly as it is in the meantime.
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
