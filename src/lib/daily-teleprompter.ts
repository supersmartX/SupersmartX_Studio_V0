'use client';

import { FREE_DAILY_TELEPROMPTER_SECONDS } from './entitlements';

// Free plan: 3 minutes TOTAL teleprompter use per calendar day (local day).
// The teleprompter budget is separate from the 10 min/day recording budget —
// it only grows when a finished recording was made WITH a script loaded.
// Clearing the script (no prompter) or a new calendar day resets availability.

const DAY_KEY = 'sxs-tele-day';
const SECS_KEY = 'sxs-tele-secs';

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function readStored(): { day: string; secs: number } {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { day: todayKey(), secs: 0 };
  }
  try {
    const day = localStorage.getItem(DAY_KEY) || '';
    const secs = Number(localStorage.getItem(SECS_KEY) || 0);
    if (day !== todayKey()) return { day: todayKey(), secs: 0 };
    return { day, secs: Number.isFinite(secs) && secs > 0 ? Math.floor(secs) : 0 };
  } catch {
    return { day: todayKey(), secs: 0 };
  }
}

/** Seconds of teleprompter time already used today (Free budget). */
export function getDailyTeleprompterUsage(): number {
  return readStored().secs;
}

/** Seconds of Free teleprompter budget remaining today. */
export function getDailyTeleprompterRemaining(): number {
  return Math.max(0, FREE_DAILY_TELEPROMPTER_SECONDS - getDailyTeleprompterUsage());
}

/** Whether a Free user may still use the teleprompter today. */
export function canUseTeleprompterToday(): boolean {
  return getDailyTeleprompterRemaining() > 0;
}

/**
 * Seconds remaining today, already discounting the in-flight recording's
 * elapsed time (which is banked only on completion). UI mirror of the budget
 * used by the mid-recording stop.
 */
export function getDailyTeleprompterRemainingInFlight(elapsedSeconds: number): number {
  const inFlight = Math.max(0, Math.floor(elapsedSeconds));
  return Math.max(0, getDailyTeleprompterRemaining() - inFlight);
}

/** Add finished recording-with-teleprompter seconds to today's usage. Call once per completed recording. */
export function addDailyTeleprompterSeconds(seconds: number): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return;
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  try {
    const current = readStored();
    const key = todayKey();
    const base = current.day === key ? current.secs : 0;
    localStorage.setItem(DAY_KEY, key);
    localStorage.setItem(SECS_KEY, String(base + Math.round(seconds)));
  } catch {}
}