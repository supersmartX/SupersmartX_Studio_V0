'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function SuccessContent() {
  const searchParams = useSearchParams();
  const orderId = searchParams.get('order_id');

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-border-default rounded-xl shadow-lg p-8 text-center">
        <div className="text-5xl mb-4" role="img" aria-label="celebration">&#127881;</div>
        <h1 className="text-xl font-bold text-text-primary mb-2">Thank you for your support!</h1>
        <p className="text-sm text-text-secondary mb-6">
          Your contribution helps us keep building and improving SupersmartX.
        </p>
        {orderId && (
          <p className="text-xs text-text-muted mb-6">
            Order ID: <span className="font-mono">{orderId}</span>
          </p>
        )}
        <Link
          href="/"
          className="inline-block px-6 py-3 bg-accent text-white rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Back to SupersmartX
        </Link>
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
