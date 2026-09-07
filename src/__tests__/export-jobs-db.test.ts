import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from '@/lib/db/driver';
import { setMigrated } from '@/lib/db/index';

process.env.TURSO_DATABASE_URL = 'file::memory:';

import {
  createUser,
  createExportJob,
  findExportJobById,
  findExportJobByIdAndUser,
  updateExportJobStatus,
  deleteOldExportJobs,
} from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

describe('export_jobs', () => {
  beforeEach(() => {
    cleanTestData();
  });

  afterEach(() => {
    cleanTestData();
  });

  describe('createExportJob', () => {
    it('creates a job with pending status', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const job = await createExportJob(user.id, '{"platformId":"youtube-landscape"}');

      expect(job.id).toMatch(/^ej-/);
      expect(job.userId).toBe(user.id);
      expect(job.configJson).toBe('{"platformId":"youtube-landscape"}');
      expect(job.status).toBe('pending');
      expect(job.progress).toBe(0);
      expect(job.resultR2Key).toBeNull();
      expect(job.resultExportId).toBeNull();
      expect(job.resultFileSize).toBe(0);
      expect(job.errorMessage).toBeNull();
      expect(job.retryCount).toBe(0);
      expect(job.createdAt).toBeDefined();
      expect(job.startedAt).toBeNull();
      expect(job.completedAt).toBeNull();
    });
  });

  describe('updateExportJobStatus', () => {
    it('transitions from pending to encoding', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const job = await createExportJob(user.id, '{}');

      const updated = await updateExportJobStatus(job.id, 'encoding');
      expect(updated).toBe(true);

      const found = await findExportJobById(job.id);
      expect(found!.status).toBe('encoding');
      expect(found!.startedAt).toBeTruthy();
    });

    it('transitions from encoding to uploading', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const job = await createExportJob(user.id, '{}');

      await updateExportJobStatus(job.id, 'encoding');
      await updateExportJobStatus(job.id, 'uploading', { progress: 50 });

      const found = await findExportJobById(job.id);
      expect(found!.status).toBe('uploading');
      expect(found!.progress).toBe(50);
    });

    it('transitions from uploading to completed', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const job = await createExportJob(user.id, '{}');

      await updateExportJobStatus(job.id, 'encoding');
      await updateExportJobStatus(job.id, 'uploading');
      await updateExportJobStatus(job.id, 'completed', {
        resultR2Key: 'exports/test.mp4',
        resultExportId: 'export-123',
        resultFileSize: 1024,
      });

      const found = await findExportJobById(job.id);
      expect(found!.status).toBe('completed');
      expect(found!.completedAt).toBeTruthy();
      expect(found!.resultR2Key).toBe('exports/test.mp4');
      expect(found!.resultExportId).toBe('export-123');
      expect(found!.resultFileSize).toBe(1024);
    });

    it('transitions from any active state to failed', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const job = await createExportJob(user.id, '{}');

      await updateExportJobStatus(job.id, 'encoding');
      await updateExportJobStatus(job.id, 'failed', { errorMessage: 'Encoding failed' });

      const found = await findExportJobById(job.id);
      expect(found!.status).toBe('failed');
      expect(found!.completedAt).toBeTruthy();
      expect(found!.errorMessage).toBe('Encoding failed');
    });

    it('returns false for non-existent job', async () => {
      const updated = await updateExportJobStatus('nonexistent', 'encoding');
      expect(updated).toBe(false);
    });
  });

  describe('findExportJobByIdAndUser', () => {
    it('finds job owned by user', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const job = await createExportJob(user.id, '{}');

      const found = await findExportJobByIdAndUser(job.id, user.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(job.id);
    });

    it('returns undefined for wrong user', async () => {
      const user1 = await createUser('user1@example.com', 'User 1', 'password123');
      const user2 = await createUser('user2@example.com', 'User 2', 'password456');
      const job = await createExportJob(user1.id, '{}');

      const found = await findExportJobByIdAndUser(job.id, user2.id);
      expect(found).toBeUndefined();
    });

    it('returns undefined for non-existent job', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      const found = await findExportJobByIdAndUser('nonexistent', user.id);
      expect(found).toBeUndefined();
    });
  });

  describe('deleteOldExportJobs', () => {
    it('deletes old jobs', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await createExportJob(user.id, '{}');

      const deleted = await deleteOldExportJobs(-1); // negative = all jobs are "old"
      expect(deleted).toBeGreaterThanOrEqual(1);
    });

    it('does not delete recent jobs', async () => {
      const user = await createUser('test@example.com', 'Test User', 'password123');
      await createExportJob(user.id, '{}');

      const deleted = await deleteOldExportJobs(24 * 60 * 60 * 1000); // 24 hours
      expect(deleted).toBe(0);
    });
  });
});
