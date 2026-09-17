import { describe, it, expect } from 'vitest';
import { getEntitlements, isPlanActive, clampResolution, FREE_MAX_DURATION_SECONDS, FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';
import type { PlanType } from '@/types/db';

describe('getEntitlements', () => {
  it('returns free entitlements for free plan', () => {
    const e = getEntitlements('free');
    expect(e.canExport).toBe(true);
    expect(e.canDownload).toBe(true);
    expect(e.canBatchExport).toBe(false);
    expect(e.canCrop).toBe(false);
    expect(e.maxResolution).toEqual({ width: 1280, height: 720 });
    expect(e.maxDurationSeconds).toBe(600);
    expect(e.maxExportsPerMonth).toBeNull();
    expect(e.maxUploads).toBe(3);
    expect(e.maxStorageMB).toBe(500);
    expect(e.watermarkRequired).toBe(true);
  });

  it('returns creator entitlements for creator_monthly', () => {
    const e = getEntitlements('creator_monthly');
    expect(e.canExport).toBe(true);
    expect(e.canDownload).toBe(true);
    expect(e.canBatchExport).toBe(false);
    expect(e.canCrop).toBe(true);
    expect(e.maxResolution).toEqual({ width: 1920, height: 1080 });
    expect(e.maxDurationSeconds).toBeNull();
    expect(e.maxExportsPerMonth).toBeNull();
    expect(e.maxUploads).toBeNull();
    expect(e.maxStorageMB).toBeNull();
    expect(e.watermarkRequired).toBe(false);
  });

  it('returns creator entitlements for creator_yearly', () => {
    const e = getEntitlements('creator_yearly');
    expect(e.canExport).toBe(true);
    expect(e.canBatchExport).toBe(false);
    expect(e.canCrop).toBe(true);
    expect(e.maxDurationSeconds).toBeNull();
    expect(e.maxExportsPerMonth).toBeNull();
  });

  it('pro retained internally but not customer-facing', () => {
    const e = getEntitlements('pro_monthly');
    expect(e.canBatchExport).toBe(false);
    expect(e.canCrop).toBe(true);
    expect(e.maxResolution).toEqual({ width: 1920, height: 1080 });
  });

  it('falls back to free for unknown plan', () => {
    const e = getEntitlements('unknown' as never);
    expect(e.canCrop).toBe(false);
    expect(e.maxDurationSeconds).toBe(600);
  });

  it('final contract constants match spec', () => {
    expect(FREE_MAX_DURATION_SECONDS).toBe(600);
    expect(FREE_DAILY_RECORDING_SECONDS).toBe(600);
  });
});

describe('isPlanActive', () => {
  it('free plan is always active regardless of expiry', () => {
    expect(isPlanActive(undefined, 'free')).toBe(true);
    expect(isPlanActive(null, 'free')).toBe(true);
    expect(isPlanActive(undefined)).toBe(true);
    expect(isPlanActive(null)).toBe(true);
  });

  it('paid plan with null expiry is inactive', () => {
    expect(isPlanActive(null, 'pro_monthly')).toBe(false);
    expect(isPlanActive(undefined, 'creator_yearly')).toBe(false);
  });

  it('paid plan with future date is active', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(isPlanActive(future, 'pro_monthly')).toBe(true);
    expect(isPlanActive(future, 'creator_monthly')).toBe(true);
  });

  it('paid plan with past date is inactive', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    expect(isPlanActive(past, 'pro_monthly')).toBe(false);
    expect(isPlanActive(past, 'creator_yearly')).toBe(false);
  });
});

describe('clampResolution', () => {
  it('returns original if within limits', () => {
    const result = clampResolution(1920, 1080, { width: 1920, height: 1080 });
    expect(result).toEqual({ width: 1920, height: 1080 });
  });
  it('scales down 4K to 1080p for launch', () => {
    const result = clampResolution(3840, 2160, { width: 1920, height: 1080 });
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1080);
  });
  it('preserves aspect ratio', () => {
    const result = clampResolution(3840, 2160, { width: 1920, height: 1080 });
    expect(Math.abs(3840/2160 - result.width/result.height)).toBeLessThan(0.01);
  });
  it('clamps 1080p preset to 720p for free default format', () => {
    const free = getEntitlements('free');
    const result = clampResolution(1920, 1080, free.maxResolution);
    expect(result).toEqual({ width: 1280, height: 720 });
  });
  it('keeps 1080p for creator', () => {
    const creator = getEntitlements('creator_monthly');
    const result = clampResolution(1920, 1080, creator.maxResolution);
    expect(result).toEqual({ width: 1920, height: 1080 });
  });
});

describe('Final entitlement matrix', () => {
  it('free can export unlimited local downloads, no crop', () => {
    const e = getEntitlements('free');
    expect(e.canExport).toBe(true);
    expect(e.canDownload).toBe(true);
    expect(e.canCrop).toBe(false);
    expect(e.maxExportsPerMonth).toBeNull();
    expect(e.maxDownloads).toBeNull();
  });
  it('creator can export unlimited, can crop', () => {
    for (const plan of ['creator_monthly','creator_yearly'] as PlanType[]) {
      const e = getEntitlements(plan);
      expect(e.maxExportsPerMonth).toBeNull();
      expect(e.canCrop).toBe(true);
    }
  });
  it('free is 720p, creator is 1080p, no 4K for customer plans', () => {
    expect(getEntitlements('free').maxResolution).toEqual({width:1280,height:720});
    expect(getEntitlements('creator_monthly').maxResolution).toEqual({width:1920,height:1080});
  });
  it('batch export disabled for launch plans', () => {
    expect(getEntitlements('free').canBatchExport).toBe(false);
    expect(getEntitlements('creator_monthly').canBatchExport).toBe(false);
  });
  it('duration limits exact (free 10 min/day cap, creator unlimited)', () => {
    expect(getEntitlements('free').maxDurationSeconds).toBe(600);
    expect(getEntitlements('creator_monthly').maxDurationSeconds).toBeNull();
  });
  it('watermark required only for free', () => {
    expect(getEntitlements('free').watermarkRequired).toBe(true);
    expect(getEntitlements('creator_monthly').watermarkRequired).toBe(false);
  });
});
