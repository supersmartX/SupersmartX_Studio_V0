'use client';

import Script from 'next/script';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';

interface PaddleEvent { name: string }
interface PaddleBrowser {
  Environment: { set(environment: 'sandbox'): void };
  Initialize(options: { token: string; eventCallback(event: PaddleEvent): void }): void;
  Update(options: { eventCallback(event: PaddleEvent): void }): void;
  Checkout: { open(options: { transactionId: string }): void };
}

const initialized = new WeakSet<PaddleBrowser>();

export function PaddleCheckout({ token, transactionId }: { token: string; transactionId: string }) {
  const [state, setState] = useState<'loading' | 'open' | 'closed' | 'pending' | 'error'>('loading');
  const provider = useRef<PaddleBrowser | null>(null);
  const ready = useRef(false);
  const onEvent = (event: PaddleEvent) => {
    if (event.name === 'checkout.completed') setState('pending');
    else if (event.name === 'checkout.closed') setState((current) => current === 'pending' ? current : 'closed');
    else if (event.name === 'checkout.error') setState('error');
  };
  const open = () => {
    try {
      if (!provider.current) throw new Error('Checkout is not loaded');
      provider.current.Checkout.open({ transactionId });
      setState('open');
    } catch {
      setState('error');
    }
  };

  return (
    <section className="space-y-6 rounded-xl border border-border-default bg-surface p-6">
      <Script
        src="https://cdn.paddle.com/paddle/v2/paddle.js"
        strategy="afterInteractive"
        onReady={() => {
          if (ready.current) return;
          try {
            const paddle = (window as Window & { Paddle?: PaddleBrowser }).Paddle;
            if (!paddle) throw new Error('Checkout is unavailable');
            provider.current = paddle;
            if (!initialized.has(paddle)) {
              paddle.Environment.set('sandbox');
              // Paddle automatically opens the transaction in the _ptxn query.
              paddle.Initialize({ token, eventCallback: onEvent });
              initialized.add(paddle);
            } else {
              paddle.Update({ eventCallback: onEvent });
              paddle.Checkout.open({ transactionId });
            }
            ready.current = true;
            setState('open');
          } catch {
            setState('error');
          }
        }}
        onError={() => setState('error')}
      />
      <h1 className="text-2xl font-semibold text-text-primary">Complete your payment</h1>
      <p role={state === 'error' ? 'alert' : 'status'} aria-live="polite" className="text-text-secondary">
        {state === 'loading' && 'Loading secure checkout…'}
        {state === 'open' && 'Complete payment in the secure checkout. Your access updates after payment is verified.'}
        {state === 'closed' && 'Checkout was closed. You can reopen the same payment below.'}
        {state === 'pending' && 'Your payment is being verified. Return to Studio to check your access.'}
        {state === 'error' && 'Checkout could not load. Check your connection and reload this page to resume the same payment.'}
      </p>
      {(state === 'closed' || state === 'open') && <Button onClick={open}>Reopen checkout</Button>}
      {state === 'error' && <Button onClick={() => window.location.reload()}>Reload checkout</Button>}
      <Link href="/studio" className="block text-accent-text underline">Return to Studio</Link>
    </section>
  );
}
