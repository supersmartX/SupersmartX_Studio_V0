'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Session is polled so an entitlement change made on the server (a paid
 * activation settled by the Cashfree webhook) reaches an already-open tab.
 *
 * Without this, the JWT callback re-read the correct plan from the database on
 * every session fetch, but nothing triggered a fetch after the one-shot
 * ActivationModal poll window: a buyer whose webhook settled later kept seeing
 * Free locks and upgrade prompts until a manual reload.
 *
 * 30s is bounded and deliberate - it is long enough to keep request volume
 * negligible, short enough that a paying customer is not left looking at a
 * Free UI. The server remains authoritative for every entitlement decision; this
 * only decides how quickly the client learns about it.
 */
const SESSION_REFETCH_INTERVAL_SECONDS = 30;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={SESSION_REFETCH_INTERVAL_SECONDS}>{children}</SessionProvider>
  );
}
