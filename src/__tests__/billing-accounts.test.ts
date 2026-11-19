import { describe, expect, it } from 'vitest';
import { classifyBillingAccount } from '@/lib/billing/accounts';

describe('billing account baseline bootstrap', () => {
  const now = new Date('2026-11-18T00:00:00.000Z');

  it('preserves active Creator access', () => {
    expect(classifyBillingAccount({
      plan: 'creator_monthly',
      planExpiresAt: '2026-12-18T00:00:00.000Z',
      now,
    }).status).toBe('active');
  });

  it('preserves legacy Pro as paid Creator entitlement', () => {
    expect(classifyBillingAccount({
      plan: 'pro_yearly',
      planExpiresAt: '2027-11-18T00:00:00.000Z',
      now,
    }).status).toBe('active');
  });

  it('bootstraps Free without inventing expiry', () => {
    expect(classifyBillingAccount({ plan: 'free', planExpiresAt: null, now })).toMatchObject({
      plan: 'free',
      status: 'free',
      paidThroughAt: null,
    });
  });

  it('does not preserve expired paid accounts as active', () => {
    expect(classifyBillingAccount({
      plan: 'creator_yearly',
      planExpiresAt: '2026-10-18T00:00:00.000Z',
      now,
    }).status).toBe('expired');
  });

  it('fails unknown account states safely to unknown', () => {
    expect(classifyBillingAccount({
      plan: 'mystery_plan',
      planExpiresAt: '2027-01-18T00:00:00.000Z',
      now,
    }).status).toBe('unknown');
  });

  it('treats stacked purchases by preserving the later expiry supplied by the account', () => {
    expect(classifyBillingAccount({
      plan: 'creator_yearly',
      planExpiresAt: '2028-11-18T00:00:00.000Z',
      now,
    }).paidThroughAt?.toISOString()).toBe('2028-11-18T00:00:00.000Z');
  });
});
