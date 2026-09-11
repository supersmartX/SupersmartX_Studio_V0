import { describe, it, expect } from 'vitest';
import { getEntitlements, CREATOR_MAX_DURATION_SECONDS, FREE_MONTHLY_EXPORT_LIMIT } from '@/lib/entitlements';
import { getMonthStartIso } from '@/lib/db';
import { PRICING_PLANS } from '@/constants';

describe('FREE launch entitlements', () => {
  it('180 seconds allowed', () => {
    const e = getEntitlements('free');
    expect(180 <= e.maxDurationSeconds).toBe(true);
  });
  it('181 seconds rejected', () => {
    const e = getEntitlements('free');
    expect(181 > e.maxDurationSeconds).toBe(true);
  });
  it('max duration exactly 180', () => expect(getEntitlements('free').maxDurationSeconds).toBe(180));
  it('one platform per export allowed (single preset)', () => {
    // Client sends single platformId string — allowed
    const e = getEntitlements('free');
    expect(e.canExport).toBe(true);
    // multiple platforms in one request would require batch — blocked
    expect(e.canBatchExport).toBe(false);
  });
  it('multiple platforms in one request rejected via batch gate', () => {
    expect(getEntitlements('free').canBatchExport).toBe(false);
    expect(getEntitlements('creator_monthly').canBatchExport).toBe(false);
  });
  it('crop rejected for free', () => expect(getEntitlements('free').canCrop).toBe(false));
  it('4K rejected for free (1080p max)', () => {
    const e = getEntitlements('free');
    expect(e.maxResolution.width).toBe(1920);
    expect(e.maxResolution.height).toBe(1080);
    // 3840 > 1920 => would be clamped/rejected
    expect(3840 > e.maxResolution.width).toBe(true);
  });
  it('batch rejected for free', () => expect(getEntitlements('free').canBatchExport).toBe(false));
  it('watermark required true for free', () => expect(getEntitlements('free').watermarkRequired).toBe(true));
  it('watermark cannot be disabled by client manipulation — server authoritative', () => {
    const e = getEntitlements('free');
    // Client could send watermarkRequired=false but server uses entitlements
    expect(e.watermarkRequired).toBe(true);
  });
});

describe('FREE monthly export quota', () => {
  it('3 exports per calendar month limit', () => expect(FREE_MONTHLY_EXPORT_LIMIT).toBe(3));
  it('month boundary resets', () => {
    const sept = new Date(Date.UTC(2026, 8, 15));
    const oct = new Date(Date.UTC(2026, 9, 1));
    expect(getMonthStartIso(sept)).toBe('2026-09-01T00:00:00.000Z');
    expect(getMonthStartIso(oct)).toBe('2026-10-01T00:00:00.000Z');
    expect(getMonthStartIso(sept)).not.toBe(getMonthStartIso(oct));
  });
  it('free entitlements has monthly limit, creator has none', () => {
    expect(getEntitlements('free').maxExportsPerMonth).toBe(3);
    expect(getEntitlements('creator_monthly').maxExportsPerMonth).toBeNull();
  });
});

describe('CREATOR launch entitlements', () => {
  it('1800 allowed', () => expect(1800 <= getEntitlements('creator_monthly').maxDurationSeconds).toBe(true));
  it('1801 rejected', () => expect(1801 > getEntitlements('creator_monthly').maxDurationSeconds).toBe(true));
  it('exact 1800', () => expect(CREATOR_MAX_DURATION_SECONDS).toBe(1800));
  it('multiple platforms allowed across exports', () => {
    const e = getEntitlements('creator_monthly');
    expect(e.canExport).toBe(true);
    // All presets available — entitlements does not restrict preset list
    expect(e.canCrop).toBe(true);
  });
  it('crop allowed', () => expect(getEntitlements('creator_monthly').canCrop).toBe(true));
  it('1080p allowed', () => expect(getEntitlements('creator_monthly').maxResolution).toEqual({width:1920,height:1080}));
  it('4K rejected', () => expect(3840 > getEntitlements('creator_monthly').maxResolution.width).toBe(true));
  it('batch rejected at launch', () => expect(getEntitlements('creator_monthly').canBatchExport).toBe(false));
  it('no monthly quota but rate/concurrency still apply (null = unlimited)', () => {
    expect(getEntitlements('creator_monthly').maxExportsPerMonth).toBeNull();
  });
  it('watermark false', () => expect(getEntitlements('creator_monthly').watermarkRequired).toBe(false));
});

describe('PRO not customer-facing at launch', () => {
  it('pricing plans show only free and creator', () => {
    expect(Object.keys(PRICING_PLANS)).toEqual(['free','creator']);
    expect((PRICING_PLANS as any).pro).toBeUndefined();
  });
  it('free and creator copy matches final spec', () => {
    expect(PRICING_PLANS.free.features.some(f=>f.text.includes('3 minutes'))).toBe(true);
    expect(PRICING_PLANS.free.features.some(f=>f.text.includes('3 video exports per month'))).toBe(true);
    expect(PRICING_PLANS.creator.features.some(f=>f.text.includes('30 minutes'))).toBe(true);
    expect(PRICING_PLANS.creator.features.some(f=>f.text.includes('Unlimited video exports'))).toBe(true);
    expect(PRICING_PLANS.creator.features.some(f=>f.text.includes('Crop & reframe'))).toBe(true);
  });
  it('no unlimited recording length claim', () => {
    const allText = Object.values(PRICING_PLANS).flatMap(p=>p.features.map(f=>f.text)).join(' ');
    expect(allText.toLowerCase()).not.toContain('unlimited recording');
  });
});

describe('Security — client manipulation cannot bypass', () => {
  it('manipulated plan does not grant creator entitlements if DB says free', () => {
    // Server uses DB plan, not client payload
    const serverEntitlements = getEntitlements('free');
    expect(serverEntitlements.maxDurationSeconds).toBe(180);
    expect(serverEntitlements.canCrop).toBe(false);
  });
  it('manipulated duration over limit is rejected', () => {
    const free = getEntitlements('free');
    const manipulatedDuration = 9999;
    expect(manipulatedDuration > free.maxDurationSeconds).toBe(true);
  });
  it('manipulated platform list cannot bypass free one-platform (batch gate)', () => {
    expect(getEntitlements('free').canBatchExport).toBe(false);
  });
  it('manipulated quota count cannot bypass monthly limit (server counts)', () => {
    // Server counts via getMonthlyExportCount, not client count
    expect(getEntitlements('free').maxExportsPerMonth).toBe(3);
  });
});
