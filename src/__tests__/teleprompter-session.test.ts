import { describe, it, expect } from 'vitest';
import { FREE_SESSION_TELEPROMPTER_SECONDS } from '@/lib/entitlements';
import { getTeleprompterSessionCap, getTeleprompterRemainingInSession } from '@/lib/teleprompter-session';

describe('teleprompter session cap', () => {
  it('is unlimited for Creator plans', () => {
    expect(getTeleprompterSessionCap({ isCreator: true, recordingCapSeconds: null })).toBeNull();
    expect(getTeleprompterSessionCap({ isCreator: true, recordingCapSeconds: 300 })).toBeNull();
  });

  it('gives Free a full fresh allowance per recording (no daily banking)', () => {
    const cap = getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 600 });
    expect(cap).toBe(FREE_SESSION_TELEPROMPTER_SECONDS);
    expect(cap).toBe(180);
  });

  it('caps the teleprompter by the remaining daily recording budget for the take', () => {
    // e.g. 10 min recording budget used 480s → this take caps at 120s (and so does the prompter)
    expect(getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 120 })).toBe(120);
    // full budget → teleprompter full 3 min
    expect(getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 600 })).toBe(180);
    // exhausted budget → teleprompter is not available at all
    expect(getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 0 })).toBe(0);
    expect(getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: -5 })).toBe(0);
  });

  it('never exceeds 180s even with a larger recording budget', () => {
    expect(getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 900 })).toBe(180);
  });
});

describe('teleprompter remaining in session', () => {
  it('returns null when the cap is unlimited (Creator)', () => {
    expect(getTeleprompterRemainingInSession(null, 60)).toBeNull();
    expect(getTeleprompterRemainingInSession(null, 9999)).toBeNull();
  });

  it('counts down from the cap while the take runs and clamps at zero', () => {
    const cap = getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 600 })!;
    expect(getTeleprompterRemainingInSession(cap, 0)).toBe(180);
    expect(getTeleprompterRemainingInSession(cap, 120)).toBe(60);
    expect(getTeleprompterRemainingInSession(cap, 300)).toBe(0);
  });

  it('is independent of the recording budget so teleprompter time never deducts from recording time', () => {
    // Session allowance is fresh per recording: remaining is computed from the cap alone,
    // not from any banked daily teleprompter usage.
    const cap = getTeleprompterSessionCap({ isCreator: false, recordingCapSeconds: 600 })!;
    expect(getTeleprompterRemainingInSession(cap, 90)).toBe(90);
    expect(getTeleprompterRemainingInSession(cap, 181)).toBe(0);
  });
});