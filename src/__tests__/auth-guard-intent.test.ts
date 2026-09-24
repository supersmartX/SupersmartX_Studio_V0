import { describe, it, expect, beforeEach } from 'vitest';
import {
  stashPendingDownloadExportId,
  consumePendingDownloadExportId,
  hasPendingDownload,
  setPendingDownload,
  clearPendingDownload,
} from '@/lib/auth-guard';

describe('guest download-intent persistence (OAuth reload survival)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    clearPendingDownload();
  });

  it('stashed intent survives and is single-use', () => {
    stashPendingDownloadExportId('export-123');
    expect(consumePendingDownloadExportId()).toBe('export-123');
    // Consumed (cleared) — a second login must not replay it.
    expect(consumePendingDownloadExportId()).toBeNull();
  });

  it('no intent when nothing stashed', () => {
    expect(consumePendingDownloadExportId()).toBeNull();
    expect(hasPendingDownload()).toBe(false);
  });

  it('live closure (credentials path) is observable separately', () => {
    setPendingDownload(() => {});
    expect(hasPendingDownload()).toBe(true);
    clearPendingDownload();
    expect(hasPendingDownload()).toBe(false);
  });
});
