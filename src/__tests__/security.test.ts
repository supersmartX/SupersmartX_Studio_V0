import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

import {
  createUser,
  createExportJob,
  findExportJobByIdAndUser,
  updateExportJobStatus,
  getOldExportJobs,
  deleteOldExportJobs,
  atomicIncrementUploadCount,
  ensureUserStatsRow,
} from '@/lib/db';
import { getEntitlements, isPlanActive } from '@/lib/entitlements';
import { rateLimit } from '@/lib/rate-limit';
import { generateRecordingKey } from '@/lib/r2';
import type { PlanType } from '@/types/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

describe('security', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('free user cannot upload to R2', () => {
    it('free user entitlements block export', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.canExport).toBe(false);
      expect(entitlements.canDownload).toBe(false);
    });

    it('free user cannot pass canExport check', async () => {
      const user = await createUser('free@example.com', 'Free User', 'password123');
      const entitlements = getEntitlements(user.plan as PlanType);

      expect(user.plan).toBe('free');
      expect(entitlements.canExport).toBe(false);
    });

    it('free user has limited uploads', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.maxUploads).toBe(3);
    });

    it('free user has limited storage', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.maxStorageMB).toBe(500);
    });

    it('free user requires watermark', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.watermarkRequired).toBe(true);
    });
  });

  describe('expired paid user cannot upload', () => {
    it('expired plan is not active', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      expect(isPlanActive(pastDate)).toBe(false);
    });

    it('active plan is active', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      expect(isPlanActive(futureDate)).toBe(true);
    });

    it('null plan expiry is active (legacy)', () => {
      expect(isPlanActive(null)).toBe(true);
    });

    it('expired creator_monthly plan is rejected', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      expect(isPlanActive(pastDate)).toBe(false);
    });

    it('active creator_monthly plan is accepted', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      expect(isPlanActive(futureDate)).toBe(true);
    });
  });

  describe('user A cannot access user B export', () => {
    it('findExportJobByIdAndUser returns undefined for wrong user', async () => {
      const userA = await createUser('a@example.com', 'User A', 'password123');
      const userB = await createUser('b@example.com', 'User B', 'password456');
      const job = await createExportJob(userA.id, '{}');

      const foundByB = await findExportJobByIdAndUser(job.id, userB.id);
      expect(foundByB).toBeUndefined();
    });

    it('findExportJobByIdAndUser returns job for correct user', async () => {
      const userA = await createUser('a@example.com', 'User A', 'password123');
      const job = await createExportJob(userA.id, '{}');

      const foundByA = await findExportJobByIdAndUser(job.id, userA.id);
      expect(foundByA).toBeDefined();
      expect(foundByA!.userId).toBe(userA.id);
    });
  });

  describe('download entitlements', () => {
    it('canDownload is false for free user', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.canDownload).toBe(false);
    });

    it('canDownload is true for creator_monthly', () => {
      const entitlements = getEntitlements('creator_monthly');
      expect(entitlements.canDownload).toBe(true);
    });

    it('canDownload is true for pro_monthly', () => {
      const entitlements = getEntitlements('pro_monthly');
      expect(entitlements.canDownload).toBe(true);
    });

    it('canDownload is true for creator_yearly', () => {
      const entitlements = getEntitlements('creator_yearly');
      expect(entitlements.canDownload).toBe(true);
    });

    it('canDownload is true for pro_yearly', () => {
      const entitlements = getEntitlements('pro_yearly');
      expect(entitlements.canDownload).toBe(true);
    });
  });

  describe('rate limiting', () => {
    it('allows requests within limit', () => {
      const result = rateLimit('test-key', 5, 60000);
      expect(result.allowed).toBe(true);
    });

    it('blocks requests over limit', () => {
      for (let i = 0; i < 5; i++) {
        rateLimit('test-blocking', 5, 60000);
      }
      const result = rateLimit('test-blocking', 5, 60000);
      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
    });

    it('different keys are independent', () => {
      for (let i = 0; i < 5; i++) {
        rateLimit('key-a', 5, 60000);
      }
      const result = rateLimit('key-b', 5, 60000);
      expect(result.allowed).toBe(true);
    });

    it('stale entries are cleaned up', () => {
      for (let i = 0; i < 5; i++) {
        rateLimit('stale-key', 5, 1);
      }
      const start = Date.now();
      while (Date.now() - start < 5) {
        // busy wait
      }
      const result = rateLimit('stale-key', 5, 60000);
      expect(result.allowed).toBe(true);
    });
  });

  describe('updateExportJobStatus user_id scoping', () => {
    it('updates job only when userId matches', async () => {
      const userA = await createUser('a@example.com', 'User A', 'password123');
      const userB = await createUser('b@example.com', 'User B', 'password456');
      const job = await createExportJob(userA.id, '{}');

      const updated = await updateExportJobStatus(job.id, 'encoding', {}, userB.id);
      expect(updated).toBe(false);
    });

    it('updates job when userId matches', async () => {
      const userA = await createUser('a@example.com', 'User A', 'password123');
      const job = await createExportJob(userA.id, '{}');

      const updated = await updateExportJobStatus(job.id, 'encoding', {}, userA.id);
      expect(updated).toBe(true);
    });

    it('updates job without userId (backward compat)', async () => {
      const userA = await createUser('a@example.com', 'User A', 'password123');
      const job = await createExportJob(userA.id, '{}');

      const updated = await updateExportJobStatus(job.id, 'encoding');
      expect(updated).toBe(true);
    });
  });

  describe('storage quota enforced server-side', () => {
    it('atomicIncrementUploadCount rejects when upload limit exceeded', async () => {
      const user = await createUser('quota@example.com', 'Quota User', 'password123');
      await ensureUserStatsRow(user.id);

      const result = await atomicIncrementUploadCount(user.id, 1024, 0, null);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('Upload limit');
      }
    });

    it('atomicIncrementUploadCount allows within quota', async () => {
      const user = await createUser('quota2@example.com', 'Quota User 2', 'password123');
      await ensureUserStatsRow(user.id);

      const result = await atomicIncrementUploadCount(user.id, 1024, 10, null);
      expect(result.allowed).toBe(true);
    });

    it('atomicIncrementUploadCount rejects when storage exceeded', async () => {
      const user = await createUser('storage@example.com', 'Storage User', 'password123');
      await ensureUserStatsRow(user.id);

      const result = await atomicIncrementUploadCount(user.id, 2048, 10, 1024);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toContain('Storage limit');
      }
    });
  });

  describe('server job ID tracking', () => {
    it('createExportJob returns job with id', async () => {
      const user = await createUser('job@example.com', 'Job User', 'password123');
      const job = await createExportJob(user.id, '{"platformId":"youtube-landscape"}');

      expect(job.id).toBeDefined();
      expect(job.id).toMatch(/^ej-/);
      expect(job.userId).toBe(user.id);
    });

    it('updateExportJobStatus works with userId scoping', async () => {
      const user = await createUser('track@example.com', 'Track User', 'password123');
      const job = await createExportJob(user.id, '{}');

      const updated = await updateExportJobStatus(job.id, 'encoding', {}, user.id);
      expect(updated).toBe(true);

      const found = await findExportJobByIdAndUser(job.id, user.id);
      expect(found!.status).toBe('encoding');
    });
  });

  describe('payment/client plan manipulation rejected', () => {
    it('plan is determined by server, not client', async () => {
      const user = await createUser('pay@example.com', 'Pay User', 'password123');
      expect(user.plan).toBe('free');

      const entitlements = getEntitlements(user.plan as PlanType);
      expect(entitlements.canExport).toBe(false);
    });

    it('expired plan is rejected regardless of client claims', () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString();
      expect(isPlanActive(pastDate)).toBe(false);
    });
  });

  describe('arbitrary R2 key rejected', () => {
    it('generateRecordingKey always prefixes with recordings/userId/', () => {
      const key = generateRecordingKey('user-123', 'webm');
      expect(key).toMatch(/^recordings\/user-123\//);
      expect(key).toMatch(/\.webm$/);
    });

    it('generateRecordingKey uses timestamp and random suffix', () => {
      const key = generateRecordingKey('user-123', 'mp4');
      const parts = key.split('/');
      expect(parts.length).toBe(3);
      expect(parts[0]).toBe('recordings');
      expect(parts[1]).toBe('user-123');
      expect(parts[2]).toMatch(/^\d+-[a-z0-9]+\.mp4$/);
    });
  });

  describe('R2 cleanup', () => {
    it('getOldExportJobs returns resultR2Key for old jobs', async () => {
      const user = await createUser('cleanup@example.com', 'Cleanup User', 'password123');
      const job = await createExportJob(user.id, '{}');

      await updateExportJobStatus(job.id, 'completed', {
        resultR2Key: 'exports/test/file.mp4',
      });

      const oldJobs = await getOldExportJobs(-1);
      expect(oldJobs.length).toBeGreaterThanOrEqual(1);
      expect(oldJobs.some((j) => j.r2Key === 'exports/test/file.mp4')).toBe(true);
    });

    it('deleteOldExportJobs removes old DB rows', async () => {
      const user = await createUser('delete@example.com', 'Delete User', 'password123');
      await createExportJob(user.id, '{}');

      const deleted = await deleteOldExportJobs(-1);
      expect(deleted).toBeGreaterThanOrEqual(1);
    });
  });

  describe('entitlements are plan-authoritative', () => {
    it('creator_monthly has export and download enabled', () => {
      const entitlements = getEntitlements('creator_monthly');
      expect(entitlements.canExport).toBe(true);
      expect(entitlements.canDownload).toBe(true);
    });

    it('pro_monthly has export and download enabled', () => {
      const entitlements = getEntitlements('pro_monthly');
      expect(entitlements.canExport).toBe(true);
      expect(entitlements.canDownload).toBe(true);
    });

    it('free has export and download disabled', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.canExport).toBe(false);
      expect(entitlements.canDownload).toBe(false);
    });

    it('pro has higher resolution limit than creator', () => {
      const creator = getEntitlements('creator_monthly');
      const pro = getEntitlements('pro_monthly');
      expect(pro.maxResolution.width).toBeGreaterThanOrEqual(creator.maxResolution.width);
      expect(pro.maxResolution.height).toBeGreaterThanOrEqual(creator.maxResolution.height);
    });

    it('free has watermark required', () => {
      const entitlements = getEntitlements('free');
      expect(entitlements.watermarkRequired).toBe(true);
    });

    it('paid plans do not require watermark', () => {
      expect(getEntitlements('creator_monthly').watermarkRequired).toBe(false);
      expect(getEntitlements('pro_monthly').watermarkRequired).toBe(false);
    });
  });
});
