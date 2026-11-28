import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * The /settings account page: plan status, humanized billing vocabulary and
 * the same three-state cancellation flow the Header menu offers (both now run
 * on the shared useAccountBilling hook, so both must agree on provider states).
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Ada Lovelace', email: 'ada@example.com', plan: 'creator_monthly' } },
    status: 'authenticated',
    update: vi.fn(),
  }),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

import { SettingsClient } from '@/components/settings/SettingsClient';

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    const payload = routes[url];
    if (payload === undefined) return Promise.resolve({ ok: true, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => payload });
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it('shows the plan with humanized status and access dates', async () => {
  stubFetch({
    '/api/user/stats': { planExpiresAt: '2027-01-15T09:30:00.000Z', planActive: true },
    '/api/paddle/billing': {
      account: { status: 'active', paidThroughAt: '2027-01-15T09:30:00.000Z', nextChargeAt: '2027-01-15T09:30:00.000Z', cancelAtPeriodEnd: false, cancellationConfirmed: false },
      transactions: [],
    },
  });
  render(<SettingsClient />);

  expect(await screen.findByText('Access until')).toBeInTheDocument();
  // Both the access expiry and the next charge fall on the same date here.
  expect(screen.getAllByText('Jan 15, 2027').length).toBeGreaterThanOrEqual(1);
  expect(screen.getByText('Active')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Manage plan' })).toBeInTheDocument();
});

it('translates a failed payment into human wording with a recovery action', async () => {
  stubFetch({
    '/api/user/stats': { planExpiresAt: '2027-01-15T09:30:00.000Z', planActive: true },
    '/api/paddle/billing': {
      account: { status: 'past_due', paidThroughAt: null, nextChargeAt: null, cancelAtPeriodEnd: false, cancellationConfirmed: false, paymentMethodUpdateUrl: 'https://paddle.example/update' },
      transactions: [],
    },
  });
  render(<SettingsClient />);

  expect(await screen.findByText('Your latest payment needs attention.')).toBeInTheDocument();
  expect(screen.getByText('Payment needs attention')).toBeInTheDocument();
  const retry = screen.getByRole('link', { name: 'Retry payment or update payment method' });
  expect(retry).toHaveAttribute('href', 'https://paddle.example/update');
  // A failed payment must not offer a cancellation of an active period.
  expect(screen.queryByRole('button', { name: 'Cancel at period end' })).toBeNull();
});

it('does not show cancellation as scheduled while provider confirmation is pending', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url === '/api/user/stats') {
      return Promise.resolve({ ok: true, json: async () => ({ planExpiresAt: '2027-01-15T09:30:00.000Z', planActive: true }) });
    }
    if (url === '/api/paddle/billing') {
      return Promise.resolve({ ok: true, json: async () => ({
        account: { status: 'active', paidThroughAt: '2027-01-15T09:30:00.000Z', nextChargeAt: '2027-01-15T09:30:00.000Z', cancelAtPeriodEnd: false },
        transactions: [],
      }) });
    }
    return Promise.resolve({
      ok: true,
      status: 202,
      json: async () => ({ status: 'cancellation_pending_reconciliation' }),
    });
  }));
  render(<SettingsClient />);

  fireEvent.click(await screen.findByRole('button', { name: 'Cancel at period end' }));

  expect(await screen.findByText(/Paddle has not confirmed cancellation yet/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Check cancellation status' })).toBeInTheDocument();
  expect(screen.queryByText('Scheduled for the end of the paid period')).toBeNull();
});

it('shows cancellation as scheduled only after the API returns confirmed status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
    if (url === '/api/user/stats') {
      return Promise.resolve({ ok: true, json: async () => ({ planExpiresAt: '2027-01-15T09:30:00.000Z', planActive: true }) });
    }
    if (url === '/api/paddle/billing') {
      return Promise.resolve({ ok: true, json: async () => ({
        account: { status: 'active', paidThroughAt: '2027-01-15T09:30:00.000Z', nextChargeAt: '2027-01-15T09:30:00.000Z', cancelAtPeriodEnd: false },
        transactions: [],
      }) });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ status: 'cancellation_requested' }),
    });
  }));
  render(<SettingsClient />);

  fireEvent.click(await screen.findByRole('button', { name: 'Cancel at period end' }));

  expect(await screen.findByText('Cancellation is confirmed for the end of your paid period.')).toBeInTheDocument();
  expect(screen.getByText('Scheduled for the end of the paid period')).toBeInTheDocument();
  expect(screen.getByText('Access until')).toBeInTheDocument();
});

it('renders sign out for an authenticated user', async () => {
  stubFetch({});
  render(<SettingsClient />);
  expect(await screen.findByRole('button', { name: 'Sign out' })).toBeInTheDocument();
});

describe('humanized billing vocabulary', () => {
  it('maps provider states to user-facing wording', async () => {
    const { humanizeAccountStatus, humanizeTransactionStatus } = await import('@/hooks/useAccountBilling');
    expect(humanizeAccountStatus('past_due').label).toBe('Payment needs attention');
    expect(humanizeAccountStatus('payment_failed').label).toBe('Payment needs attention');
    expect(humanizeAccountStatus('active').label).toBe('Active');
    expect(humanizeAccountStatus(null).label).toBe('Free');
    expect(humanizeTransactionStatus('paid')).toBe('Paid');
    expect(humanizeTransactionStatus('past_due')).toBe('Payment failed');
    // The raw provider string must never pass through untouched for account status.
    expect(humanizeAccountStatus('some_new_state').label).not.toBe('some_new_state');
  });
});
