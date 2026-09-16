import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDailyTeleprompterUsage,
  getDailyTeleprompterRemaining,
  getDailyTeleprompterRemainingInFlight,
  canUseTeleprompterToday,
  addDailyTeleprompterSeconds,
} from '@/lib/daily-teleprompter';
import { FREE_DAILY_TELEPROMPTER_SECONDS } from '@/lib/entitlements';

describe('daily teleprompter budget (Free: 3 min/day, separate from recording)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty with full budget', () => {
    expect(getDailyTeleprompterUsage()).toBe(0);
    expect(getDailyTeleprompterRemaining()).toBe(FREE_DAILY_TELEPROMPTER_SECONDS);
    expect(canUseTeleprompterToday()).toBe(true);
  });

  it('accumulates finished recording-with-teleprompter seconds', () => {
    addDailyTeleprompterSeconds(90);
    expect(getDailyTeleprompterUsage()).toBe(90);
    expect(getDailyTeleprompterRemaining()).toBe(90);
    expect(canUseTeleprompterToday()).toBe(true);
  });

  it('disables teleprompter once 3 min/day is used', () => {
    addDailyTeleprompterSeconds(120);
    addDailyTeleprompterSeconds(60);
    expect(getDailyTeleprompterUsage()).toBe(180);
    expect(getDailyTeleprompterRemaining()).toBe(0);
    expect(canUseTeleprompterToday()).toBe(false);
  });

  it('never allows negative remaining even when over-adding', () => {
    addDailyTeleprompterSeconds(180);
    addDailyTeleprompterSeconds(60);
    expect(getDailyTeleprompterRemaining()).toBe(0);
    expect(canUseTeleprompterToday()).toBe(false);
  });

  it('ignores invalid input', () => {
    addDailyTeleprompterSeconds(NaN);
    addDailyTeleprompterSeconds(-5);
    addDailyTeleprompterSeconds(0);
    expect(getDailyTeleprompterUsage()).toBe(0);
    expect(canUseTeleprompterToday()).toBe(true);
  });
});

describe('getDailyTeleprompterRemainingInFlight', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns full budget when no usage and no elapsed', () => {
    expect(getDailyTeleprompterRemainingInFlight(0)).toBe(FREE_DAILY_TELEPROMPTER_SECONDS);
  });

  it('deducts in-flight elapsed from remaining', () => {
    addDailyTeleprompterSeconds(90);
    expect(getDailyTeleprompterRemainingInFlight(30)).toBe(60);
  });

  it('floors fractional elapsed seconds', () => {
    addDailyTeleprompterSeconds(90);
    expect(getDailyTeleprompterRemainingInFlight(29.9)).toBe(61);
  });

  it('never goes below zero', () => {
    addDailyTeleprompterSeconds(170);
    expect(getDailyTeleprompterRemainingInFlight(200)).toBe(0);
  });
});

describe('calendar day reset', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-15T08:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets to full budget when the calendar day changes', () => {
    addDailyTeleprompterSeconds(120);
    expect(getDailyTeleprompterRemaining()).toBe(60);

    vi.setSystemTime(new Date('2026-09-16T08:00:00'));
    expect(getDailyTeleprompterRemaining()).toBe(FREE_DAILY_TELEPROMPTER_SECONDS);
    expect(canUseTeleprompterToday()).toBe(true);
  });

  it('keeps usage when the calendar day has not changed', () => {
    addDailyTeleprompterSeconds(60);
    vi.setSystemTime(new Date('2026-09-15T23:59:59'));
    expect(getDailyTeleprompterRemaining()).toBe(120);
  });
});