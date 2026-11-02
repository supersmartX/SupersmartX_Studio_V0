/**
 * Post-download engagement frequency cap.
 *
 * Persisted with the same conventions as the rest of the Studio's local state
 * (`sxs-` key, localStorage, JSON payload, swallow storage failures): no
 * analytics or storage dependency is introduced, and a browser that blocks
 * storage simply sees the popup rather than silently losing it forever.
 *
 * The cap is a time window, not a permanent dismissal: a creator who exports
 * regularly is asked at most once a week, while a first-time exporter sees it
 * on their first successful download.
 */
const STORAGE_KEY = 'sxs-post-download-engagement';

export const ENGAGEMENT_MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

interface EngagementState {
  lastShownAt: number;
}

function readState(): EngagementState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<EngagementState> | null;
    const lastShownAt = Number(parsed?.lastShownAt);
    if (!Number.isFinite(lastShownAt) || lastShownAt <= 0) return null;
    return { lastShownAt };
  } catch {
    return null;
  }
}

export function shouldShowPostDownloadEngagement(now = Date.now()): boolean {
  const state = readState();
  if (!state) return true;
  const elapsed = now - state.lastShownAt;
  // A negative gap means the stored timestamp is in the future (clock change).
  // The record cannot be trusted to time anything, so treat the cap as expired
  // rather than hiding the popup until the clock catches up.
  if (elapsed < 0) return true;
  return elapsed >= ENGAGEMENT_MIN_INTERVAL_MS;
}

export function markPostDownloadEngagementShown(now = Date.now()): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ lastShownAt: now }));
  } catch {
    // Storage unavailable: the cap cannot be recorded, and blocking the popup
    // over that would be worse than occasionally showing it again.
  }
}
