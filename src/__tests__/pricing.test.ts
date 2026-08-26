import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPricingForCountry,
  formatPrice,
  getServerPrice,
  validateOrderAmount,
  detectCountry,
  getCachedCountry,
  cacheCountry,
  ALL_COUNTRIES,
} from '@/lib/pricing';

describe('getPricingForCountry', () => {
  it('returns US pricing for US', () => {
    const pricing = getPricingForCountry('US');
    expect(pricing.country).toBe('US');
    expect(pricing.currency).toBe('USD');
    expect(pricing.creatorMonthly).toBe(7.99);
    expect(pricing.creatorYearly).toBe(59.99);
    expect(pricing.proMonthly).toBe(14.99);
    expect(pricing.proYearly).toBe(119.99);
  });

  it('returns IN pricing for India', () => {
    const pricing = getPricingForCountry('IN');
    expect(pricing.country).toBe('IN');
    expect(pricing.currency).toBe('INR');
    expect(pricing.creatorMonthly).toBe(349);
    expect(pricing.proMonthly).toBe(649);
  });

  it('returns fallback (IN) for unknown country', () => {
    const pricing = getPricingForCountry('ZZ');
    expect(pricing.country).toBe('IN');
    expect(pricing.currency).toBe('INR');
  });

  it('returns valid pppIndex for all countries', () => {
    for (const c of ALL_COUNTRIES) {
      const pricing = getPricingForCountry(c.code);
      expect(pricing.pppIndex).toBeGreaterThan(0);
      expect(pricing.pppIndex).toBeLessThanOrEqual(200);
    }
  });
});

describe('formatPrice', () => {
  it('returns "Free" for zero', () => {
    expect(formatPrice(0, '$', 'en-US')).toBe('Free');
  });

  it('formats decimal prices', () => {
    expect(formatPrice(4.99, '$', 'en-US')).toBe('$4.99');
  });

  it('formats integer prices', () => {
    expect(formatPrice(199, '₹', 'en-IN')).toBe('₹199');
  });

  it('formats large numbers with commas', () => {
    expect(formatPrice(49990, 'Rp', 'id-ID')).toContain('49');
    expect(formatPrice(49990, 'Rp', 'id-ID')).toContain('990');
  });
});

describe('getServerPrice', () => {
  it('returns creator_monthly price for creator_monthly + USD', () => {
    expect(getServerPrice('creator_monthly', 'USD')).toBe(7.99);
  });

  it('returns creator_yearly price for creator_yearly + USD', () => {
    expect(getServerPrice('creator_yearly', 'USD')).toBe(59.99);
  });

  it('returns pro_monthly price for pro_monthly + USD', () => {
    expect(getServerPrice('pro_monthly', 'USD')).toBe(14.99);
  });

  it('returns pro_yearly price for pro_yearly + USD', () => {
    expect(getServerPrice('pro_yearly', 'USD')).toBe(119.99);
  });

  it('returns INR price for creator_monthly + INR', () => {
    expect(getServerPrice('creator_monthly', 'INR')).toBe(349);
  });

  it('returns null for invalid plan', () => {
    expect(getServerPrice('free', 'USD')).toBeNull();
    expect(getServerPrice('invalid', 'USD')).toBeNull();
  });

  it('falls back to INR for unknown currency', () => {
    expect(getServerPrice('creator_monthly', 'UNKNOWN')).toBe(349);
  });
});

describe('validateOrderAmount', () => {
  it('returns true for correct amount', () => {
    expect(validateOrderAmount('creator_monthly', 'USD', 7.99)).toBe(true);
  });

  it('returns true for amount within tolerance', () => {
    expect(validateOrderAmount('creator_monthly', 'USD', 7.995)).toBe(true);
  });

  it('returns false for wrong amount', () => {
    expect(validateOrderAmount('creator_monthly', 'USD', 1)).toBe(false);
  });

  it('returns false for invalid plan', () => {
    expect(validateOrderAmount('free', 'USD', 0)).toBe(false);
  });

  it('returns false for negative amount', () => {
    expect(validateOrderAmount('creator_monthly', 'USD', -7.99)).toBe(false);
  });
});

describe('getCachedCountry / cacheCountry', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no cache exists', () => {
    expect(getCachedCountry()).toBeNull();
  });

  it('caches and retrieves country', () => {
    cacheCountry('US');
    expect(getCachedCountry()).toBe('US');
  });

  it('returns null for expired cache', () => {
    const expired = { country: 'US', detectedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 };
    localStorage.setItem('sxs-pricing-region', JSON.stringify(expired));
    expect(getCachedCountry()).toBeNull();
  });

  it('handles corrupted cache gracefully', () => {
    localStorage.setItem('sxs-pricing-region', 'not-json');
    expect(getCachedCountry()).toBeNull();
  });
});

describe('detectCountry', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns cached value if available', async () => {
    cacheCountry('DE');
    const result = await detectCountry();
    expect(result).toBe('DE');
  });

  it('returns IN as fallback on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await detectCountry();
    expect(result).toBe('IN');
  });
});
