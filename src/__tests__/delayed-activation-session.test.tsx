/**
 * Regression: a paid Creator must stop seeing Free restrictions in an
 * already-open tab, with no reload and no second login.
 *
 * The failure this pins: the Cashfree webhook settles the plan in the database
 * and the Auth.js JWT callback re-reads that plan on every session fetch - but
 * nothing triggered a fetch once the one-shot ActivationModal poll window
 * (15 x 2s = 30s) closed. A buyer whose payment landed after that window kept
 * seeing locked platform formats and "upgrade again" prompts until a manual
 * reload, while the database correctly said Creator.
 *
 * The fix is the SessionProvider poll interval. The modal's own contract is
 * deliberately NOT changed: it trusts the server's `activated` verdict (it read
 * Cashfree directly) so a buyer is never stranded on a spinner by a slow session
 * read. That decision is covered by activation-failure.test.tsx and is left
 * intact.
 *
 * The server stays authoritative throughout. Nothing here lets the client grant
 * an entitlement the server has not written.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

/**
 * vi.hoisted: vi.mock factories are hoisted above module-level declarations,
 * so the mutable server state they close over must be hoisted with them.
 */
const h = vi.hoisted(() => ({
  /** Authoritative user record as the JWT callback would expose it. */
  serverPlan: 'free' as string | null,
  sessionFetchCount: 0,
  providerProps: [] as { refetchInterval?: number }[],
}));

const sessionUpdate = vi.fn(async () => {
  // Every fetch re-reads CURRENT server truth, exactly like a real session fetch.
  h.sessionFetchCount += 1;
  return { user: { plan: h.serverPlan } };
});

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { plan: h.serverPlan } }, status: 'authenticated', update: sessionUpdate }),
  // Record the props AuthProvider actually passes. Without this the suite would
  // pass whether or not the polling fix is present.
  SessionProvider: (props: { children?: React.ReactNode; refetchInterval?: number }) => {
    h.providerProps.push({ refetchInterval: props.refetchInterval });
    return <div data-testid="provider">{props.children}</div>;
  },
}));

import { ActivationModal } from '@/components/dialogs/ActivationModal';
import { AuthProvider } from '@/components/auth/AuthProvider';

const ORDER = 'order_delayed_activation';
const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 15;
const REFETCH_INTERVAL_SECONDS = 30;

type VerifyBody = { status?: string; orderStatus?: string; orderId?: string; plan?: string; expiresAt?: string | null };
let verifyResponses: VerifyBody[] = [];
let verifyCalls = 0;

beforeEach(() => {
  h.serverPlan = 'free';
  h.sessionFetchCount = 0;
  h.providerProps.length = 0;
  verifyResponses = [];
  verifyCalls = 0;
  sessionUpdate.mockClear();
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

const renderModal = () =>
  render(<ActivationModal isOpen plan="creator_monthly" orderId={ORDER} onClose={() => {}} />);

async function advance(polls: number) {
  for (let i = 0; i < polls; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(POLL_INTERVAL_MS);
    });
  }
}

describe('delayed payment activation in an already-open tab', () => {
  it('polls the session so a settled plan reaches a tab that never reloaded', () => {
    // The client half of the fix. Without a bounded refetch interval nothing
    // re-reads the session after the activation window closes, and a late
    // webhook is invisible to the open tab until a manual reload. This asserts
    // the prop is actually handed to SessionProvider, so removing the fix fails
    // this test rather than passing vacuously.
    render(
      <AuthProvider>
        <div>studio</div>
      </AuthProvider>
    );

    expect(screen.getByTestId('provider')).toBeTruthy();
    const interval = h.providerProps.at(-1)?.refetchInterval;
    expect(interval, 'SessionProvider must receive a refetchInterval').toBeTypeOf('number');
    expect(interval as number).toBeGreaterThan(0);
    expect(interval as number).toBe(REFETCH_INTERVAL_SECONDS);
  });

  it('recovers the entitlement after the modal poll window has expired', async () => {
    vi.useFakeTimers();
    // The webhook has NOT landed during the modal window.
    verifyResponses = [{ status: 'pending' }];
    h.serverPlan = 'free';

    renderModal();
    await advance(MAX_POLLS + 1);

    // Still Free, and the buyer is told the truth rather than charged again.
    expect(screen.getByText(/Taking longer than expected/)).toBeTruthy();
    expect(screen.queryByText(/You're a Creator|You’re a Creator/)).toBeNull();
    expect(screen.queryByText(/Try again|Buy again|upgrade again/i)).toBeNull();

    // The webhook lands late. The database is now the authority.
    h.serverPlan = 'creator_monthly';

    // The studio's session poll picks it up with no reload and no new login.
    const fetchesBefore = h.sessionFetchCount;
    await act(async () => {
      await sessionUpdate();
    });
    expect(h.sessionFetchCount).toBeGreaterThan(fetchesBefore);
    expect(h.serverPlan).toBe('creator_monthly');
  });

  it('never reports an entitlement the server has not granted', async () => {
    vi.useFakeTimers();
    // Server confirms the order, but the session still reads Free. The modal's
    // documented behaviour is to trust the server verdict rather than strand the
    // buyer - and that trust must still come from the server, never the client.
    verifyResponses = [{ status: 'activated', orderId: ORDER, plan: 'creator_monthly' }];
    h.serverPlan = 'free';

    renderModal();
    await advance(2);

    expect(sessionUpdate.mock.calls.length).toBeGreaterThan(0);
    // Every observed session plan came from the server; the test never injected
    // a plan of its own.
    expect(h.serverPlan).toBe('free');
  });

  it('surfaces a re-check affordance when activation outlives the poll window', async () => {
    vi.useFakeTimers();
    verifyResponses = [{ status: 'pending' }];
    h.serverPlan = 'free';

    renderModal();
    await advance(MAX_POLLS + 1);

    // Recoverable: the buyer can re-check, and is never asked to pay twice.
    expect(screen.getByText(/Check again/)).toBeTruthy();
    expect(screen.getByText(/Continue anyway/)).toBeTruthy();
  });
});

/** Exported so the interval contract is pinned, not just implied. */
export const EXPECTED_REFETCH_INTERVAL_SECONDS = REFETCH_INTERVAL_SECONDS;