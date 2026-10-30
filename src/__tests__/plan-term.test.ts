import { describe, it, expect } from 'vitest';
import { addPlanTerm, planTermInterval, isPlanActive } from '@/lib/entitlements';
import { formatAccessUntil } from '@/lib/email';

/**
 * One-time prepaid terms. A purchase grants exactly one calendar month or one
 * calendar year, and a renewal is measured from the stored end date — so the
 * arithmetic has to survive the cases where month/year addition overflows:
 * 31 Jan + 1 month is the last day of February, not 3 March, and 29 Feb + 1 year
 * is 28 Feb, not 1 March. (`addPlanTerm` mirrors Postgres `interval`, which is
 * what the server actually uses.)
 */
describe('addPlanTerm', () => {
  it('adds one calendar month without drifting the day', () => {
    expect(addPlanTerm(new Date('2026-03-15T10:00:00.000Z'), 'monthly').toISOString())
      .toBe('2026-04-15T10:00:00.000Z');
  });

  it('clamps 31 January + 1 month to the end of February (non-leap year)', () => {
    expect(addPlanTerm(new Date('2026-01-31T00:00:00.000Z'), 'monthly').toISOString())
      .toBe('2026-02-28T00:00:00.000Z');
  });

  it('clamps 31 January + 1 month to 29 February in a leap year', () => {
    expect(addPlanTerm(new Date('2028-01-31T00:00:00.000Z'), 'monthly').toISOString())
      .toBe('2028-02-29T00:00:00.000Z');
  });

  it('clamps 30 April + 1 month to 30 May, not 30 June', () => {
    expect(addPlanTerm(new Date('2026-04-30T00:00:00.000Z'), 'monthly').toISOString())
      .toBe('2026-05-30T00:00:00.000Z');
  });

  it('adds one calendar year', () => {
    expect(addPlanTerm(new Date('2026-11-02T00:00:00.000Z'), 'yearly').toISOString())
      .toBe('2027-11-02T00:00:00.000Z');
  });

  it('clamps 29 February + 1 year to 28 February', () => {
    expect(addPlanTerm(new Date('2028-02-29T00:00:00.000Z'), 'yearly').toISOString())
      .toBe('2029-02-28T00:00:00.000Z');
  });

  it('does not mutate the input date', () => {
    const from = new Date('2026-01-31T00:00:00.000Z');
    addPlanTerm(from, 'monthly');
    expect(from.toISOString()).toBe('2026-01-31T00:00:00.000Z');
  });
});

describe('planTermInterval', () => {
  it('maps yearly plans to a year and everything else to a month', () => {
    expect(planTermInterval('creator_yearly')).toBe('1 year');
    expect(planTermInterval('pro_yearly')).toBe('1 year');
    expect(planTermInterval('creator_monthly')).toBe('1 month');
    expect(planTermInterval('pro_monthly')).toBe('1 month');
  });
});

describe('formatAccessUntil — receipt date', () => {
  it('renders the stored expiry in UTC, so the printed day cannot drift', () => {
    // Late-evening UTC is already the next day in every zone east of UTC, which
    // is exactly where a local-time formatter would print the wrong date.
    expect(formatAccessUntil('2027-01-15T23:30:00.000Z')).toBe('January 15, 2027');
  });

  it('omits the row when there is no usable expiry', () => {
    expect(formatAccessUntil(null)).toBeNull();
    expect(formatAccessUntil(undefined)).toBeNull();
    expect(formatAccessUntil('not-a-date')).toBeNull();
  });
});

describe('isPlanActive — fail-closed for paid plans', () => {
  const now = Date.now();

  it('treats a paid plan without a stored expiry as inactive', () => {
    expect(isPlanActive(null, 'creator_yearly')).toBe(false);
    expect(isPlanActive(undefined, 'creator_monthly')).toBe(false);
  });

  it('treats a paid plan with a past expiry as inactive', () => {
    expect(isPlanActive(new Date(now - 1000).toISOString(), 'creator_yearly')).toBe(false);
  });

  it('keeps a paid plan active until the stored expiry', () => {
    expect(isPlanActive(new Date(now + 60_000).toISOString(), 'creator_monthly')).toBe(true);
  });
});
