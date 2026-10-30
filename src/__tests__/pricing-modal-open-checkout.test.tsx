import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/**
 * A cancelled confirmation and a failed payment page are not the same event,
 * and neither may end in a dead end.
 *
 * Creating an order is what makes it payable, so cancelling the price
 * confirmation (or the payment page dying) leaves a live order behind. The
 * server correctly refuses to create a second one for an hour — which used to
 * surface as "an earlier checkout is still in progress, complete or cancel it",
 * advice the buyer could not act on, because both handles to that order were
 * discarded when the sheet closed.
 *
 * The contract under test:
 *   - a price the buyer *declined* is never resumed without asking again;
 *   - a checkout they *accepted* is offered back as the same session;
 *   - a session the payment page rejects is forgotten, never retried blindly;
 *   - when neither is possible, the dialog says when a new payment becomes
 *     possible instead of telling the buyer to cancel something.
 */

const sdk = vi.hoisted(() => ({ checkout: vi.fn(async () => ({} as { error?: { message: string } })) }));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: vi.fn() }),
}));

vi.mock('@/lib/cashfree', () => ({
  resolveCashfreeMode: () => 'sandbox',
  loadCashfreeSDK: () => Promise.resolve(sdk),
}));

import { PricingModal } from '@/components/dialogs/PricingModal';

const STORAGE_KEY = 'sxs-pricing-region';
const OPEN_CHECKOUT_KEY = 'sxs-open-checkout';

const showToast = vi.fn();

type StubResponse = { status: number; body: Record<string, unknown> };

let responses: StubResponse[] = [];
let orderPosts = 0;

/** Answers the order POST from `responses`, in call order. */
function stubOrderApi() {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const target = String(url);
    if (target.includes('/api/cashfree/order') && (init?.method ?? 'GET') === 'POST') {
      orderPosts += 1;
      const next = responses[Math.min(orderPosts - 1, responses.length - 1)];
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The 409 the order route answers with while an earlier checkout is open. */
function openOrder(overrides: Record<string, unknown> = {}): StubResponse {
  return {
    status: 409,
    body: {
      error: 'An earlier checkout is still open. You can resume it now, or start a new payment in about 30 minutes.',
      code: 'pending_order_open',
      orderId: 'sxs-open-1',
      paymentSessionId: 'ps-open-1',
      amount: 9.99,
      currency: 'USD',
      plan: 'creator_monthly',
      status: 'ACTIVE',
      retryAfterSeconds: 1800,
      ...overrides,
    },
  };
}

/** A freshly created order the sheet will hand straight to Cashfree. */
function createdOrder(overrides: Record<string, unknown> = {}): StubResponse {
  return {
    status: 200,
    body: {
      orderId: 'sxs-new-1',
      paymentSessionId: 'ps-new-1',
      env: 'sandbox',
      amount: 7.99,
      currency: 'USD',
      country: 'US',
      ...overrides,
    },
  };
}

function bodyCopy() {
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function renderSheet() {
  const onClose = vi.fn();
  const utils = render(<PricingModal isOpen onClose={onClose} showToast={showToast} isAuthenticated />);
  return { ...utils, onClose };
}

/** Advance from the plan list to a filled payment form. */
async function openPaymentForm() {
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prices' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: /Pay once for/ }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Complete Payment' })).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'buyer@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('+919999999999'), { target: { value: '+919999999999' } });
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Continue to Payment' }));
}

function storedCheckout() {
  const raw = sessionStorage.getItem(OPEN_CHECKOUT_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
  responses = [];
  orderPosts = 0;
  sdk.checkout.mockReset();
  sdk.checkout.mockResolvedValue({});
  showToast.mockClear();
  localStorage.clear();
  sessionStorage.clear();
  // A resolved region keeps detectCountry() off the network; the sheet prices
  // Creator monthly at $7.99 and yearly at $59.99, as the US table does.
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ country: 'US', detectedAt: Date.now() }));
  stubOrderApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe('a declined price confirmation is not silently resumed', () => {
  it('asks again before opening the checkout the buyer cancelled', async () => {
    // First visit: the server quotes a price the sheet did not show, so the
    // buyer is asked — and cancels.
    responses = [createdOrder({ orderId: 'sxs-open-1', paymentSessionId: 'ps-open-1', amount: 9.99 })];
    const first = renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());
    expect(sdk.checkout).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(first.onClose).toHaveBeenCalled());
    first.unmount();

    // The order is still live, and the browser remembers it was never accepted.
    expect(storedCheckout()).toMatchObject({ orderId: 'sxs-open-1', accepted: false });

    // Second visit: the retry collides with that order.
    responses = [openOrder()];
    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Resume Checkout' })).toBeTruthy());
    expect(screen.getByText('You have an unfinished checkout')).toBeInTheDocument();
    // Not "resume": the price was refused last time, so it must be accepted
    // again before a payment page opens.
    expect(screen.getByRole('button', { name: 'Accept and pay $9.99' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Resume payment/ })).toBeNull();
    expect(sdk.checkout).not.toHaveBeenCalled();
  });

  it('resumes that same order once the buyer accepts it, without creating another', async () => {
    responses = [openOrder()];
    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Resume Checkout' })).toBeTruthy());
    const postsBeforeAccept = orderPosts;

    fireEvent.click(screen.getByRole('button', { name: 'Accept and pay $9.99' }));

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    expect(sdk.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'ps-open-1',
        returnUrl: expect.stringContaining('order_id=sxs-open-1'),
      }),
    );
    // The existing order was reused: no second order was created or charged.
    expect(orderPosts).toBe(postsBeforeAccept);
  });
});

