import { beforeEach, describe, expect, it } from 'vitest';
import {
  ENGAGEMENT_MIN_INTERVAL_MS,
  markPostDownloadEngagementShown,
  shouldShowPostDownloadEngagement,
} from '@/lib/engagement';

const STORAGE_KEY = 'sxs-post-download-engagement';

describe('post-download engagement frequency cap', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('shows on the first successful download', () => {
    expect(shouldShowPostDownloadEngagement()).toBe(true);
  });

  it('does not show again inside the one-week window', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    markPostDownloadEngagementShown(now);
    expect(shouldShowPostDownloadEngagement(now + 1_000)).toBe(false);
    expect(shouldShowPostDownloadEngagement(now + ENGAGEMENT_MIN_INTERVAL_MS - 1)).toBe(false);
  });

  it('shows again once the window has elapsed', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    markPostDownloadEngagementShown(now);
    expect(shouldShowPostDownloadEngagement(now + ENGAGEMENT_MIN_INTERVAL_MS)).toBe(true);
  });

  it('ignores an unreadable record instead of hiding the popup forever', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not-json');
    expect(shouldShowPostDownloadEngagement()).toBe(true);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastShownAt: 'yesterday' }));
    expect(shouldShowPostDownloadEngagement()).toBe(true);
  });

  it('treats a future timestamp as untrusted rather than blocking until the clock catches up', () => {
    const now = Date.UTC(2026, 10, 2, 12);
    markPostDownloadEngagementShown(now + ENGAGEMENT_MIN_INTERVAL_MS * 2);
    expect(shouldShowPostDownloadEngagement(now)).toBe(true);
  });
});
