import { NextRequest, NextResponse } from 'next/server';
import { getDisplayPricingForCountry, getTrustedPaddleCountry } from '@/lib/billing/paddle';

export const dynamic = 'force-dynamic';

/**
 * Canonical, unauthenticated display pricing for the landing page and the
 * checkout sheet. The amount comes from the same configuration the server
 * quote uses, so a visitor is never advertised one currency/amount and charged
 * another.
 */
export async function GET(request: NextRequest) {
  const country = getTrustedPaddleCountry(request.headers);
  const pricing = getDisplayPricingForCountry(country);
  if (!pricing) {
    return NextResponse.json(
      { error: 'Pricing is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    { country, ...pricing },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
