import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Purchase == renewal. A one-time plan has no auto-renewal, so the only way to
 * keep access is to buy another term — the sheet must let an active subscriber
 * do that instead of showing a disabled "Current Plan" button, and it must say
 * that the purchase extends the term rather than starting a new one.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: vi.fn() }),
}));

vi.mock('@/lib/cashfree', () => ({
  resolveCashfreeMode: () => null,
  loadCashfreeSDK: () => Promise.resolve({}),
}));

vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return { ...actual, detectCountry: vi.fn(async () => 'US') };
});

import { PricingModal } from '@/components/dialogs/PricingModal';

const noop = () => {};

async function renderPricing(userPlan?: string) {
  render(
    <PricingModal
      isOpen
      onClose={noop}
      showToast={vi.fn()}
      isAuthenticated
      userPlan={userPlan}
    />,
  );
  await waitFor(() =>
    expect(screen.queryByRole('status', { name: 'Loading prices' })).toBeNull(),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PricingModal — renewing an active plan', () => {
  it('offers an extension instead of a disabled "Current Plan" button', async () => {
    await renderPricing('creator_yearly');

    const cta = screen.getByRole('button', { name: /Extend by 1 month/ });
    expect(cta).toBeEnabled();
    expect(cta.textContent).toContain('$7.99');
    expect(screen.queryByRole('button', { name: 'Current Plan' })).toBeNull();
    // The card still identifies the plan the viewer holds.
    expect(screen.getByText('Current Plan')).toBeInTheDocument();
  });

  it('says the purchase adds a term to the existing access', async () => {
    await renderPricing('creator_monthly');

    expect(
      screen.getByText(/Extends your access by 1 month from its current end date/),
    ).toBeInTheDocument();
  });

  it('extends by a year when the yearly term is selected', async () => {
    await renderPricing('creator_monthly');

    fireEvent.click(screen.getByRole('button', { name: /^1 year/ }));

    const cta = screen.getByRole('button', { name: /Extend by 1 year/ });
    expect(cta.textContent).toContain('$59.99');
  });

  it('continues into the payment form from an extension', async () => {
    await renderPricing('creator_yearly');

    fireEvent.click(screen.getByRole('button', { name: /Extend by 1 month/ }));

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Complete Payment' })).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/One-time payment for 1 month of access in USD/),
    ).toBeInTheDocument();
  });

  it('keeps a normal purchase for a free user, with the free card unselectable', async () => {
    await renderPricing('free');

    expect(screen.getByRole('button', { name: /Pay once for/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Extend by/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Free' }).closest('button')).toBeDisabled();
  });
});
