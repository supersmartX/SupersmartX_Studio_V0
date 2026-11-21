'use client';

import { useEffect, useState } from 'react';
import { getPricingForCountry, type RegionalPricing } from '@/lib/pricing';

/**
 * The price a customer is shown must equal the price the server will charge.
 *
 * The server owns that number (`getDisplayPricingForCountry`): USD for every
 * country except India, and the INR table for India. The client cannot read the
 * server's Paddle configuration, so it asks `/api/paddle/pricing` for the
 * canonical amount instead of re-deriving it from a 49-currency catalog. That
 * catalog is still used for display metadata (symbol/locale), but never for the
 * charged amount.
 *
 * `enabled: false` makes no request: the caller keeps the US table, which is
 * what the checkout sheet wants until it is open. Failure is not an error
 * state — the US table stands — because a pricing lookup must never block the
 * page.
 */
function pricingFromServer(
  payload: { currency?: unknown; monthly?: unknown; yearly?: unknown },
): RegionalPricing | null {
  if (payload.currency !== 'USD' && payload.currency !== 'INR') return null;
  if (typeof payload.monthly !== 'number' || !Number.isFinite(payload.monthly) || payload.monthly <= 0) {
    return null;
  }
  if (typeof payload.yearly !== 'number' || !Number.isFinite(payload.yearly) || payload.yearly <= 0) {
    return null;
  }
  const base = getPricingForCountry(payload.currency === 'INR' ? 'IN' : 'US');
  return {
    ...base,
    creatorMonthly: payload.monthly,
    creatorYearly: payload.yearly,
    proMonthly: payload.monthly,
    proYearly: payload.yearly,
  };
}

export function useRegionalPricing(enabled = true): {
  pricing: RegionalPricing;
  isLoading: boolean;
} {
  const [pricing, setPricing] = useState<RegionalPricing>(() => getPricingForCountry('US'));
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/paddle/pricing', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Pricing lookup failed');
        return response.json() as Promise<Record<string, unknown>>;
      })
      .then((payload) => {
        if (cancelled) return;
        const serverPricing = pricingFromServer(payload);
        setPricing(serverPricing ?? getPricingForCountry('US'));
      })
      .catch(() => {
        if (cancelled) return;
        setPricing(getPricingForCountry('US'));
      })
      .finally(() => {
        if (cancelled) return;
        setResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return {
    pricing,
    isLoading: enabled && !resolved,
  };
}
