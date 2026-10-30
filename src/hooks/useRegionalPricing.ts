'use client';

import { useEffect, useState } from 'react';
import { detectCountry, getPricingForCountry, type RegionalPricing } from '@/lib/pricing';

/**
 * Regional pricing for a client surface. One implementation for the landing
 * page and the checkout sheet so they cannot disagree on the price shown.
 *
 * `enabled: false` makes no request: the caller keeps the US table, which is
 * what the sheet wants until it is open. Detection is best-effort — on failure
 * the US table stands — so this never yields an error state.
 *
 * `isLoading` is true only until the first successful resolution after being
 * enabled. It starts true when enabled, so a surface that can afford a skeleton
 * (the sheet) can hold it; the landing page simply renders US prices and swaps,
 * and ignores the flag.
 */
export function useRegionalPricing(enabled = true): {
  pricing: RegionalPricing;
  isLoading: boolean;
} {
  const [pricing, setPricing] = useState<RegionalPricing>(() => getPricingForCountry('US'));
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    detectCountry()
      .catch(() => 'US')
      .then((country) => {
        if (cancelled) return;
        setPricing(getPricingForCountry(country));
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
