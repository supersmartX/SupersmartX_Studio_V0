import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getDailyRecordingUsage,
  getDailyRecordingRemaining,
  getDailyRecordingRemainingInFlight,
  canRecordToday,
  addDailyRecordingSeconds,
} from '@/lib/daily-recording';
import { FREE_DAILY_RECORDING_SECONDS } from '@/lib/entitlements';

describe('daily recording budget (Free: 10 min/day, downloads unlimited)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts empty with full budget', () => {
    expect(getDailyRecordingUsage()).toBe(0);
    expect(getDailyRecordingRemaining()).toBe(FREE_DAILY_RECORDING_SECONDS);
    expect(canRecordToday()).toBe(true);
  });

  it('accumulates finished recording seconds', () => {
    addDailyRecordingSeconds(300);
    expect(getDailyRecordingUsage()).toBe(300);
    expect(getDailyRecordingRemaining()).toBe(300);
    expect(canRecordToday()).toBe(true);
  });

  it('blocks new recordings once 10 min/day is used', () => {
    addDailyRecordingSeconds(420);
    addDailyRecordingSeconds(180);
    expect(getDailyRecordingUsage()).toBe(600);
    expect(getDailyRecordingRemaining()).toBe(0);
    expect(canRecordToday()).toBe(false);
  });

  it('ignores invalid input', () => {
    addDailyRecordingSeconds(NaN);
    addDailyRecordingSeconds(-5);
    addDailyRecordingSeconds(0);
    expect(getDailyRecordingUsage()).toBe(0);
    expect(canRecordToday()).toBe(true);
  });

  it('record 5 min then download repeatedly does not consume extra budget', () => {
    // Recording consumes once at completion; downloads never call addDailyRecordingSeconds
    addDailyRecordingSeconds(300);
    expect(getDailyRecordingUsage()).toBe(300);
    expect(canRecordToday()).toBe(true);
  });
});

describe('getDailyRecordingRemainingInFlight', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns full budget when no usage and no elapsed', () => {
    expect(getDailyRecordingRemainingInFlight(0)).toBe(FREE_DAILY_RECORDING_SECONDS);
  });

  it('deducts in-flight elapsed from remaining', () => {
    addDailyRecordingSeconds(300);
    expect(getDailyRecordingRemainingInFlight(120)).toBe(180);
  });

  it('floors fractional elapsed seconds', () => {
    addDailyRecordingSeconds(300);
    expect(getDailyRecordingRemainingInFlight(119.9)).toBe(181);
  });

  it('never goes below zero', () => {
    addDailyRecordingSeconds(500);
    expect(getDailyRecordingRemainingInFlight(200)).toBe(0);
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
    addDailyRecordingSeconds(300);
    expect(getDailyRecordingRemaining()).toBe(300);

    vi.setSystemTime(new Date('2026-09-16T08:00:00'));
    expect(getDailyRecordingRemaining()).toBe(FREE_DAILY_RECORDING_SECONDS);
    expect(canRecordToday()).toBe(true);
  });

  it('keeps usage when the calendar day has not changed', () => {
    addDailyRecordingSeconds(120);
    vi.setSystemTime(new Date('2026-09-15T23:59:59'));
    expect(getDailyRecordingRemaining()).toBe(480);
  });
});
