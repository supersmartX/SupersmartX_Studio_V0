import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * The landing page and the checkout sheet must quote the same price. Both get
 * it from this hook, so the contract tested here is the one that keeps them
 * aligned: US (the region-neutral table) until detection resolves, never an
 * error state, and no request at all when the surface is not open.
 */

const detectCountry = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return { ...actual, detectCountry: () => detectCountry() };
});

import { useRegionalPricing } from '@/hooks/useRegionalPricing';

beforeEach(() => {
  detectCountry.mockReset();
});

describe('useRegionalPricing', () => {
  it('makes no lookup and stays on the US table when disabled', () => {
    const { result } = renderHook(() => useRegionalPricing(false));

    expect(detectCountry).not.toHaveBeenCalled();
    expect(result.current.pricing.country).toBe('US');
    expect(result.current.isLoading).toBe(false);
  });

  it('reports loading and the US table until the region resolves', async () => {
    let resolveGuard!: (country: string) => void;
    detectCountry.mockReturnValue(new Promise<string>((resolve) => {
      resolveGuard = resolve;
    }));

    const { result } = renderHook(() => useRegionalPricing());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.pricing.country).toBe('US');

    resolveGuard('IN');
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.country).toBe('IN');
    expect(result.current.pricing.currency).toBe('INR');
    expect(result.current.pricing.creatorMonthly).toBe(349);
  });

  it('falls back to the US table when detection rejects', async () => {
    detectCountry.mockRejectedValue(new Error('geo down'));

    const { result } = renderHook(() => useRegionalPricing());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.country).toBe('US');
  });

  it('falls back to the US table for a country with no regional table', async () => {
    detectCountry.mockResolvedValue('ZZ');

    const { result } = renderHook(() => useRegionalPricing());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.country).toBe('US');
  });

  it('starts detection when the surface becomes enabled', async () => {
    detectCountry.mockResolvedValue('GB');

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRegionalPricing(enabled),
      { initialProps: { enabled: false } },
    );

    expect(detectCountry).not.toHaveBeenCalled();
    rerender({ enabled: true });

    await waitFor(() => expect(result.current.pricing.country).toBe('GB'));
    expect(result.current.isLoading).toBe(false);
  });
});
