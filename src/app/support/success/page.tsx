'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order_id');
  const plan = searchParams.get('plan');

  const planName = plan === 'pro_yearly' ? 'Pro Yearly' : plan === 'pro_monthly' ? 'Pro Monthly' : 'Pro';

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-border-default rounded-xl shadow-lg overflow-hidden">
        {/* Header */}
        <div className="p-8 text-center border-b border-border-subtle">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-success/10 flex items-center justify-center">
            <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">Payment Successful</h1>
          <p className="text-sm text-text-secondary">
            Thank you for subscribing to <span className="font-semibold text-accent">{planName}</span>!
          </p>
        </div>

        {/* Receipt */}
        <div className="p-6">
          <div className="bg-elevated rounded-xl p-4 mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Receipt</h3>
            <div className="space-y-2">
              {orderId && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-muted">Order ID</span>
                  <span className="text-xs font-mono text-text-secondary">{orderId}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Plan</span>
                <span className="text-sm font-semibold text-text-primary">{planName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-muted">Status</span>
                <span className="text-sm font-semibold text-success">Paid</span>
              </div>
            </div>
          </div>

          {/* Email notice */}
          <div className="flex items-start gap-3 p-3 bg-accent/5 border border-accent/20 rounded-lg mb-6">
            <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
            <div>
              <p className="text-xs font-semibold text-accent">Confirmation email sent</p>
              <p className="text-[11px] text-text-muted mt-0.5">Check your inbox for the receipt and plan details.</p>
            </div>
          </div>

          {/* CTA */}
          <Link
            href="/studio"
            className="block w-full py-3 bg-accent text-white rounded-lg font-semibold text-sm text-center hover:opacity-90 transition-opacity"
          >
            Open SupersmartX Studio
          </Link>

          <Link
            href="/"
            className="block w-full py-3 mt-2 text-text-secondary text-center text-sm hover:text-text-primary transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SupportSuccessPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <SuccessContent />
    </Suspense>
  );
}
