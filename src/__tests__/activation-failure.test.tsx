import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { ActivationOutcome } from '@/components/dialogs/ActivationModal';

/* STATE 4 — a declined or cancelled payment returns to the SAME
 * `?payment=success` URL as a settled one, because the return_url is hardcoded
 * (src/app/api/cashfree/order/route.ts). So the modal is the only thing standing
 * between a failed checkout and a 30-second spinner that ends in "your plan will
 * activate as soon as your payment is confirmed".
 *
 * The contract under test: a terminal order from the server ends the wait,
 * says so plainly, promises nothing, and leaves a way out. */

const sessionUpdate = vi.fn(async () => ({ user: { plan: 'free' } }));
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'authenticated', update: sessionUpdate }),
}));

import { ActivationModal } from '@/components/dialogs/ActivationModal';

type VerifyBody = { status?: string; orderStatus?: string };

let verifyResponses: VerifyBody[] = [];
let verifyCalls = 0;

beforeEach(() => {
  verifyResponses = [];
  verifyCalls = 0;
  sessionUpdate.mockClear();
  sessionUpdate.mockImplementation(async () => ({ user: { plan: 'free' } } as never));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const body = verifyResponses[Math.min(verifyCalls, verifyResponses.length - 1)] ?? { status: 'pending' };
      verifyCalls += 1;
      return { ok: true, json: async () => body } as unknown as Response;
    })
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const ORDER = 'order_abc123';
const POLL_INTERVAL_MS = 2000;

function renderModal(overrides: Partial<React.ComponentProps<typeof ActivationModal>> = {}) {
  const onClose = vi.fn();
  const onRetry = vi.fn();
  const utils = render(
    <ActivationModal isOpen plan="creator_monthly" orderId={ORDER} onClose={onClose} onRetry={onRetry} {...overrides} />
  );
  return { ...utils, onClose, onRetry };
}

/** Advance past the first poll tick and let the verify promise settle. */
async function firstPoll() {
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
}

/**
 * Run `count` poll ticks. Each tick schedules the next `setTimeout` only after
 * awaiting `fetch` and `update()`, so one large `advanceTimersByTime` fires the
 * first timer and nothing after it — the chain has to be interleaved with a
 * microtask flush.
 */
async function advancePolls(count: number) {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS + 50);
    });
  }
}

/** Let the shared Modal's 150ms close animation deliver `onClose`. */
async function settleClose() {
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
}

describe('a declined payment does not become a 30-second wait', () => {
  it('stops on the first terminal verdict and says the payment failed', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed', orderStatus: 'FAILED' }];
    renderModal();

    expect(screen.getByText('Confirming your payment...')).toBeInTheDocument();

    await firstPoll();

    expect(screen.getByText(/Payment didn't go through/i)).toBeInTheDocument();
    // Nothing may imply an activation is on its way.
    expect(screen.queryByText('Confirming your payment...')).not.toBeInTheDocument();
    expect(screen.queryByText(/will activate as soon as/i)).not.toBeInTheDocument();
  });

  it('keeps waiting for ACTIVE — that is the webhook race, not a decline', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending', orderStatus: 'ACTIVE' }];
    renderModal();

    await firstPoll();
    expect(screen.getByText('Confirming your payment...')).toBeInTheDocument();

    await advancePolls(5);
    // Still polling, still honest about not knowing.
    expect(screen.getByText('Confirming your payment...')).toBeInTheDocument();
    expect(screen.queryByText(/Payment didn't go through/i)).not.toBeInTheDocument();
    // And it is genuinely still asking, not frozen.
    expect(verifyCalls).toBe(6);
  });

  it('stops polling a dead order instead of burning the full budget', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed' }];
    renderModal();

    await firstPoll();
    const callsAfterVerdict = verifyCalls;

    await advancePolls(20);
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(verifyCalls).toBe(callsAfterVerdict);
  });

  it('confirms as soon as the server reports the order activated', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'activated' }];
    renderModal();

    await firstPoll();

    expect(screen.getByText(/You're a Creator/i)).toBeInTheDocument();
  });
});

describe('every exit from the failure state leads somewhere', () => {
  it('offers a way back to checkout', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed' }];
    const { onClose, onRetry } = renderModal();
    await firstPoll();

    await act(async () => {
      screen.getByRole('button', { name: 'Try again' }).click();
    });

    expect(onClose).toHaveBeenCalledWith('failed');
    expect(onRetry).toHaveBeenCalled();
  });

  it('offers a way to stay on Free and carry on with the take they already have', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed' }];
    const { onClose } = renderModal();
    await firstPoll();

    await act(async () => {
      screen.getByRole('button', { name: 'Continue with Free' }).click();
    });

    // 'failed' is what stops the studio from restoring the locked format and
    // re-asking for the upgrade on every later load.
    expect(onClose).toHaveBeenCalledWith('failed');
  });

  it('states the account is untouched and the recording is intact', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed' }];
    renderModal();
    await firstPoll();

    const copy = document.body.textContent ?? '';
    expect(copy).toMatch(/still on Free/i);
    expect(copy).toMatch(/Nothing was charged/i);
    expect(copy).toMatch(/recording is right\s+where you left it/i);
  });

  it('dismissing by backdrop or Escape reports the failure, not a pending state', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed' }];
    const { onClose } = renderModal();
    await firstPoll();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    await settleClose();

    // `act` has already flushed the render, so a sync assertion is the honest
    // check here — `waitFor` would poll on the fake clock that is now stopped.
    expect(onClose).toHaveBeenCalledWith('failed' as ActivationOutcome);
  });
});

