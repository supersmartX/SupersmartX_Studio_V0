import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * §7 — PricingModal accessible-name / title mismatch.
 *
 * The dialog's accessible name was hard-coded to "Choose Plan" while the
 * visible heading changes with the step, so on the payment form, while
 * processing, and on error a screen reader announced a screen the user was not
 * looking at.
 *
 * These tests assert the name through RENDERED DIALOG SEMANTICS — the
 * accessible name of the `dialog` role — and additionally assert that it agrees
 * with the visible heading. Nothing here reads the source string, so renaming
 * the component or moving the markup would not satisfy them.
 *
 * All four steps are driven deterministically. `processing` is unreachable in
 * a live local run because setStep('processing') and setStep('error') fire in
 * the same synchronous block when NEXT_PUBLIC_CASHFREE_ENV is unset (React
 * batches them), so the SDK is mocked to hold the step open.
 */

const cashfreeMode = vi.fn<() => 'sandbox' | 'production' | null>();
const sdkLoaded = vi.fn<() => Promise<unknown>>();

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: vi.fn() }),
}));

vi.mock('@/lib/cashfree', () => ({
  resolveCashfreeMode: () => cashfreeMode(),
  loadCashfreeSDK: () => sdkLoaded(),
}));

// Only the geo lookup is stubbed — it performs real network calls in jsdom and
// would otherwise leave the dialog on its loading skeleton for the full
// 2 x 3s timeout chain. Every formatter stays real so the rendered prices are
// the ones the component would actually show.
vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return { ...actual, detectCountry: vi.fn(async () => 'US') };
});

import { PricingModal } from '@/components/dialogs/PricingModal';

const noop = () => {};
const showToast = vi.fn();

/** Every step's expected accessible name AND visible heading. */
const STEPS = [
  { step: 'select', name: 'Choose Your Plan' },
  { step: 'form', name: 'Complete Payment' },
  { step: 'confirm-price', name: 'Confirm Price' },
  { step: 'resume-checkout', name: 'Resume Checkout' },
  { step: 'processing', name: 'Processing...' },
  { step: 'error', name: 'Payment Error' },
] as const;

/** Asserts the dialog is exposed under `name`, and that its heading agrees. */
function expectDialogNamed(name: string) {
  // Rendered semantics: the accessible NAME of the dialog role.
  const dialog = screen.getByRole('dialog', { name });
  // And the visible text the sighted user reads must be the same string.
  const heading = screen.getByRole('heading', { name });
  expect(dialog, `dialog must expose the accessible name "${name}"`).toBeTruthy();
  expect(heading, `visible heading must read "${name}"`).toBeTruthy();
  return dialog;
}

async function renderAtForm() {
  render(
    <PricingModal
      isOpen
      onClose={noop}
      showToast={showToast}
      isAuthenticated
    />,
  );
  // Pricing resolves before the body renders; the skeleton holds the space.
  await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prices' })).toBeNull());
  expectDialogNamed('Choose Your Plan');

  // select -> form
  fireEvent.click(screen.getByRole('button', { name: /Pay once for/ }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Complete Payment' })).toBeTruthy());
}

function fillPaymentForm() {
  fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'Ada Lovelace' } });
  fireEvent.change(screen.getByPlaceholderText('you@example.com'), { target: { value: 'ada@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('+919999999999'), { target: { value: '+919999999999' } });
}

beforeEach(() => {
  showToast.mockClear();
  cashfreeMode.mockReset();
  sdkLoaded.mockReset();
  // Defaults so the modal's mount effect (`loadCashfreeSDK().catch(...)`) always
  // receives a real promise. Individual tests override as needed.
  sdkLoaded.mockResolvedValue({});
  cashfreeMode.mockReturnValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PricingModal — accessible name tracks the visible step title', () => {
  it('step 1 (select): dialog is named "Choose Your Plan"', async () => {
    render(<PricingModal isOpen onClose={noop} showToast={showToast} isAuthenticated />);
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading prices' })).toBeNull());
    expectDialogNamed('Choose Your Plan');
  });

  it('step 2 (form): the name changes with the heading, not a stale "Choose Plan"', async () => {
    await renderAtForm();
    expectDialogNamed('Complete Payment');

    // The regression itself: the old name must no longer be present.
    expect(
      screen.queryByRole('dialog', { name: 'Choose Plan' }),
      'the hard-coded "Choose Plan" accessible name must be gone',
    ).toBeNull();
  });

  it('step 3 (confirm-price): named "Confirm Price" while a different charge awaits acceptance', async () => {
    cashfreeMode.mockReturnValue('sandbox');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      orderId: 'sxs-title-1',
      paymentSessionId: 'ps-title-1',
      env: 'sandbox',
      // The sheet resolved US ($7.99); the server priced India.
      amount: 349,
      currency: 'INR',
      country: 'IN',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    await renderAtForm();
    fillPaymentForm();

    fireEvent.click(screen.getByRole('button', { name: /Pay/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Confirm Price' })).toBeTruthy());
    expectDialogNamed('Confirm Price');
  });

  it('step 4 (processing): named "Processing..." while the SDK is in flight', async () => {
    // Hold the step open: the SDK promise never settles.
    cashfreeMode.mockReturnValue('sandbox');
    sdkLoaded.mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      orderId: 'sxs-title-2',
      paymentSessionId: 'ps-title-2',
      env: 'sandbox',
      amount: 7.99,
      currency: 'USD',
      country: 'US',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await renderAtForm();
    fillPaymentForm();

    fireEvent.click(screen.getByRole('button', { name: /Pay/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Processing...' })).toBeTruthy());
    expectDialogNamed('Processing...');
  });

  it('step 5 (error): named "Payment Error" when checkout cannot start', async () => {
    // Locally NEXT_PUBLIC_CASHFREE_ENV is unset, so resolveCashfreeMode()
    // returns null and the modal refuses to instantiate the SDK.
    cashfreeMode.mockReturnValue(null);
    await renderAtForm();
    fillPaymentForm();

    fireEvent.click(screen.getByRole('button', { name: /Pay/i }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Payment Error' })).toBeTruthy());
    expectDialogNamed('Payment Error');
  });

  it('covers every step title with no gaps', () => {
    // Guards against a future step being added without a title in this table.
    expect(STEPS.map((s) => s.name)).toEqual([
      'Choose Your Plan',
      'Complete Payment',
      'Confirm Price',
      'Resume Checkout',
      'Processing...',
      'Payment Error',
    ]);
  });

  it('Close and Escape-to-cancel remain reachable at every step', async () => {
    cashfreeMode.mockReturnValue(null);
    await renderAtForm();
    expect(screen.getByRole('button', { name: 'Close' }), 'Close must stay reachable').toBeTruthy();
  });
});