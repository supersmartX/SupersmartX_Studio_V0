import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

/**
 * The landing page and the checkout sheet must quote the same price, and that
 * price must be the one the server charges. Both get it from this hook, so the
 * contract tested here is: US (the region-neutral table) until the server
 * answers, never an error state, no request when the surface is not open, and
 * the server's amount wins over the local catalog.
 */

const fetchMock = vi.hoisted(() => vi.fn());

import { useRegionalPricing } from '@/hooks/useRegionalPricing';

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: async () => body };
}

describe('useRegionalPricing', () => {
  it('makes no lookup and stays on the US table when disabled', () => {
    const { result } = renderHook(() => useRegionalPricing(false));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.current.pricing.country).toBe('US');
    expect(result.current.isLoading).toBe(false);
  });

  it('reports loading and the US table until the server answers', async () => {
    let resolveGuard!: (value: unknown) => void;
    fetchMock.mockReturnValue(new Promise((resolve) => {
      resolveGuard = resolve;
    }));

    const { result } = renderHook(() => useRegionalPricing());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.pricing.country).toBe('US');

    resolveGuard(jsonResponse({ currency: 'INR', monthly: 349, yearly: 2899 }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.currency).toBe('INR');
    expect(result.current.pricing.creatorMonthly).toBe(349);
    expect(result.current.pricing.creatorYearly).toBe(2899);
  });

  it('falls back to the US table when the lookup rejects', async () => {
    fetchMock.mockRejectedValue(new Error('pricing down'));

    const { result } = renderHook(() => useRegionalPricing());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.country).toBe('US');
    expect(result.current.pricing.currency).toBe('USD');
  });

  it('falls back to the US table when the server answers an invalid payload', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ currency: 'EUR', monthly: 9.99, yearly: 79.99 }));

    const { result } = renderHook(() => useRegionalPricing());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.country).toBe('US');
    expect(result.current.pricing.currency).toBe('USD');
  });

  it('starts the lookup when the surface becomes enabled', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ currency: 'USD', monthly: 7.99, yearly: 59.99 }));

    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useRegionalPricing(enabled),
      { initialProps: { enabled: false } },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ enabled: true });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.pricing.creatorMonthly).toBe(7.99);
  });
});
