import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

import {
  createUser,
  createExport,
  findExportById,
  findExportByIdAndUser,
  atomicIncrementDownloadCount,
  ensureUserStatsRow,
  getUserStats,
} from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

describe('exports', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('createExport', () => {
    it('creates an export record', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const exportRecord = await createExport({
        userId: user.id,
        r2Key: 'exports/user-1/test.mp4',
        platform: 'youtube-landscape',
        outputWidth: 1920,
        outputHeight: 1080,
        fileSize: 1024000,
        mimeType: 'video/mp4',
        status: 'completed',
        jobId: null,
      });

      expect(exportRecord.id).toMatch(/^export-/);
      expect(exportRecord.userId).toBe(user.id);
      expect(exportRecord.r2Key).toBe('exports/user-1/test.mp4');
      expect(exportRecord.platform).toBe('youtube-landscape');
      expect(exportRecord.outputWidth).toBe(1920);
      expect(exportRecord.outputHeight).toBe(1080);
      expect(exportRecord.fileSize).toBe(1024000);
      expect(exportRecord.mimeType).toBe('video/mp4');
      expect(exportRecord.status).toBe('completed');
      expect(exportRecord.createdAt).toBeDefined();
    });
  });

  describe('findExportById', () => {
    it('finds an existing export', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const created = await createExport({
        userId: user.id,
        r2Key: 'exports/user-1/test.mp4',
        platform: 'youtube-landscape',
        outputWidth: 1920,
        outputHeight: 1080,
        fileSize: 1024000,
        mimeType: 'video/mp4',
        status: 'completed',
        jobId: null,
      });

      const found = await findExportById(created.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
      expect(found!.r2Key).toBe('exports/user-1/test.mp4');
    });

    it('returns undefined for non-existent export', async () => {
      const found = await findExportById('nonexistent');
      expect(found).toBeUndefined();
    });
  });

  describe('findExportByIdAndUser', () => {
    it('finds export owned by user', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const created = await createExport({
        userId: user.id,
        r2Key: 'exports/user-1/test.mp4',
        platform: 'youtube-landscape',
        outputWidth: 1920,
        outputHeight: 1080,
        fileSize: 1024000,
        mimeType: 'video/mp4',
        status: 'completed',
        jobId: null,
      });

      const found = await findExportByIdAndUser(created.id, user.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(created.id);
    });

    it('returns undefined for wrong user', async () => {
      const user1 = await createUser('user1@example.com', 'User 1', 'password123');
      const user2 = await createUser('user2@example.com', 'User 2', 'password456');
      const created = await createExport({
        userId: user1.id,
        r2Key: 'exports/user-1/test.mp4',
        platform: 'youtube-landscape',
        outputWidth: 1920,
        outputHeight: 1080,
        fileSize: 1024000,
        mimeType: 'video/mp4',
        status: 'completed',
        jobId: null,
      });

      const found = await findExportByIdAndUser(created.id, user2.id);
      expect(found).toBeUndefined();
    });

    it('returns undefined for non-existent export', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const found = await findExportByIdAndUser('nonexistent', user.id);
      expect(found).toBeUndefined();
    });
  });

  describe('atomicIncrementDownloadCount', () => {
    it('increments download count when under limit', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await ensureUserStatsRow(user.id);

      const success = await atomicIncrementDownloadCount(user.id, 3);
      expect(success).toBe(true);

      const stats = await getUserStats(user.id);
      expect(stats.downloadCount).toBe(1);
    });

    it('allows multiple increments up to limit', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await ensureUserStatsRow(user.id);

      await atomicIncrementDownloadCount(user.id, 3);
      await atomicIncrementDownloadCount(user.id, 3);
      const success = await atomicIncrementDownloadCount(user.id, 3);
      expect(success).toBe(true);

      const stats = await getUserStats(user.id);
      expect(stats.downloadCount).toBe(3);
    });

    it('rejects increment when at limit', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await ensureUserStatsRow(user.id);

      await atomicIncrementDownloadCount(user.id, 3);
      await atomicIncrementDownloadCount(user.id, 3);
      await atomicIncrementDownloadCount(user.id, 3);
      const success = await atomicIncrementDownloadCount(user.id, 3);
      expect(success).toBe(false);

      const stats = await getUserStats(user.id);
      expect(stats.downloadCount).toBe(3);
    });

    it('allows unlimited downloads when maxDownloads is high', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await ensureUserStatsRow(user.id);

      for (let i = 0; i < 100; i++) {
        const success = await atomicIncrementDownloadCount(user.id, 1000);
        expect(success).toBe(true);
      }

      const stats = await getUserStats(user.id);
      expect(stats.downloadCount).toBe(100);
    });
  });

  describe('ensureUserStatsRow', () => {
    it('creates stats row if not exists', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await ensureUserStatsRow(user.id);

      const stats = await getUserStats(user.id);
      expect(stats.downloadCount).toBe(0);
      expect(stats.uploadCount).toBe(0);
      expect(stats.storageBytes).toBe(0);
    });

    it('does not overwrite existing stats', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await ensureUserStatsRow(user.id);
      await atomicIncrementDownloadCount(user.id, 10);

      await ensureUserStatsRow(user.id); // Should not reset
      const stats = await getUserStats(user.id);
      expect(stats.downloadCount).toBe(1);
    });
  });
});
