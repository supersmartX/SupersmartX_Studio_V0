import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

import {
  createUser,
  ensureUserStatsRow,
  atomicIncrementUploadCount,
  atomicTryConsumeMonthlyExport,
  atomicRevertMonthlyExport,
  getMonthlyExportCount,
} from '@/lib/db';
import {
  getEntitlements,
  isPlanActive,
  isCreatorPlan,
  isPlatformLockedForUser,
  clampResolution,
  FREE_RESOLUTION,
} from '@/lib/entitlements';

/**
 * Acceptance (Phase 2/6): the server derives every entitlement from the DB
 * plan. These tests simulate client tampering (forged plan, resolution,
 * duration, platform, quota) and prove the server-side contract rejects or
 * clamps each one. They guard the exact checks performed by
 * presigned-put / complete / export-upload / download / consume-quota.
 */
function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

describe('server-authoritative business logic', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('plan derivation (never trust client plan)', () => {
    it('unknown/forged plan strings fall back to free entitlements', () => {
      // @ts-expect-error — simulates a forged client plan value
      expect(getEntitlements('admin_unlimited')).toEqual(getEntitlements('free'));
      expect(isCreatorPlan('admin_unlimited')).toBe(false);
    });

    it('expired paid plan is treated as inactive (server clock, not client claim)', () => {
      const past = new Date(Date.now() - 1000).toISOString();
      expect(isPlanActive(past, 'creator_monthly')).toBe(false);
      expect(isPlanActive(past, 'pro_yearly')).toBe(false);
    });

    it('paid plan without expiry is inactive (missing data fails closed)', () => {
      expect(isPlanActive(null, 'creator_monthly')).toBe(false);
      expect(isPlanActive(undefined, 'creator_monthly')).toBe(false);
    });

    it('free plan needs no expiry and is always active', () => {
      expect(isPlanActive(null, 'free')).toBe(true);
      expect(isPlanActive(undefined, undefined)).toBe(true);
    });
  });

  describe('resolution tampering (FREE cannot get 1080p)', () => {
    it('clamps forged 1080p request to free 720p ceiling', () => {
      const free = getEntitlements('free');
      // Client claims outputWidth=1920/outputHeight=1080 for a custom export;
      // server clamps via clampResolution before issuing any upload URL.
      const clamped = clampResolution(1920, 1080, free.maxResolution);
      expect(clamped.width).toBeLessThanOrEqual(FREE_RESOLUTION.width);
      expect(clamped.height).toBeLessThanOrEqual(FREE_RESOLUTION.height);
    });

    it('creator keeps full 1080p', () => {
      const creator = getEntitlements('creator_monthly');
      expect(clampResolution(1920, 1080, creator.maxResolution)).toEqual({
        width: 1920,
        height: 1080,
      });
    });
  });

  describe('platform tampering (FREE locked to YouTube 16:9)', () => {
    it('free is locked out of every non-YouTube format', () => {
      const locked: string[] = [];
      for (const p of ['instagram-reels', 'tiktok', 'instagram-post', 'custom'] as const) {
        if (isPlatformLockedForUser(p, 'free')) locked.push(p);
      }
      expect(locked).toHaveLength(4);
      expect(isPlatformLockedForUser('youtube-landscape', 'free')).toBe(false);
    });

    it('creator is locked out of nothing', () => {
      expect(isPlatformLockedForUser('instagram-reels', 'creator_monthly')).toBe(false);
      expect(isPlatformLockedForUser('custom', 'creator_yearly')).toBe(false);
    });
  });

  describe('duration tampering (FREE 600s cap)', () => {
    it('free duration ceiling is finite; creator is unlimited', () => {
      expect(getEntitlements('free').maxDurationSeconds).toBe(600);
      expect(getEntitlements('creator_monthly').maxDurationSeconds).toBeNull();
    });
  });

  describe('quota tampering (atomic server-side counters)', () => {
    it('upload count cap cannot be exceeded by concurrent increments', async () => {
      const user = await createUser('quota@example.com', 'Quota', 'hash');
      await ensureUserStatsRow(user.id);
      // Free: maxUploads=3. Fire 6 concurrent increments of small files.
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          atomicIncrementUploadCount(user.id, 1024, 3, 500 * 1024 * 1024),
        ),
      );
      expect(results.filter((r) => r.allowed).length).toBeLessThanOrEqual(3);
      expect(results.some((r) => !r.allowed)).toBe(true);
    });

    it('storage cap rejects oversized file even when count allows', async () => {
      const user = await createUser('storage@example.com', 'Storage', 'hash');
      await ensureUserStatsRow(user.id);
      const res = await atomicIncrementUploadCount(
        user.id,
        600 * 1024 * 1024, // 600MB > free 500MB
        3,
        500 * 1024 * 1024,
      );
      expect(res.allowed).toBe(false);
    });

    it('monthly export counter enforces limit and supports revert on failure', async () => {
      const user = await createUser('monthly@example.com', 'Monthly', 'hash');
      const limit = 3;
      for (let i = 0; i < limit; i++) {
        const r = await atomicTryConsumeMonthlyExport(user.id, limit);
        expect(r.allowed).toBe(true);
      }
      const over = await atomicTryConsumeMonthlyExport(user.id, limit);
      expect(over.allowed).toBe(false);
      // R2 success + DB failure path reverts so the user is not charged
      await atomicRevertMonthlyExport(user.id);
      expect(await getMonthlyExportCount(user.id)).toBe(limit - 1);
    });
  });
});
