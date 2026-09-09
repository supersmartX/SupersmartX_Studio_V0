import { describe, it, expect } from 'vitest';
import { getEntitlements, isPlanActive, clampResolution } from '@/lib/entitlements';
import type { PlanType } from '@/types/db';

describe('getEntitlements', () => {
  it('returns free entitlements for free plan', () => {
    const e = getEntitlements('free');
    expect(e.canExport).toBe(false);
    expect(e.canDownload).toBe(false);
    expect(e.canBatchExport).toBe(false);
    expect(e.maxResolution).toEqual({ width: 1920, height: 1080 });
    expect(e.maxDurationSeconds).toBe(300);
    expect(e.maxDownloads).toBe(3);
    expect(e.maxUploads).toBe(3);
    expect(e.maxStorageMB).toBe(500);
    expect(e.watermarkRequired).toBe(true);
  });

  it('returns creator entitlements for creator_monthly', () => {
    const e = getEntitlements('creator_monthly');
    expect(e.canExport).toBe(true);
    expect(e.canDownload).toBe(true);
    expect(e.canBatchExport).toBe(false);
    expect(e.maxResolution).toEqual({ width: 1920, height: 1080 });
    expect(e.maxDurationSeconds).toBe(Infinity);
    expect(e.maxDownloads).toBeNull();
    expect(e.maxUploads).toBeNull();
    expect(e.maxStorageMB).toBeNull();
    expect(e.watermarkRequired).toBe(false);
  });

  it('returns creator entitlements for creator_yearly', () => {
    const e = getEntitlements('creator_yearly');
    expect(e.canExport).toBe(true);
    expect(e.canBatchExport).toBe(false);
  });

  it('returns pro entitlements for pro_monthly', () => {
    const e = getEntitlements('pro_monthly');
    expect(e.canExport).toBe(true);
    expect(e.canDownload).toBe(true);
    expect(e.canBatchExport).toBe(true);
    expect(e.maxResolution).toEqual({ width: 3840, height: 2160 });
    expect(e.maxDurationSeconds).toBe(Infinity);
    expect(e.maxDownloads).toBeNull();
    expect(e.watermarkRequired).toBe(false);
  });

  it('returns pro entitlements for pro_yearly', () => {
    const e = getEntitlements('pro_yearly');
    expect(e.canBatchExport).toBe(true);
    expect(e.maxResolution).toEqual({ width: 3840, height: 2160 });
  });

  it('falls back to free for unknown plan', () => {
    const e = getEntitlements('unknown' as never);
    expect(e.canExport).toBe(false);
    expect(e.canDownload).toBe(false);
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

  it('paid plan with current time is inactive (edge case)', () => {
    const now = new Date().toISOString();
    expect(isPlanActive(now, 'pro_monthly')).toBe(false);
  });

  it('no plan argument defaults to free behavior', () => {
    expect(isPlanActive(null)).toBe(true);
    expect(isPlanActive(undefined)).toBe(true);
  });
});

describe('clampResolution', () => {
  it('returns original if within limits', () => {
    const result = clampResolution(1920, 1080, { width: 1920, height: 1080 });
    expect(result).toEqual({ width: 1920, height: 1080 });
  });

  it('returns original if smaller than limits', () => {
    const result = clampResolution(1280, 720, { width: 1920, height: 1080 });
    expect(result).toEqual({ width: 1280, height: 720 });
  });

  it('scales down 4K to 1080p', () => {
    const result = clampResolution(3840, 2160, { width: 1920, height: 1080 });
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1080);
  });

  it('preserves aspect ratio when scaling', () => {
    const result = clampResolution(3840, 2160, { width: 1920, height: 1080 });
    const originalRatio = 3840 / 2160;
    const resultRatio = result.width / result.height;
    expect(Math.abs(originalRatio - resultRatio)).toBeLessThan(0.01);
  });

  it('handles non-standard aspect ratios', () => {
    const result = clampResolution(2560, 1440, { width: 1920, height: 1080 });
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1080);
  });

  it('handles portrait orientation', () => {
    const result = clampResolution(1080, 1920, { width: 1080, height: 1920 });
    expect(result).toEqual({ width: 1080, height: 1920 });
  });

  it('clamps portrait when max is landscape', () => {
    const result = clampResolution(1080, 1920, { width: 1920, height: 1080 });
    expect(result.width).toBeLessThanOrEqual(1920);
    expect(result.height).toBeLessThanOrEqual(1080);
  });
});

describe('Plan entitlements matrix', () => {
  const plans: PlanType[] = ['free', 'creator_monthly', 'creator_yearly', 'pro_monthly', 'pro_yearly'];

  it('all plans have valid structure', () => {
    for (const plan of plans) {
      const e = getEntitlements(plan);
      expect(typeof e.canExport).toBe('boolean');
      expect(typeof e.canDownload).toBe('boolean');
      expect(typeof e.canBatchExport).toBe('boolean');
      expect(e.maxResolution).toHaveProperty('width');
      expect(e.maxResolution).toHaveProperty('height');
      expect(typeof e.maxDurationSeconds).toBe('number');
      expect(typeof e.watermarkRequired).toBe('boolean');
    }
  });

  it('free plan cannot export or download', () => {
    const e = getEntitlements('free');
    expect(e.canExport).toBe(false);
    expect(e.canDownload).toBe(false);
  });

  it('creator plans can export and download but not batch', () => {
    for (const plan of ['creator_monthly', 'creator_yearly'] as PlanType[]) {
      const e = getEntitlements(plan);
      expect(e.canExport).toBe(true);
      expect(e.canDownload).toBe(true);
      expect(e.canBatchExport).toBe(false);
    }
  });

  it('pro plans can batch export', () => {
    for (const plan of ['pro_monthly', 'pro_yearly'] as PlanType[]) {
      const e = getEntitlements(plan);
      expect(e.canBatchExport).toBe(true);
    }
  });

  it('pro has higher max resolution than creator', () => {
    const creator = getEntitlements('creator_monthly');
    const pro = getEntitlements('pro_monthly');
    expect(pro.maxResolution.width).toBeGreaterThan(creator.maxResolution.width);
    expect(pro.maxResolution.height).toBeGreaterThan(creator.maxResolution.height);
  });

  it('free has limited downloads', () => {
    const e = getEntitlements('free');
    expect(e.maxDownloads).not.toBeNull();
    expect(e.maxDownloads).toBeGreaterThan(0);
  });

  it('paid plans have unlimited downloads', () => {
    for (const plan of ['creator_monthly', 'creator_yearly', 'pro_monthly', 'pro_yearly'] as PlanType[]) {
      const e = getEntitlements(plan);
      expect(e.maxDownloads).toBeNull();
    }
  });
});
