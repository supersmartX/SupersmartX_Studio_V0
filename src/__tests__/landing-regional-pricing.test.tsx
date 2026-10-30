import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The landing page used to hard-code the US price table, so a visitor in a
 * region with its own table was quoted one price on the page and a different
 * one in the checkout sheet. It now shares `useRegionalPricing` with the sheet.
 */

const detectCountry = vi.hoisted(() => vi.fn(async () => 'GB'));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated', update: vi.fn() }),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/pricing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pricing')>();
  return { ...actual, detectCountry: () => detectCountry() };
});

import LandingPage from '@/app/page';

beforeEach(() => {
  detectCountry.mockClear();
  // jsdom omits the Web Animations API; the page's reveal pass only needs to
  // know that nothing is animating.
  if (typeof Element.prototype.getAnimations !== 'function') {
    Element.prototype.getAnimations = (() => []) as typeof Element.prototype.getAnimations;
  }
  // jsdom has no matchMedia; the page only uses it to close the mobile menu on
  // desktop widths, so a never-matching stub is faithful.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

describe('landing page pricing', () => {
  it('shows the detected region’s price, not the US one', async () => {
    render(<LandingPage />);

    // US monthly would be $7.99; the UK table is £6.49.
    await waitFor(() => expect(screen.getByText(/£6\.49/)).toBeInTheDocument());
    expect(screen.queryByText(/\$7\.99/)).toBeNull();
  });

  it('swaps to the yearly price for the detected region', async () => {
    render(<LandingPage />);
    await waitFor(() => expect(screen.getByText(/£6\.49/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^1 year/ }));

    await waitFor(() => expect(screen.getByText(/£49\.99/)).toBeInTheDocument());
  });
});
