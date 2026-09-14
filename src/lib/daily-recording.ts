'use client';

import { FREE_DAILY_RECORDING_SECONDS } from './entitlements';

// Free plan: 10 minutes TOTAL recording per calendar day (local day).
// This is separate from local downloads, which are unlimited — re-downloading
// the same export must not consume recording time.

const DAY_KEY = 'sxs-record-day';
const SECS_KEY = 'sxs-record-secs';

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

/** Seconds of recording already used today (Free budget). */
export function getDailyRecordingUsage(): number {
  return readStored().secs;
}

/** Seconds of Free recording budget remaining today. */
export function getDailyRecordingRemaining(): number {
  return Math.max(0, FREE_DAILY_RECORDING_SECONDS - getDailyRecordingUsage());
}

/** Whether a Free user may start a new recording today. */
export function canRecordToday(): boolean {
  return getDailyRecordingRemaining() > 0;
}

/** Add completed recording seconds to today's usage. Call once per finished recording. */
export function addDailyRecordingSeconds(seconds: number): void {
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
