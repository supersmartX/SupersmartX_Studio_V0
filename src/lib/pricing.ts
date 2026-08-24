export interface RegionalPricing {
  country: string;
  currency: string;
  symbol: string;
  locale: string;
  monthly: number;
  yearly: number;
  yearlyOriginal: number;
  pppIndex: number; // Purchasing Power Index relative to US=152
}

// PPP-adjusted pricing based on Numbeo Purchasing Power Index 2026
// US=152 as base. Price = basePrice * (pppIndex / 152)
// Base: $4.99/month USD
const BASE_MONTHLY_USD = 4.99;

const REGION_PRICING: Record<string, RegionalPricing> = {
  // High purchasing power — full price or slight premium
  US: { country: 'US', currency: 'USD', symbol: '$', locale: 'en-US', monthly: 4.99, yearly: 49.99, yearlyOriginal: 59.88, pppIndex: 152 },
  CH: { country: 'CH', currency: 'CHF', symbol: 'CHF', locale: 'de-CH', monthly: 5.49, yearly: 54.99, yearlyOriginal: 65.88, pppIndex: 176 },
  LU: { country: 'LU', currency: 'EUR', symbol: '€', locale: 'lb-LU', monthly: 5.49, yearly: 54.99, yearlyOriginal: 65.88, pppIndex: 167 },
  QA: { country: 'QA', currency: 'QAR', symbol: 'QR', locale: 'en-QA', monthly: 17.99, yearly: 179.99, yearlyOriginal: 215.88, pppIndex: 160 },
  OM: { country: 'OM', currency: 'OMR', symbol: 'OMR', locale: 'ar-OM', monthly: 1.99, yearly: 19.99, yearlyOriginal: 23.88, pppIndex: 156 },
  KW: { country: 'KW', currency: 'KWD', symbol: 'KD', locale: 'ar-KW', monthly: 1.49, yearly: 14.99, yearlyOriginal: 17.88, pppIndex: 183 },
  DK: { country: 'DK', currency: 'DKK', symbol: 'kr', locale: 'da-DK', monthly: 32.99, yearly: 329.99, yearlyOriginal: 395.88, pppIndex: 151 },
  NO: { country: 'NO', currency: 'NOK', symbol: 'kr', locale: 'nb-NO', monthly: 54.99, yearly: 549.99, yearlyOriginal: 659.88, pppIndex: 128 },
  SG: { country: 'SG', currency: 'SGD', symbol: 'S$', locale: 'en-SG', monthly: 6.99, yearly: 69.99, yearlyOriginal: 83.88, pppIndex: 133 },
  AU: { country: 'AU', currency: 'AUD', symbol: 'A$', locale: 'en-AU', monthly: 6.99, yearly: 69.99, yearlyOriginal: 83.88, pppIndex: 142 },
  NZ: { country: 'NZ', currency: 'NZD', symbol: 'NZ$', locale: 'en-NZ', monthly: 7.49, yearly: 74.99, yearlyOriginal: 89.88, pppIndex: 128 },

  // Upper-mid purchasing power
  DE: { country: 'DE', currency: 'EUR', symbol: '€', locale: 'de-DE', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 142 },
  NL: { country: 'NL', currency: 'EUR', symbol: '€', locale: 'nl-NL', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 137 },
  SE: { country: 'SE', currency: 'SEK', symbol: 'kr', locale: 'sv-SE', monthly: 49.99, yearly: 499.99, yearlyOriginal: 599.88, pppIndex: 137 },
  AT: { country: 'AT', currency: 'EUR', symbol: '€', locale: 'de-AT', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 110 },
  FI: { country: 'FI', currency: 'EUR', symbol: '€', locale: 'fi-FI', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 133 },
  BE: { country: 'BE', currency: 'EUR', symbol: '€', locale: 'nl-BE', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 128 },
  IE: { country: 'IE', currency: 'EUR', symbol: '€', locale: 'en-IE', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 113 },
  AE: { country: 'AE', currency: 'AED', symbol: 'AED', locale: 'en-AE', monthly: 17.99, yearly: 179.99, yearlyOriginal: 215.88, pppIndex: 132 },
  SA: { country: 'SA', currency: 'SAR', symbol: 'SAR', locale: 'ar-SA', monthly: 18.99, yearly: 189.99, yearlyOriginal: 227.88, pppIndex: 136 },

  // Mid purchasing power
  GB: { country: 'GB', currency: 'GBP', symbol: '£', locale: 'en-GB', monthly: 3.99, yearly: 39.99, yearlyOriginal: 47.88, pppIndex: 124 },
  FR: { country: 'FR', currency: 'EUR', symbol: '€', locale: 'fr-FR', monthly: 4.49, yearly: 44.99, yearlyOriginal: 53.88, pppIndex: 113 },
  JP: { country: 'JP', currency: 'JPY', symbol: '¥', locale: 'ja-JP', monthly: 699, yearly: 6990, yearlyOriginal: 8388, pppIndex: 123 },
  IT: { country: 'IT', currency: 'EUR', symbol: '€', locale: 'it-IT', monthly: 3.99, yearly: 39.99, yearlyOriginal: 47.88, pppIndex: 101 },
  ES: { country: 'ES', currency: 'EUR', symbol: '€', locale: 'es-ES', monthly: 3.99, yearly: 39.99, yearlyOriginal: 47.88, pppIndex: 101 },
  KR: { country: 'KR', currency: 'KRW', symbol: '₩', locale: 'ko-KR', monthly: 4990, yearly: 49900, yearlyOriginal: 59880, pppIndex: 100 },
  CZ: { country: 'CZ', currency: 'CZK', symbol: 'Kč', locale: 'cs-CZ', monthly: 99.99, yearly: 999.99, yearlyOriginal: 1199.88, pppIndex: 91 },
  PT: { country: 'PT', currency: 'EUR', symbol: '€', locale: 'pt-PT', monthly: 3.49, yearly: 34.99, yearlyOriginal: 41.88, pppIndex: 62 },
  EE: { country: 'EE', currency: 'EUR', symbol: '€', locale: 'et-EE', monthly: 3.49, yearly: 34.99, yearlyOriginal: 41.88, pppIndex: 86 },
  SI: { country: 'SI', currency: 'EUR', symbol: '€', locale: 'sl-SI', monthly: 3.49, yearly: 34.99, yearlyOriginal: 41.88, pppIndex: 86 },
  LT: { country: 'LT', currency: 'EUR', symbol: '€', locale: 'lt-LT', monthly: 3.49, yearly: 34.99, yearlyOriginal: 41.88, pppIndex: 82 },
  HR: { country: 'HR', currency: 'EUR', symbol: '€', locale: 'hr-HR', monthly: 3.49, yearly: 34.99, yearlyOriginal: 41.88, pppIndex: 81 },
  MY: { country: 'MY', currency: 'MYR', symbol: 'RM', locale: 'ms-MY', monthly: 14.99, yearly: 149.99, yearlyOriginal: 179.88, pppIndex: 65 },
  TH: { country: 'TH', currency: 'THB', symbol: '฿', locale: 'th-TH', monthly: 129, yearly: 1290, yearlyOriginal: 1548, pppIndex: 55 },
  CN: { country: 'CN', currency: 'CNY', symbol: '¥', locale: 'zh-CN', monthly: 24.99, yearly: 249.99, yearlyOriginal: 299.88, pppIndex: 80 },
  TR: { country: 'TR', currency: 'TRY', symbol: '₺', locale: 'tr-TR', monthly: 149.99, yearly: 1499.99, yearlyOriginal: 1799.88, pppIndex: 40 },
  MX: { country: 'MX', currency: 'MXN', symbol: 'MX$', locale: 'es-MX', monthly: 64.99, yearly: 649.99, yearlyOriginal: 779.88, pppIndex: 45 },
  PH: { country: 'PH', currency: 'PHP', symbol: '₱', locale: 'en-PH', monthly: 179, yearly: 1790, yearlyOriginal: 2148, pppIndex: 35 },
  CO: { country: 'CO', currency: 'COP', symbol: 'COL$', locale: 'es-CO', monthly: 14999, yearly: 149990, yearlyOriginal: 179988, pppIndex: 35 },
  ZA: { country: 'ZA', currency: 'ZAR', symbol: 'R', locale: 'en-ZA', monthly: 69.99, yearly: 699.99, yearlyOriginal: 839.88, pppIndex: 45 },
  ID: { country: 'ID', currency: 'IDR', symbol: 'Rp', locale: 'id-ID', monthly: 49900, yearly: 499000, yearlyOriginal: 598800, pppIndex: 35 },

  // Lower-mid purchasing power
  BR: { country: 'BR', currency: 'BRL', symbol: 'R$', locale: 'pt-BR', monthly: 14.99, yearly: 149.99, yearlyOriginal: 179.88, pppIndex: 38 },
  IN: { country: 'IN', currency: 'INR', symbol: '₹', locale: 'en-IN', monthly: 199, yearly: 1990, yearlyOriginal: 2388, pppIndex: 25 },
  EG: { country: 'EG', currency: 'EGP', symbol: 'E£', locale: 'ar-EG', monthly: 99.99, yearly: 999.99, yearlyOriginal: 1199.88, pppIndex: 22 },
  PK: { country: 'PK', currency: 'PKR', symbol: '₨', locale: 'en-PK', monthly: 499, yearly: 4990, yearlyOriginal: 5988, pppIndex: 18 },
  BD: { country: 'BD', currency: 'BDT', symbol: '৳', locale: 'bn-BD', monthly: 349, yearly: 3490, yearlyOriginal: 4188, pppIndex: 22 },
  VN: { country: 'VN', currency: 'VND', symbol: '₫', locale: 'vi-VN', monthly: 79000, yearly: 790000, yearlyOriginal: 948000, pppIndex: 32 },
  GH: { country: 'GH', currency: 'GHS', symbol: 'GH₵', locale: 'en-GH', monthly: 39.99, yearly: 399.99, yearlyOriginal: 479.88, pppIndex: 20 },
  KE: { country: 'KE', currency: 'KES', symbol: 'KSh', locale: 'en-KE', monthly: 499, yearly: 4990, yearlyOriginal: 5988, pppIndex: 22 },
  NG: { country: 'NG', currency: 'NGN', symbol: '₦', locale: 'en-NG', monthly: 1499, yearly: 14990, yearlyOriginal: 17988, pppIndex: 9 },
  TZ: { country: 'TZ', currency: 'TZS', symbol: 'TSh', locale: 'sw-TZ', monthly: 9999, yearly: 99990, yearlyOriginal: 119988, pppIndex: 12 },
  UG: { country: 'UG', currency: 'UGX', symbol: 'USh', locale: 'en-UG', monthly: 14999, yearly: 149990, yearlyOriginal: 179988, pppIndex: 12 },
  ET: { country: 'ET', currency: 'ETB', symbol: 'Br', locale: 'am-ET', monthly: 499, yearly: 4990, yearlyOriginal: 5988, pppIndex: 12 },
  MM: { country: 'MM', currency: 'MMK', symbol: 'K', locale: 'my-MM', monthly: 6999, yearly: 69990, yearlyOriginal: 83988, pppIndex: 15 },
  NP: { country: 'NP', currency: 'NPR', symbol: 'Rs', locale: 'ne-NP', monthly: 499, yearly: 4990, yearlyOriginal: 5988, pppIndex: 18 },
  LK: { country: 'LK', currency: 'LKR', symbol: 'Rs', locale: 'si-LK', monthly: 999, yearly: 9990, yearlyOriginal: 11988, pppIndex: 20 },
  UA: { country: 'UA', currency: 'UAH', symbol: '₴', locale: 'uk-UA', monthly: 169.99, yearly: 1699.99, yearlyOriginal: 2039.88, pppIndex: 25 },
  RO: { country: 'RO', currency: 'RON', symbol: 'lei', locale: 'ro-RO', monthly: 19.99, yearly: 199.99, yearlyOriginal: 239.88, pppIndex: 50 },
  PL: { country: 'PL', currency: 'PLN', symbol: 'zł', locale: 'pl-PL', monthly: 17.99, yearly: 179.99, yearlyOriginal: 215.88, pppIndex: 60 },
  HU: { country: 'HU', currency: 'HUF', symbol: 'Ft', locale: 'hu-HU', monthly: 1599, yearly: 15990, yearlyOriginal: 19188, pppIndex: 45 },
  AR: { country: 'AR', currency: 'ARS', symbol: 'AR$', locale: 'es-AR', monthly: 4999, yearly: 49990, yearlyOriginal: 59988, pppIndex: 30 },
  CL: { country: 'CL', currency: 'CLP', symbol: 'CL$', locale: 'es-CL', monthly: 3999, yearly: 39990, yearlyOriginal: 47988, pppIndex: 38 },
  PE: { country: 'PE', currency: 'PEN', symbol: 'S/', locale: 'es-PE', monthly: 17.99, yearly: 179.99, yearlyOriginal: 215.88, pppIndex: 40 },
};

