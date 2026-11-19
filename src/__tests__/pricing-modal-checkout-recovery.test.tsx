import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  assign: vi.fn(),
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } },
    status: 'authenticated',
  }),
}));

vi.mock('@/hooks/useRegionalPricing', () => ({
  useRegionalPricing: () => ({
    pricing: {
      symbol: '₹',
      locale: 'en-IN',
      currency: 'INR',
      creatorMonthly: 349,
      creatorYearly: 2899,
      freeMonthly: 0,
      freeYearly: 0,
    },
    isLoading: false,
  }),
}));

vi.mock('@/hooks/useModalAnimation', () => ({
  useModalAnimation: (isOpen: boolean, onClose: () => void) => ({
    isClosing: false,
    shouldRender: isOpen,
    handleClose: onClose,
    swipeHandlers: {},
  }),
}));

import { PricingModal } from '@/components/dialogs/PricingModal';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mocks.fetch);
  vi.stubGlobal('crypto', {
    subtle: {
      digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
    },
  });
  vi.stubGlobal('location', { assign: mocks.assign });
});

describe('PricingModal checkout recovery', () => {
  it('shows recurring monthly and yearly prices without a trial or one-time-purchase claim', async () => {
    render(
      <PricingModal
        isOpen
        onClose={vi.fn()}
        showToast={vi.fn()}
        userPlan="free"
        isAuthenticated
      />,
    );

    expect(await screen.findByText('Renews every month until canceled.')).toBeInTheDocument();
    expect(screen.getByText('₹349')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /1 year/ }));

    expect(await screen.findByText('Renews every 12 months until canceled.')).toBeInTheDocument();
    expect(screen.getByText('₹2,899')).toBeInTheDocument();
    expect(screen.queryByText(/trial|one-time payment/i)).toBeNull();
  });

  it('lets a user check a reservation after an uncertain checkout response', async () => {
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          plan: 'creator_monthly',
          period: 'monthly',
          amount: 349,
          currency: 'INR',
        }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Checkout creation outcome is uncertain; do not retry.',
          reservationId: 'reservation-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'pending',
          retryAllowed: false,
          checkoutUrl: null,
          message: 'Payment access updates only after Paddle verifies the payment. Check again shortly.',
        }),
      });

    render(
      <PricingModal
        isOpen
        onClose={vi.fn()}
        showToast={vi.fn()}
        isAuthenticated
        initialTier="creator"
        initialBillingPeriod="monthly"
        initialStep="form"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Continue to Payment' }));

    expect(await screen.findByRole('button', { name: 'Check checkout status' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Check checkout status' }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    expect(await screen.findByText(/Payment access updates only after Paddle verifies/)).toBeInTheDocument();
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});
