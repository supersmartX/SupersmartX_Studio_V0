import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

import {
  createUser,
  getDailyRecordedSeconds,
  atomicTryConsumeRecordingSeconds,
  atomicRevertRecordingSeconds,
} from '@/lib/db';
import {
  getDailyRecordingAllowanceSeconds,
  computeRecordingChargeSeconds,
  sanitizeClaimedDuration,
  FREE_DAILY_RECORDING_SECONDS,
} from '@/lib/entitlements';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

let n = 0;
const email = () => `budget-${++n}-${Date.now()}@example.com`;

/**
 * BUS-001 helper-level proof: the server ledger (not localStorage, not the
 * request body) decides the daily recording budget. localStorage is never
 * read here — by construction the DB row is the only authority.
 */
describe('server-side daily recording ledger', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('allowance derivation (no duplicated entitlement logic)', () => {
    it('free gets the 600s daily budget; creator is unlimited', () => {
      expect(getDailyRecordingAllowanceSeconds('free')).toBe(FREE_DAILY_RECORDING_SECONDS);
      expect(getDailyRecordingAllowanceSeconds(null)).toBe(FREE_DAILY_RECORDING_SECONDS);
      expect(getDailyRecordingAllowanceSeconds('creator_monthly')).toBeNull();
      expect(getDailyRecordingAllowanceSeconds('creator_yearly')).toBeNull();
    });

    it('unknown plans fail closed to the free budget', () => {
      expect(getDailyRecordingAllowanceSeconds('admin_unlimited')).toBe(FREE_DAILY_RECORDING_SECONDS);
    });
  });

  describe('charge computation (claim vs verified-byte floor)', () => {
    const FLOOR_150MB = (150 * 1024 * 1024) / (12_000_000 / 8); // = 100.8s

    it('honest claim above the floor is charged as-claimed', () => {
      expect(computeRecordingChargeSeconds(300, 150 * 1024 * 1024)).toBe(300);
    });

    it('short claim is lifted to the byte floor', () => {
      expect(computeRecordingChargeSeconds(10, 150 * 1024 * 1024)).toBeCloseTo(FLOOR_150MB, 6);
    });

    it('zero / negative / NaN / missing claims still charge the floor', () => {
      for (const bad of [0, -50, NaN, Infinity, undefined, 'garbage']) {
        expect(computeRecordingChargeSeconds(bad, 150 * 1024 * 1024)).toBeCloseTo(FLOOR_150MB, 6);
      }
      expect(sanitizeClaimedDuration(-5)).toBe(0);
      expect(sanitizeClaimedDuration('not-a-number')).toBe(0);
    });

    it('unknown byte size falls back to the (sanitized) claim — documented limit', () => {
      expect(computeRecordingChargeSeconds(120, 0)).toBe(120);
      expect(computeRecordingChargeSeconds(undefined, 0)).toBe(0);
    });
  });

  describe('atomic ledger (BUS-001: 1,2,3,8,12)', () => {
    it('normal recording within allowance is allowed and accumulated', async () => {
      const user = await createUser(email(), 'U', 'hash');
      const r1 = await atomicTryConsumeRecordingSeconds(user.id, 100, 600);
      expect(r1.allowed).toBe(true);
      expect(r1.seconds).toBe(100);
      const r2 = await atomicTryConsumeRecordingSeconds(user.id, 200, 600);
      expect(r2.allowed).toBe(true);
      expect(r2.seconds).toBe(300);
    });

    it('recording exactly at remaining allowance is allowed; one second more is not', async () => {
      const user = await createUser(email(), 'U', 'hash');
      expect((await atomicTryConsumeRecordingSeconds(user.id, 600, 600)).allowed).toBe(true);
      const over = await atomicTryConsumeRecordingSeconds(user.id, 1, 600);
      expect(over.allowed).toBe(false);
      expect(await getDailyRecordedSeconds(user.id)).toBe(600);
    });

    it('beyond-allowance requests leave the ledger untouched', async () => {
      const user = await createUser(email(), 'U', 'hash');
      await atomicTryConsumeRecordingSeconds(user.id, 500, 600);
      expect((await atomicTryConsumeRecordingSeconds(user.id, 150, 600)).allowed).toBe(false);
      expect(await getDailyRecordedSeconds(user.id)).toBe(500);
      expect((await atomicTryConsumeRecordingSeconds(user.id, 100, 600)).allowed).toBe(true);
    });

    it('revert restores budget after downstream failure', async () => {
      const user = await createUser(email(), 'U', 'hash');
      await atomicTryConsumeRecordingSeconds(user.id, 400, 600);
      await atomicRevertRecordingSeconds(user.id, 400);
      expect(await getDailyRecordedSeconds(user.id)).toBe(0);
    });

    it('concurrent requests cannot overspend (BUS-001: 9)', async () => {
      const user = await createUser(email(), 'U', 'hash');
      const results = await Promise.all(
        Array.from({ length: 10 }, () => atomicTryConsumeRecordingSeconds(user.id, 100, 600)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(6);
      expect(await getDailyRecordedSeconds(user.id)).toBe(600);
    });

    it('budget rolls over on UTC day change (BUS-001: 11)', async () => {
      const user = await createUser(email(), 'U', 'hash');
      const day1 = new Date(Date.UTC(2026, 0, 1, 12));
      const day2 = new Date(Date.UTC(2026, 0, 2, 12));
      expect((await atomicTryConsumeRecordingSeconds(user.id, 600, 600, day1)).allowed).toBe(true);
      expect((await atomicTryConsumeRecordingSeconds(user.id, 1, 600, day1)).allowed).toBe(false);
      expect((await atomicTryConsumeRecordingSeconds(user.id, 600, 600, day2)).allowed).toBe(true);
      expect(await getDailyRecordedSeconds(user.id, day2)).toBe(600);
      expect(await getDailyRecordedSeconds(user.id, day1)).toBe(600);
    });
  });
});
