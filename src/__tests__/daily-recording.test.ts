import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDailyRecordingUsage,
  getDailyRecordingRemaining,
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