describe('an accepted checkout that failed is offered back as itself', () => {
  it('offers the same payment session after the payment page could not open', async () => {
    // The price matched, the buyer accepted it, and the payment page failed.
    responses = [createdOrder({ orderId: 'sxs-open-2', paymentSessionId: 'ps-open-2' })];
    sdk.checkout.mockRejectedValueOnce(new Error('network down'));

    const first = renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Error' })).toBeTruthy());
    // The order exists and its price was accepted — that is what makes it
    // resumable rather than something to re-negotiate.
    expect(storedCheckout()).toMatchObject({
      orderId: 'sxs-open-2',
      paymentSessionId: 'ps-open-2',
      amount: 7.99,
      accepted: true,
    });
    first.unmount();

    responses = [
      openOrder({ orderId: 'sxs-open-2', paymentSessionId: 'ps-open-2', amount: 7.99, currency: 'USD' }),
    ];
    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Resume Checkout' })).toBeTruthy());
    expect(screen.getByText('Finish your earlier checkout')).toBeInTheDocument();
    // Distinct from the declined case: this price was already accepted.
    expect(screen.getByRole('button', { name: 'Resume payment $7.99' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Resume payment $7.99' }));
    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(2));
    expect(sdk.checkout).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentSessionId: 'ps-open-2' }),
    );
    expect(orderPosts).toBe(2);
  });

  it('forgets a session the payment page refuses instead of resuming it again', async () => {
    // A recorded acceptance for a session that has since expired.
    sessionStorage.setItem(
      OPEN_CHECKOUT_KEY,
      JSON.stringify({
        orderId: 'sxs-open-3',
        paymentSessionId: 'ps-dead',
        amount: 7.99,
        currency: 'USD',
        plan: 'creator_monthly',
        accepted: true,
      }),
    );
    responses = [
      openOrder({ orderId: 'sxs-open-3', paymentSessionId: 'ps-dead', amount: 7.99 }),
      createdOrder({ orderId: 'sxs-new-9', paymentSessionId: 'ps-new-9' }),
    ];
    sdk.checkout.mockResolvedValueOnce({ error: { message: 'Payment session expired' } });

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume payment $7.99' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Resume payment $7.99' }));

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Error' })).toBeTruthy());
    expect(bodyCopy()).toContain('Payment session expired');
    // The dead session is forgotten, so the next attempt re-quotes instead of
    // looping on it.
    expect(storedCheckout()).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Complete Payment' })).toBeTruthy());
    submit();

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(2));
    expect(sdk.checkout).toHaveBeenLastCalledWith(
      expect.objectContaining({ paymentSessionId: 'ps-new-9' }),
    );
    // A fresh order was created — the expired session was never handed over twice.
    expect(orderPosts).toBe(2);
  });
});

