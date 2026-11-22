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

const quote = {
  plan: 'creator_monthly',
  period: 'monthly',
  country: 'IN',
  amount: 349,
  currency: 'INR',
  quoteToken: 'signed-quote-token',
  expiresAt: '2026-11-18T12:15:00.000Z',
};

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

describe('PricingModal checkout', () => {
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

  it('has no intermediate payment form', async () => {
    render(
      <PricingModal
        isOpen
        onClose={vi.fn()}
        showToast={vi.fn()}
        isAuthenticated
        initialTier="creator"
        initialBillingPeriod="monthly"
      />,
    );

    await screen.findByRole('button', { name: /^Subscribe/ });
    expect(screen.queryByLabelText('Full Name')).toBeNull();
    expect(screen.queryByLabelText('Email Address')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue to Payment' })).toBeNull();
    expect(screen.queryByText('Complete Payment')).toBeNull();
  });

  it('sends only the signed consent and redirects to the Paddle checkout URL', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => quote })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          reservationId: 'reservation-1',
          providerOperationId: 'txn-1',
          transactionId: 'txn-1',
          checkoutUrl: 'https://studio.example.com/pay?_ptxn=txn-1',
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
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe/ }));

    await waitFor(() => expect(mocks.assign).toHaveBeenCalledWith(
      'https://studio.example.com/pay?_ptxn=txn-1',
    ));
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][0]).toBe('/api/paddle/quote');
    expect(mocks.fetch.mock.calls[1][0]).toBe('/api/paddle/checkout');
    const body = JSON.parse(mocks.fetch.mock.calls[1][1].body as string);
    expect(body).toMatchObject({
      plan: 'creator_monthly',
      period: 'monthly',
      amount: 349,
      currency: 'INR',
      consentVersion: '2',
      quoteToken: 'signed-quote-token',
    });
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('name');
  });

  it('offers a status check instead of a retry when the outcome is unknown', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => quote })
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
          message: 'Payment access updates only after Paddle verifies the payment.',
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
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe/ }));

    expect(await screen.findByText("We're checking your payment")).toBeInTheDocument();
    expect(screen.getByText(/Please don't try another payment/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    // The backend explanation is never rendered.
    expect(screen.queryByText(/Checkout creation outcome is uncertain/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Check checkout status' }));

    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(3));
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(await screen.findByText("We're checking your payment")).toBeInTheDocument();
  });

  it('does not close or claim payment when checkout recovery finds a paid transaction', async () => {
    const onClose = vi.fn();
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => quote })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({
          state: 'payment_verification_pending',
          reservationId: 'reservation-paid',
          transactionId: 'txn-paid',
          retryAllowed: false,
          checkoutUrl: null,
        }),
      });

    render(
      <PricingModal
        isOpen
        onClose={onClose}
        showToast={vi.fn()}
        isAuthenticated
        initialTier="creator"
        initialBillingPeriod="monthly"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe/ }));

    expect(await screen.findByText("We're checking your payment")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.assign).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Check checkout status' })).toBeInTheDocument();
  });

  it('reports a verified dead attempt as not completed and allows another try', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => quote })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({
          error: 'Checkout creation outcome is uncertain; do not retry.',
          reservationId: 'reservation-1',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'failed', retryAllowed: true, checkoutUrl: null }),
      });

    render(
      <PricingModal
        isOpen
        onClose={vi.fn()}
        showToast={vi.fn()}
        isAuthenticated
        initialTier="creator"
        initialBillingPeriod="monthly"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Check checkout status' }));

    expect(await screen.findByText("Payment wasn't completed")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('uses plain-language copy for a temporary checkout failure', async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Internal' }) });

    render(
      <PricingModal
        isOpen
        onClose={vi.fn()}
        showToast={vi.fn()}
        isAuthenticated
        initialTier="creator"
        initialBillingPeriod="monthly"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe/ }));

    expect(await screen.findByText("We couldn't start checkout")).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong while connecting to our payment provider/)).toBeInTheDocument();
    expect(screen.queryByText(/Internal|503|500/)).toBeNull();
    expect(mocks.assign).not.toHaveBeenCalled();
  });

  it('reports an unavailable plan without offering an immediate retry', async () => {
    mocks.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => quote })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Paddle sandbox price is not configured' }),
      });

    render(
      <PricingModal
        isOpen
        onClose={vi.fn()}
        showToast={vi.fn()}
        isAuthenticated
        initialTier="creator"
        initialBillingPeriod="monthly"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /^Subscribe/ }));

    expect(await screen.findByText('This plan is temporarily unavailable')).toBeInTheDocument();
    expect(screen.getByText(/We're unable to process this subscription right now/)).toBeInTheDocument();
    expect(screen.queryByText(/Paddle sandbox price/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});
