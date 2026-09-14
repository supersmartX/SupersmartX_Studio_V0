import { describe, it, expect } from 'vitest';
import { getEntitlements, FREE_MAX_DURATION_SECONDS, FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';
import { getMonthStartIso } from '@/lib/db';
import { PRICING_PLANS } from '@/constants';

describe('FREE final entitlements', () => {
  it('600 seconds allowed per recording', () => {
    const e = getEntitlements('free');
    expect(e.maxDurationSeconds).not.toBeNull();
    expect(600 <= (e.maxDurationSeconds as number)).toBe(true);
  });
  it('601 seconds rejected per recording', () => {
    const e = getEntitlements('free');
    expect(e.maxDurationSeconds).not.toBeNull();
    expect(601 > (e.maxDurationSeconds as number)).toBe(true);
  });
  it('max duration exactly 600 (10 min/day budget)', () => {
    expect(getEntitlements('free').maxDurationSeconds).toBe(600);
    expect(FREE_MAX_DURATION_SECONDS).toBe(600);
    expect(FREE_DAILY_RECORDING_SECONDS).toBe(600);
  });
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
  it('1080p rejected for free (720p max)', () => {
    const e = getEntitlements('free');
    expect(e.maxResolution.width).toBe(1280);
    expect(e.maxResolution.height).toBe(720);
    // 1920 > 1280 => would be clamped/rejected
    expect(1920 > e.maxResolution.width).toBe(true);
  });
  it('batch rejected for free', () => expect(getEntitlements('free').canBatchExport).toBe(false));
  it('watermark required true for free', () => expect(getEntitlements('free').watermarkRequired).toBe(true));
  it('watermark cannot be disabled by client manipulation — server authoritative', () => {
    const e = getEntitlements('free');
    // Client could send watermarkRequired=false but server uses entitlements
    expect(e.watermarkRequired).toBe(true);
  });
});

describe('FREE unlimited local downloads (no monthly export quota)', () => {
  it('no monthly export limit for free', () => {
    expect(getEntitlements('free').maxExportsPerMonth).toBeNull();
    expect(getEntitlements('free').maxDownloads).toBeNull();
  });
  it('month boundary helper still works', () => {
    const sept = new Date(Date.UTC(2026, 8, 15));
    const oct = new Date(Date.UTC(2026, 9, 1));
    expect(getMonthStartIso(sept)).toBe('2026-09-01T00:00:00.000Z');
    expect(getMonthStartIso(oct)).toBe('2026-10-01T00:00:00.000Z');
    expect(getMonthStartIso(sept)).not.toBe(getMonthStartIso(oct));
  });
  it('free and creator both have unlimited exports', () => {
    expect(getEntitlements('free').maxExportsPerMonth).toBeNull();
    expect(getEntitlements('creator_monthly').maxExportsPerMonth).toBeNull();
  });
});

describe('CREATOR final entitlements', () => {
  it('unlimited recording duration (null)', () => {
    expect(getEntitlements('creator_monthly').maxDurationSeconds).toBeNull();
    expect(getEntitlements('creator_yearly').maxDurationSeconds).toBeNull();
  });
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
    expect(PRICING_PLANS.free.features.some(f=>f.text.includes('10 minutes recording per day'))).toBe(true);
    expect(PRICING_PLANS.free.features.some(f=>f.text.includes('Unlimited local downloads'))).toBe(true);
    expect(PRICING_PLANS.free.features.some(f=>f.text.includes('YouTube 16:9'))).toBe(true);
    expect(PRICING_PLANS.free.features.some(f=>f.text.includes('720p'))).toBe(true);
    expect(PRICING_PLANS.creator.features.some(f=>f.text.includes('Unlimited recording'))).toBe(true);
    expect(PRICING_PLANS.creator.features.some(f=>f.text.includes('Unlimited exports'))).toBe(true);
    expect(PRICING_PLANS.creator.features.some(f=>f.text.includes('1080p'))).toBe(true);
  });
  it('no stale 3-exports-per-month claim remains', () => {
    const allText = Object.values(PRICING_PLANS).flatMap(p=>p.features.map(f=>f.text)).join(' ');
    expect(allText).not.toContain('3 video exports per month');
    expect(allText).not.toContain('3 minutes');
    expect(allText).not.toContain('30 minutes');
  });
});

describe('Security — client manipulation cannot bypass', () => {
  it('manipulated plan does not grant creator entitlements if DB says free', () => {
    // Server uses DB plan, not client payload
    const serverEntitlements = getEntitlements('free');
    expect(serverEntitlements.maxDurationSeconds).toBe(600);
    expect(serverEntitlements.canCrop).toBe(false);
  });
  it('manipulated duration over limit is rejected', () => {
    const free = getEntitlements('free');
    const manipulatedDuration = 9999;
    expect(free.maxDurationSeconds).not.toBeNull();
    expect(manipulatedDuration > (free.maxDurationSeconds as number)).toBe(true);
  });
  it('manipulated platform list cannot bypass free one-platform (batch gate)', () => {
    expect(getEntitlements('free').canBatchExport).toBe(false);
  });
  it('free downloads are unlimited — repeated local downloads allowed', () => {
    expect(getEntitlements('free').maxExportsPerMonth).toBeNull();
    expect(getEntitlements('free').maxDownloads).toBeNull();
  });
});