describe('when the open checkout cannot be reused, the dialog says when it lifts', () => {
  it('explains a block it cannot resume and names the wait instead of "cancel it"', async () => {
    // The open order is for the annual plan; this sheet wants monthly.
    responses = [
      openOrder({
        orderId: 'sxs-open-year',
        paymentSessionId: 'ps-open-year',
        amount: 59.99,
        plan: 'creator_yearly',
        retryAfterSeconds: 1500,
      }),
    ];

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Resume Checkout' })).toBeTruthy());
    expect(screen.getByText('An earlier checkout is still open')).toBeInTheDocument();
    expect(bodyCopy()).toMatch(/The checkout that is still open is for Creator Yearly, not the plan you selected here/);
    // The wait is stated in the buyer's terms: 1500 s rounds up to 25 minutes.
    expect(bodyCopy()).toMatch(/blocks a new payment for about 25 minutes/);
    // Nothing to pay here, and no instruction the buyer cannot perform.
    expect(screen.queryByRole('button', { name: /Accept and pay|Resume payment/ })).toBeNull();
    expect(bodyCopy()).not.toMatch(/Complete or cancel it/);
    expect(sdk.checkout).not.toHaveBeenCalled();
  });

  it('does not offer to resume an order the payment service already settled', async () => {
    responses = [openOrder({ status: 'PAID', amount: 7.99 })];

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Received' })).toBeTruthy());
    expect(screen.getByText('Your earlier payment is being confirmed')).toBeInTheDocument();
    expect(bodyCopy()).toMatch(/We have received your payment of \$7\.99 for Creator Monthly/);
    expect(bodyCopy()).toMatch(/as soon as the confirmation reaches our servers/);
    expect(bodyCopy()).toMatch(/There is nothing more to pay/);
    // Opening the payment page for a paid order would fail at Cashfree.
    expect(screen.queryByRole('button', { name: /Accept and pay|Resume payment/ })).toBeNull();
    expect(sdk.checkout).not.toHaveBeenCalled();
  });

  it('closes cleanly from the block', async () => {
    responses = [openOrder({ plan: 'creator_yearly' })];

    const { onClose } = renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe("the browser's memory never overrides the order the server reports", () => {
  function rememberAccepted(overrides: Record<string, unknown> = {}) {
    sessionStorage.setItem(
      OPEN_CHECKOUT_KEY,
      JSON.stringify({
        orderId: 'sxs-open-1',
        paymentSessionId: 'ps-stale',
        amount: 9.99,
        currency: 'USD',
        plan: 'creator_monthly',
        accepted: true,
        ...overrides,
      }),
    );
  }

  it('ignores an acceptance recorded for a different order, and prices the new one from the server', async () => {
    rememberAccepted({ orderId: 'sxs-stale-9', paymentSessionId: 'ps-stale', amount: 7.99 });
    responses = [openOrder({ orderId: 'sxs-open-1', paymentSessionId: 'ps-open-1', amount: 9.99 })];

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Resume Checkout' })).toBeTruthy());
    // The stale acceptance belongs to an order this retry is not about.
    expect(screen.queryByRole('button', { name: /^Resume payment/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Accept and pay $9.99' })).toBeInTheDocument();
    // Nothing about the stale order is on screen: the charge shown is the
    // server's, not the one from memory.
    expect(bodyCopy()).not.toContain('$7.99');
  });

  it('rejects a record whose amount no longer matches the open order', async () => {
    rememberAccepted({ amount: 7.99 });
    responses = [openOrder({ amount: 9.99, currency: 'USD' })];

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept and pay $9.99' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Resume payment/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Accept and pay $9.99' }));
    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    // The payload comes from the 409 too — the remembered session is never used.
    expect(sdk.checkout).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentSessionId: 'ps-open-1',
        returnUrl: expect.stringContaining('order_id=sxs-open-1'),
      }),
    );
  });

  it('rejects a record whose currency differs even when the figure is the same', async () => {
    rememberAccepted({ amount: 9.99, currency: 'EUR' });
    responses = [openOrder({ amount: 9.99, currency: 'USD' })];

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept and pay $9.99' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^Resume payment/ })).toBeNull();
  });

  it('does not resume a paid order even when this tab recorded accepting it', async () => {
    // The webhook has not landed, so the plan is not on the account yet — but
    // the payment went through, so there is nothing left to pay.
    rememberAccepted({ amount: 9.99, paymentSessionId: 'ps-open-1' });
    responses = [openOrder({ status: 'PAID', amount: 9.99 })];

    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Received' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: /^(Resume payment|Accept and pay)/ })).toBeNull();
    expect(bodyCopy()).toMatch(/There is nothing more to pay/);
    expect(sdk.checkout).not.toHaveBeenCalled();
    expect(orderPosts).toBe(1);
  });
});

describe('a submission is never handled twice', () => {
  it('posts one order when the submit button is activated twice', async () => {
    responses = [createdOrder()];
    renderSheet();
    await openPaymentForm();

    const cta = screen.getByRole('button', { name: 'Continue to Payment' });
    await act(async () => {
      // Two dispatches before React re-renders, as a double tap produces.
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    expect(orderPosts).toBe(1);
  });

  it('opens the payment page once when resume is activated twice', async () => {
    responses = [openOrder()];
    renderSheet();
    await openPaymentForm();
    submit();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Accept and pay $9.99' })).toBeInTheDocument());
    const cta = screen.getByRole('button', { name: 'Accept and pay $9.99' });
    await act(async () => {
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      cta.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await waitFor(() => expect(sdk.checkout).toHaveBeenCalledTimes(1));
    expect(orderPosts).toBe(1);
  });
});
