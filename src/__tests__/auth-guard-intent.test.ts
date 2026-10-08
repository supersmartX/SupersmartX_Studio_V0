import { describe, it, expect, beforeEach } from 'vitest';
import type { Session } from 'next-auth';
import {
  stashPendingDownloadExportId,
  consumePendingDownloadExportId,
  hasPendingDownload,
  setPendingDownload,
  clearPendingDownload,
  requireAuthForDownload,
  executePendingDownload,
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

  // Phase 5 WS-A extension (Option C): the guard DECISION function itself —
  // the entry point every download-gate flow goes through — now has a direct
  // truth table so a regression cannot hide behind the flow-level suites.

  it('requireAuthForDownload: signed-in session downloads immediately, nothing stashed', () => {
    let downloads = 0;
    let asked = 0;
    requireAuthForDownload(
      { user: { name: 'Signed In' } } as unknown as Session,
      () => { downloads += 1; },
      () => { asked += 1; },
    );
    expect(downloads).toBe(1);
    expect(asked).toBe(0);
    expect(hasPendingDownload()).toBe(false);
  });

  it('requireAuthForDownload: guest goes to auth; the download replays exactly once', () => {
    let downloads = 0;
    let asked = 0;
    requireAuthForDownload(
      null,
      () => { downloads += 1; },
      () => { asked += 1; },
    );
    expect(downloads).toBe(0);
    expect(asked).toBe(1);
    expect(hasPendingDownload()).toBe(true);

    // Post-login replay through the credentials path: one-shot.
    executePendingDownload();
    expect(downloads).toBe(1);
    expect(hasPendingDownload()).toBe(false);
    executePendingDownload();
    expect(downloads).toBe(1);
  });

  it('requireAuthForDownload: a session without a user is treated as guest', () => {
    let downloads = 0;
    let asked = 0;
    requireAuthForDownload(
      {} as unknown as Session,
      () => { downloads += 1; },
      () => { asked += 1; },
    );
    expect(downloads).toBe(0);
    expect(asked).toBe(1);
    expect(hasPendingDownload()).toBe(true);
  });
});