const FALLBACK: RegionalPricing = REGION_PRICING['IN'];

const STORAGE_KEY = 'sxs-pricing-region';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedRegion {
  country: string;
  detectedAt: number;
}

export function getCachedCountry(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached: CachedRegion = JSON.parse(raw);
    if (Date.now() - cached.detectedAt > CACHE_TTL) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return cached.country;
  } catch {
    return null;
  }
}

export function cacheCountry(country: string): void {
  if (typeof window === 'undefined') return;
  try {
    const data: CachedRegion = { country, detectedAt: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export async function detectCountry(): Promise<string> {
  const cached = getCachedCountry();
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Geo lookup failed');
    const data = await res.json();
    const country = data.country_code || 'IN';
    cacheCountry(country);
    return country;
  } catch {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('https://ip-api.com/json/?fields=countryCode', { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('Geo lookup failed');
      const data = await res.json();
      const country = data.countryCode || 'IN';
      cacheCountry(country);
      return country;
    } catch {
      return 'IN';
    }
  }
}

export function getPricingForCountry(country: string): RegionalPricing {
  return REGION_PRICING[country] || FALLBACK;
}

export function formatPrice(amount: number, symbol: string, locale: string): string {
  if (amount === 0) return 'Free';

  const isDecimal = !Number.isInteger(amount);
  if (isDecimal) {
    return `${symbol}${amount.toFixed(2)}`;
  }
  return `${symbol}${amount.toLocaleString()}`;
}

export const ALL_COUNTRIES = Object.values(REGION_PRICING).map(r => ({
  code: r.country,
  currency: r.currency,
  symbol: r.symbol,
  pppIndex: r.pppIndex,
}));

const PLAN_AMOUNT_KEY: Record<string, 'monthly' | 'yearly'> = {
  pro_monthly: 'monthly',
  pro_yearly: 'yearly',
};

export function getServerPrice(plan: string, currency: string): number | null {
  const field = PLAN_AMOUNT_KEY[plan];
  if (!field) return null;

  for (const pricing of Object.values(REGION_PRICING)) {
    if (pricing.currency === currency) {
      return pricing[field];
    }
  }

  const fallback = REGION_PRICING['IN'];
  return fallback[field];
}

export function validateOrderAmount(plan: string, currency: string, clientAmount: number): boolean {
  const expected = getServerPrice(plan, currency);
  if (expected === null) return false;
  const TOLERANCE = 0.01;
  return Math.abs(clientAmount - expected) <= TOLERANCE;
}
