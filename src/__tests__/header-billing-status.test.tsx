import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * In-app billing status. A one-time purchase has a date attached to it, and the
 * session's plan name alone cannot distinguish "Creator until 15 Jan" from
 * "Creator ended last month" — both are just a plan string. The menu therefore
 * reads the stored expiry from `/api/user/stats` when it opens.
 */

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'Ada Lovelace', email: 'ada@example.com' } },
    status: 'authenticated',
    update: vi.fn(),
  }),
  signOut: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { Header } from '@/components/layout/Header';

const noop = () => {};

function stubStats(payload: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => payload }),
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'User menu' }));
  await waitFor(() => expect(screen.getByRole('menu', { name: 'User menu' })).toBeInTheDocument());
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Header — billing status', () => {
  it('shows the stored end date for an active Creator plan', async () => {
    stubStats({ planExpiresAt: '2027-01-15T09:30:00.000Z', planActive: true });
    render(<Header hasRecording={false} onExport={noop} onShare={noop} userPlan="creator_yearly" />);

    await openMenu();

    expect(await screen.findByText('Access until Jan 15, 2027')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Manage or extend plan' })).toBeInTheDocument();
  });

  it('tells an expired subscriber when the term ended and offers a renewal', async () => {
    stubStats({ planExpiresAt: '2026-01-15T09:30:00.000Z', planActive: false });
    render(<Header hasRecording={false} onExport={noop} onShare={noop} userPlan="free" />);

    await openMenu();

    expect(await screen.findByText('Creator term ended Jan 15, 2026')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Renew Creator' })).toBeInTheDocument();
  });

  it('keeps the plain upgrade path for an account that never bought a plan', async () => {
    stubStats({ planExpiresAt: null, planActive: false });
    render(<Header hasRecording={false} onExport={noop} onShare={noop} userPlan="free" />);

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Upgrade to Creator' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/Access until|Creator term ended/)).toBeNull());
  });

  it('opens the menu even when the status request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(<Header hasRecording={false} onExport={noop} onShare={noop} userPlan="creator_yearly" />);

    await openMenu();

    expect(screen.getByRole('menuitem', { name: 'Manage or extend plan' })).toBeInTheDocument();
  });
});
