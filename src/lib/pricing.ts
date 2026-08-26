export interface RegionalPricing {
  country: string;
  currency: string;
  symbol: string;
  locale: string;
  creatorMonthly: number;
  creatorYearly: number;
  proMonthly: number;
  proYearly: number;
  pppIndex: number;
}

const REGION_PRICING: Record<string, RegionalPricing> = {
  US: { country: 'US', currency: 'USD', symbol: '$', locale: 'en-US', creatorMonthly: 7.99, creatorYearly: 59.99, proMonthly: 14.99, proYearly: 119.99, pppIndex: 152 },
  CH: { country: 'CH', currency: 'CHF', symbol: 'CHF', locale: 'de-CH', creatorMonthly: 8.99, creatorYearly: 69.99, proMonthly: 16.99, proYearly: 139.99, pppIndex: 176 },
  LU: { country: 'LU', currency: 'EUR', symbol: '€', locale: 'lb-LU', creatorMonthly: 8.99, creatorYearly: 69.99, proMonthly: 16.99, proYearly: 139.99, pppIndex: 167 },
  QA: { country: 'QA', currency: 'QAR', symbol: 'QR', locale: 'en-QA', creatorMonthly: 29.99, creatorYearly: 239.99, proMonthly: 56.99, proYearly: 479.99, pppIndex: 160 },
  OM: { country: 'OM', currency: 'OMR', symbol: 'OMR', locale: 'ar-OM', creatorMonthly: 3.49, creatorYearly: 25.99, proMonthly: 6.49, proYearly: 51.99, pppIndex: 156 },
  KW: { country: 'KW', currency: 'KWD', symbol: 'KD', locale: 'ar-KW', creatorMonthly: 2.49, creatorYearly: 18.99, proMonthly: 4.49, proYearly: 37.99, pppIndex: 183 },
  DK: { country: 'DK', currency: 'DKK', symbol: 'kr', locale: 'da-DK', creatorMonthly: 54.99, creatorYearly: 429.99, proMonthly: 99.99, proYearly: 859.99, pppIndex: 151 },
  NO: { country: 'NO', currency: 'NOK', symbol: 'kr', locale: 'nb-NO', creatorMonthly: 54.99, creatorYearly: 429.99, proMonthly: 99.99, proYearly: 859.99, pppIndex: 128 },
  SG: { country: 'SG', currency: 'SGD', symbol: 'S$', locale: 'en-SG', creatorMonthly: 10.99, creatorYearly: 84.99, proMonthly: 19.99, proYearly: 169.99, pppIndex: 133 },
  AU: { country: 'AU', currency: 'AUD', symbol: 'A$', locale: 'en-AU', creatorMonthly: 10.99, creatorYearly: 84.99, proMonthly: 19.99, proYearly: 169.99, pppIndex: 142 },
  NZ: { country: 'NZ', currency: 'NZD', symbol: 'NZ$', locale: 'en-NZ', creatorMonthly: 11.99, creatorYearly: 89.99, proMonthly: 21.99, proYearly: 179.99, pppIndex: 128 },
  DE: { country: 'DE', currency: 'EUR', symbol: '€', locale: 'de-DE', creatorMonthly: 7.49, creatorYearly: 54.99, proMonthly: 13.99, proYearly: 109.99, pppIndex: 142 },
  NL: { country: 'NL', currency: 'EUR', symbol: '€', locale: 'nl-NL', creatorMonthly: 7.49, creatorYearly: 54.99, proMonthly: 13.99, proYearly: 109.99, pppIndex: 137 },
  SE: { country: 'SE', currency: 'SEK', symbol: 'kr', locale: 'sv-SE', creatorMonthly: 79.99, creatorYearly: 599.99, proMonthly: 149.99, proYearly: 1199.99, pppIndex: 137 },
  AT: { country: 'AT', currency: 'EUR', symbol: '€', locale: 'de-AT', creatorMonthly: 6.99, creatorYearly: 54.99, proMonthly: 12.99, proYearly: 109.99, pppIndex: 110 },
  FI: { country: 'FI', currency: 'EUR', symbol: '€', locale: 'fi-FI', creatorMonthly: 7.49, creatorYearly: 54.99, proMonthly: 13.99, proYearly: 109.99, pppIndex: 133 },
  BE: { country: 'BE', currency: 'EUR', symbol: '€', locale: 'nl-BE', creatorMonthly: 7.49, creatorYearly: 54.99, proMonthly: 13.99, proYearly: 109.99, pppIndex: 128 },
  IE: { country: 'IE', currency: 'EUR', symbol: '€', locale: 'en-IE', creatorMonthly: 6.99, creatorYearly: 54.99, proMonthly: 12.99, proYearly: 109.99, pppIndex: 113 },
  AE: { country: 'AE', currency: 'AED', symbol: 'AED', locale: 'en-AE', creatorMonthly: 29.99, creatorYearly: 239.99, proMonthly: 56.99, proYearly: 479.99, pppIndex: 132 },
  SA: { country: 'SA', currency: 'SAR', symbol: 'SAR', locale: 'ar-SA', creatorMonthly: 29.99, creatorYearly: 239.99, proMonthly: 56.99, proYearly: 479.99, pppIndex: 136 },
  GB: { country: 'GB', currency: 'GBP', symbol: '£', locale: 'en-GB', creatorMonthly: 6.49, creatorYearly: 49.99, proMonthly: 11.99, proYearly: 99.99, pppIndex: 124 },
  FR: { country: 'FR', currency: 'EUR', symbol: '€', locale: 'fr-FR', creatorMonthly: 7.49, creatorYearly: 54.99, proMonthly: 13.99, proYearly: 109.99, pppIndex: 113 },
  JP: { country: 'JP', currency: 'JPY', symbol: '¥', locale: 'ja-JP', creatorMonthly: 1199, creatorYearly: 8990, proMonthly: 2299, proYearly: 17990, pppIndex: 123 },
  IT: { country: 'IT', currency: 'EUR', symbol: '€', locale: 'it-IT', creatorMonthly: 6.49, creatorYearly: 49.99, proMonthly: 11.99, proYearly: 99.99, pppIndex: 101 },
  ES: { country: 'ES', currency: 'EUR', symbol: '€', locale: 'es-ES', creatorMonthly: 6.49, creatorYearly: 49.99, proMonthly: 11.99, proYearly: 99.99, pppIndex: 101 },
  KR: { country: 'KR', currency: 'KRW', symbol: '₩', locale: 'ko-KR', creatorMonthly: 8490, creatorYearly: 64900, proMonthly: 15990, proYearly: 129900, pppIndex: 100 },
  CZ: { country: 'CZ', currency: 'CZK', symbol: 'Kč', locale: 'cs-CZ', creatorMonthly: 169.99, creatorYearly: 1299.99, proMonthly: 319.99, proYearly: 2599.99, pppIndex: 91 },
  PT: { country: 'PT', currency: 'EUR', symbol: '€', locale: 'pt-PT', creatorMonthly: 5.99, creatorYearly: 44.99, proMonthly: 10.99, proYearly: 89.99, pppIndex: 62 },
  EE: { country: 'EE', currency: 'EUR', symbol: '€', locale: 'et-EE', creatorMonthly: 5.99, creatorYearly: 44.99, proMonthly: 10.99, proYearly: 89.99, pppIndex: 86 },
  SI: { country: 'SI', currency: 'EUR', symbol: '€', locale: 'sl-SI', creatorMonthly: 5.99, creatorYearly: 44.99, proMonthly: 10.99, proYearly: 89.99, pppIndex: 86 },
  LT: { country: 'LT', currency: 'EUR', symbol: '€', locale: 'lt-LT', creatorMonthly: 5.99, creatorYearly: 44.99, proMonthly: 10.99, proYearly: 89.99, pppIndex: 82 },
  HR: { country: 'HR', currency: 'EUR', symbol: '€', locale: 'hr-HR', creatorMonthly: 5.99, creatorYearly: 44.99, proMonthly: 10.99, proYearly: 89.99, pppIndex: 81 },
  MY: { country: 'MY', currency: 'MYR', symbol: 'RM', locale: 'ms-MY', creatorMonthly: 24.99, creatorYearly: 189.99, proMonthly: 46.99, proYearly: 379.99, pppIndex: 65 },
  TH: { country: 'TH', currency: 'THB', symbol: '฿', locale: 'th-TH', creatorMonthly: 219, creatorYearly: 1690, proMonthly: 409, proYearly: 3390, pppIndex: 55 },
  CN: { country: 'CN', currency: 'CNY', symbol: '¥', locale: 'zh-CN', creatorMonthly: 44.99, creatorYearly: 329.99, proMonthly: 84.99, proYearly: 659.99, pppIndex: 80 },
  TR: { country: 'TR', currency: 'TRY', symbol: '₺', locale: 'tr-TR', creatorMonthly: 249.99, creatorYearly: 1899.99, proMonthly: 469.99, proYearly: 3799.99, pppIndex: 40 },
  MX: { country: 'MX', currency: 'MXN', symbol: 'MX$', locale: 'es-MX', creatorMonthly: 109.99, creatorYearly: 849.99, proMonthly: 204.99, proYearly: 1699.99, pppIndex: 45 },
  PH: { country: 'PH', currency: 'PHP', symbol: '₱', locale: 'en-PH', creatorMonthly: 299, creatorYearly: 2290, proMonthly: 559, proYearly: 4590, pppIndex: 35 },
  CO: { country: 'CO', currency: 'COP', symbol: 'COL$', locale: 'es-CO', creatorMonthly: 24999, creatorYearly: 189990, proMonthly: 46999, proYearly: 379990, pppIndex: 35 },
  ZA: { country: 'ZA', currency: 'ZAR', symbol: 'R', locale: 'en-ZA', creatorMonthly: 119.99, creatorYearly: 899.99, proMonthly: 224.99, proYearly: 1799.99, pppIndex: 45 },
  ID: { country: 'ID', currency: 'IDR', symbol: 'Rp', locale: 'id-ID', creatorMonthly: 79900, creatorYearly: 649000, proMonthly: 149900, proYearly: 1299000, pppIndex: 35 },
  BR: { country: 'BR', currency: 'BRL', symbol: 'R$', locale: 'pt-BR', creatorMonthly: 24.99, creatorYearly: 189.99, proMonthly: 46.99, proYearly: 379.99, pppIndex: 38 },
  IN: { country: 'IN', currency: 'INR', symbol: '₹', locale: 'en-IN', creatorMonthly: 349, creatorYearly: 2490, proMonthly: 649, proYearly: 4990, pppIndex: 25 },
  EG: { country: 'EG', currency: 'EGP', symbol: 'E£', locale: 'ar-EG', creatorMonthly: 169.99, creatorYearly: 1299.99, proMonthly: 319.99, proYearly: 2599.99, pppIndex: 22 },
  PK: { country: 'PK', currency: 'PKR', symbol: '₨', locale: 'en-PK', creatorMonthly: 849, creatorYearly: 6490, proMonthly: 1599, proYearly: 12990, pppIndex: 18 },
  BD: { country: 'BD', currency: 'BDT', symbol: '৳', locale: 'bn-BD', creatorMonthly: 599, creatorYearly: 4490, proMonthly: 1099, proYearly: 8990, pppIndex: 22 },
  VN: { country: 'VN', currency: 'VND', symbol: '₫', locale: 'vi-VN', creatorMonthly: 129000, creatorYearly: 999000, proMonthly: 249000, proYearly: 1999000, pppIndex: 32 },
  GH: { country: 'GH', currency: 'GHS', symbol: 'GH₵', locale: 'en-GH', creatorMonthly: 64.99, creatorYearly: 499.99, proMonthly: 119.99, proYearly: 999.99, pppIndex: 20 },
  KE: { country: 'KE', currency: 'KES', symbol: 'KSh', locale: 'en-KE', creatorMonthly: 849, creatorYearly: 6490, proMonthly: 1599, proYearly: 12990, pppIndex: 22 },
  NG: { country: 'NG', currency: 'NGN', symbol: '₦', locale: 'en-NG', creatorMonthly: 2499, creatorYearly: 18990, proMonthly: 4699, proYearly: 37990, pppIndex: 9 },
  TZ: { country: 'TZ', currency: 'TZS', symbol: 'TSh', locale: 'sw-TZ', creatorMonthly: 16999, creatorYearly: 129990, proMonthly: 31999, proYearly: 259990, pppIndex: 12 },
  UG: { country: 'UG', currency: 'UGX', symbol: 'USh', locale: 'en-UG', creatorMonthly: 24999, creatorYearly: 189990, proMonthly: 46999, proYearly: 379990, pppIndex: 12 },
  ET: { country: 'ET', currency: 'ETB', symbol: 'Br', locale: 'am-ET', creatorMonthly: 849, creatorYearly: 6490, proMonthly: 1599, proYearly: 12990, pppIndex: 12 },
  MM: { country: 'MM', currency: 'MMK', symbol: 'K', locale: 'my-MM', creatorMonthly: 11999, creatorYearly: 89990, proMonthly: 22999, proYearly: 179990, pppIndex: 15 },
  NP: { country: 'NP', currency: 'NPR', symbol: 'Rs', locale: 'ne-NP', creatorMonthly: 849, creatorYearly: 6490, proMonthly: 1599, proYearly: 12990, pppIndex: 18 },
  LK: { country: 'LK', currency: 'LKR', symbol: 'Rs', locale: 'si-LK', creatorMonthly: 1699, creatorYearly: 12990, proMonthly: 3199, proYearly: 25990, pppIndex: 20 },
  UA: { country: 'UA', currency: 'UAH', symbol: '₴', locale: 'uk-UA', creatorMonthly: 279.99, creatorYearly: 2199.99, proMonthly: 529.99, proYearly: 4399.99, pppIndex: 25 },
  RO: { country: 'RO', currency: 'RON', symbol: 'lei', locale: 'ro-RO', creatorMonthly: 34.99, creatorYearly: 259.99, proMonthly: 64.99, proYearly: 519.99, pppIndex: 50 },
  PL: { country: 'PL', currency: 'PLN', symbol: 'zł', locale: 'pl-PL', creatorMonthly: 29.99, creatorYearly: 229.99, proMonthly: 56.99, proYearly: 459.99, pppIndex: 60 },
  HU: { country: 'HU', currency: 'HUF', symbol: 'Ft', locale: 'hu-HU', creatorMonthly: 2699, creatorYearly: 19990, proMonthly: 5099, proYearly: 39990, pppIndex: 45 },
  AR: { country: 'AR', currency: 'ARS', symbol: 'AR$', locale: 'es-AR', creatorMonthly: 7999, creatorYearly: 64990, proMonthly: 14999, proYearly: 129990, pppIndex: 30 },
  CL: { country: 'CL', currency: 'CLP', symbol: 'CL$', locale: 'es-CL', creatorMonthly: 6499, creatorYearly: 49990, proMonthly: 12199, proYearly: 99990, pppIndex: 38 },
  PE: { country: 'PE', currency: 'PEN', symbol: 'S/', locale: 'es-PE', creatorMonthly: 29.99, creatorYearly: 229.99, proMonthly: 56.99, proYearly: 459.99, pppIndex: 40 },
};

const FALLBACK: RegionalPricing = REGION_PRICING['IN'];

const STORAGE_KEY = 'sxs-pricing-region';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

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

const PLAN_AMOUNT_KEY: Record<string, 'creatorMonthly' | 'creatorYearly' | 'proMonthly' | 'proYearly'> = {
  creator_monthly: 'creatorMonthly',
  creator_yearly: 'creatorYearly',
  pro_monthly: 'proMonthly',
  pro_yearly: 'proYearly',
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