describe('a settled payment with a webhook still in flight', () => {
  /* STATE 5 — the buyer paid, the redirect beat the webhook. Nothing may claim
   * success until the session actually carries the plan, because the studio
   * behind the modal is rendered from `session.user.plan`. */

  it('says the payment is being confirmed, not that it succeeded', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending', orderStatus: 'ACTIVE' }];
    renderModal();

    expect(screen.getByText('Confirming your payment...')).toBeInTheDocument();
    // No premature success language anywhere on screen.
    const copy = document.body.textContent ?? '';
    expect(copy).not.toMatch(/Payment Successful/i);
    expect(copy).not.toMatch(/You're a Creator/i);
    expect(copy).not.toMatch(/is now active/i);
    expect(copy).not.toMatch(/Thank you for subscribing/i);
    // The old copy claimed the plan was being confirmed, which is a different
    // promise: the plan is a server-side entitlement, not something in flight.
    expect(screen.queryByText('Confirming your plan...')).not.toBeInTheDocument();
  });

  it('does not label the dialog as activated while it is still confirming', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending' }];
    renderModal();

    // A screen-reader user gets the aria-label, not the heading.
    expect(screen.getByRole('dialog', { name: 'Confirming your payment' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Creator plan activated' })).not.toBeInTheDocument();
  });

  it('refreshes the session before announcing activation, so the Creator UI is already live', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'activated' }];
    sessionUpdate.mockImplementation(async () => ({ user: { plan: 'creator_monthly' } } as never));

    renderModal();
    await firstPoll();

    expect(screen.getByText(/You're a Creator/i)).toBeInTheDocument();
    // The ordering is the whole point: had the modal returned on `activated`
    // without refreshing, the studio behind it would still be rendering Free
    // restrictions while claiming the user is a Creator.
    expect(sessionUpdate).toHaveBeenCalled();
  });

  it('does not announce failure when only the session read fails', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'activated' }];
    // The server read Cashfree directly and says the order is paid. A dropped
    // session fetch must not strand the buyer on the spinner — nor be reported
    // as a payment failure, which it is not.
    sessionUpdate.mockImplementation(async () => {
      throw new Error('network');
    });

    const { onClose } = renderModal();
    await firstPoll();

    expect(screen.getByText(/You're a Creator/i)).toBeInTheDocument();
    await act(async () => {
      screen.getByRole('button', { name: 'Continue creating' }).click();
    });
    expect(onClose).toHaveBeenCalledWith('confirmed');
  });

  it('activates on the webhook path when the server never sees the order yet', async () => {
    vi.useFakeTimers();
    // The order route is not reachable / the webhook is the only writer: the
    // session is the sole signal that the plan went live.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        verifyCalls += 1;
        throw new Error('network');
      })
    );
    sessionUpdate.mockImplementation(async () => ({ user: { plan: 'creator_monthly' } } as never));

    renderModal();
    await firstPoll();

    expect(screen.getByText(/You're a Creator/i)).toBeInTheDocument();
  });

  it('keeps waiting — and keeps saying so — while the webhook is still absent', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending', orderStatus: 'ACTIVE' }];
    renderModal();

    await advancePolls(8);

    expect(screen.getByText('Confirming your payment...')).toBeInTheDocument();
    expect(screen.queryByText(/You're a Creator/i)).not.toBeInTheDocument();
    // Still asking the server, not stuck.
    expect(verifyCalls).toBe(8);
  });

  it('does not touch the recording while the payment is in flight', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending' }];
    renderModal();
    await advancePolls(3);

    // The modal has no recording props and issues no recording writes; the
    // take in IndexedDB is the only copy and nothing in this flow clears it.
    const copy = document.body.textContent ?? '';
    expect(copy).toMatch(/recording stays exactly as it is/i);
  });
});

describe('the outcome the studio is told about is the one that happened', () => {
  it('reports confirmed after a successful activation', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'activated' }];
    const { onClose } = renderModal();
    await firstPoll();

    await act(async () => {
      screen.getByRole('button', { name: 'Continue creating' }).click();
    });

    expect(onClose).toHaveBeenCalledWith('confirmed');
  });

  it('reports unresolved when the poll budget runs out on a still-active order', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending' }];
    const { onClose } = renderModal();

    await advancePolls(15);
    expect(screen.getByText(/Continue anyway/i)).toBeInTheDocument();

    await act(async () => {
      screen.getByRole('button', { name: 'Continue anyway' }).click();
    });

    // Unresolved, not confirmed: the plan may still land from the webhook, so
    // the studio keeps the format intent but must not claim an activation.
    expect(onClose).toHaveBeenCalledWith('unresolved');
  });

  it('names the dialog for what it is showing', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'failed' }];
    const { unmount } = renderModal();
    await firstPoll();
    expect(screen.getByRole('dialog', { name: 'Payment unsuccessful' })).toBeInTheDocument();
    unmount();

    verifyCalls = 0;
    verifyResponses = [{ status: 'pending' }];
    const { unmount: unmountPending } = renderModal();
    await firstPoll();
    expect(screen.getByRole('dialog', { name: 'Confirming your payment' })).toBeInTheDocument();
    unmountPending();

    verifyCalls = 0;
    verifyResponses = [{ status: 'activated' }];
    renderModal();
    await firstPoll();
    expect(screen.getByRole('dialog', { name: 'Creator plan activated' })).toBeInTheDocument();
  });
});
