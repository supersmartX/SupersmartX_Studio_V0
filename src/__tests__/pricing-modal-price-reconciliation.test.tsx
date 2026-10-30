import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The sheet prices from a third-party IP lookup (with a week-long cache); the
 * order is priced from the platform's geo header. A VPN, a different geo
 * database or a stale cache puts the two at odds, and the charge always
 * follows the server. The customer must therefore see the price they will
 * actually pay — and accept it — before any checkout starts.
 *
 * The real pricing module runs here (no mock), so the displayed price comes
 * from the same cache `detectCountry()` reads in production.
 */

const sdk = vi.hoisted(() => ({ checkout: vi.fn(async () => ({})) }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: vi.fn() }),
}));

vi.mock('@/lib/cashfree', () => ({
  resolveCashfreeMode: () => 'sandbox',
  loadCashfreeSDK: () => Promise.resolve(sdk),
}));

import { PricingModal } from '@/components/dialogs/PricingModal';

const STORAGE_KEY = 'sxs-pricing-region';
const onClose = vi.fn();
const showToast = vi.fn();

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    orderId: 'sxs-price-1',
    paymentSessionId: 'ps-price-1',
    env: 'sandbox',
    amount: 7.99,
    currency: 'USD',
    country: 'US',
    ...overrides,
  };
}

function stubOrderResponse(body: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn(async () =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Opens the sheet on the payment form with a known cached region, so the geo
 * lookup resolves without any network call. `ageDays` > 0 reproduces a cache
 * entry that is still inside its 7-day TTL but no longer describes the visit.
 */
async function openPaymentForm(seed: { country: string; ageDays?: number; billing?: 'monthly' | 'yearly' }) {
  localStorage.clear();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ country: seed.country, detectedAt: Date.now() - (seed.ageDays ?? 0) * 86_400_000 }),
  );

  render(
    <PricingModal isOpen onClose={onClose} showToast={showToast} isAuthenticated />,
  );
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prices' })).toBeNull());

  if (seed.billing === 'yearly') {
    fireEvent.click(screen.getByRole('button', { name: /^1 year/ }));
  }
  fireEvent.click(screen.getByRole('button', { name: /Pay once for/ }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Complete Payment' })).toBeTruthy());

  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'buyer@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('+919999999999'), { target: { value: '+919999999999' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));
}

beforeEach(() => {
  sdk.checkout.mockReset();
  sdk.checkout.mockResolvedValue({});
  showToast.mockClear();
  onClose.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('PricingModal — the server’s amount is the amount charged', () => {
  it('asks before charging a different price than the visitor was shown (VPN / geo disagreement)', async () => {
    // Sheet resolved India (₹349); the order was priced for the US.
    stubOrderResponse(orderPayload());

    await openPaymentForm({ country: 'IN' });

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());
    expect(sdk.checkout).not.toHaveBeenCalled();

    expect(screen.getByText(/We showed ₹349/)).toBeInTheDocument();
    expect(screen.getByText('$7.99')).toBeInTheDocument();
    expect(screen.getByText(/No payment has been taken yet/)).toBeInTheDocument();
  });

  it('checks out with the authoritative order once the customer accepts', async () => {
    stubOrderResponse(orderPayload());

    await openPaymentForm({ country: 'IN' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Accept and pay \$7\.99/ }));

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    expect(sdk.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'ps-price-1',
        redirectTarget: '_self',
        returnUrl: expect.stringContaining('order_id=sxs-price-1'),
      }),
    );
    expect(showToast).toHaveBeenCalledWith('Redirecting to payment...');
  });

  it('does not charge when the customer cancels the confirmation', async () => {
    stubOrderResponse(orderPayload());

    await openPaymentForm({ country: 'IN' });
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(sdk.checkout).not.toHaveBeenCalled();
  });

  it('re-quotes a price that came from a cache entry inside its TTL (stale region)', async () => {
    // Six days old: still served by getCachedCountry(), and the visitor has
    // since moved — the cached UK price is no longer what the server charges.
    stubOrderResponse(orderPayload());

    await openPaymentForm({ country: 'GB', ageDays: 6 });

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());
    expect(sdk.checkout).not.toHaveBeenCalled();
    expect(screen.getByText(/We showed £6\.49/)).toBeInTheDocument();
    expect(screen.getByText('$7.99')).toBeInTheDocument();
  });

  it('treats the same figure in another currency as a different price', async () => {
    // 7.99 USD displayed; 7.99 EUR is what the order would charge.
    stubOrderResponse(orderPayload({ amount: 7.99, currency: 'EUR', country: 'DE' }));

    await openPaymentForm({ country: 'US' });

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());
    expect(sdk.checkout).not.toHaveBeenCalled();
    expect(screen.getByText('€7.99')).toBeInTheDocument();
  });

  it('checks out directly for a country with no table when the US fallback matches the server', async () => {
    // The sheet falls back to the US table for an unknown country, and the
    // server prices the default region — no difference, no interruption.
    stubOrderResponse(orderPayload());

    await openPaymentForm({ country: 'ZZ' });

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Confirm Price' })).toBeNull();
  });

  it('keeps the annual purchase one-click when the server agrees', async () => {
    stubOrderResponse(orderPayload({ amount: 59.99, currency: 'USD' }));

    await openPaymentForm({ country: 'US', billing: 'yearly' });

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    expect(sdk.checkout).toHaveBeenCalledWith(
      expect.objectContaining({ paymentSessionId: 'ps-price-1' }),
    );
    expect(screen.queryByRole('dialog', { name: 'Confirm Price' })).toBeNull();
  });

  it('refuses checkout when the order response carries no readable amount', async () => {
    stubOrderResponse({ orderId: 'sxs-price-2', paymentSessionId: 'ps-price-2', env: 'sandbox', currency: 'USD' });

    await openPaymentForm({ country: 'US' });

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Error' })).toBeTruthy());
    expect(sdk.checkout).not.toHaveBeenCalled();
  });

  it('still refuses an order created in the other Cashfree environment', async () => {
    stubOrderResponse(orderPayload({ env: 'production' }));

    await openPaymentForm({ country: 'US' });

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Error' })).toBeTruthy());
    expect(sdk.checkout).not.toHaveBeenCalled();
  });
});
