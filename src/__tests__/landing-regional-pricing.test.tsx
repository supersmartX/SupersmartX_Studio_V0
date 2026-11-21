import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';

/**
 * The landing page and the checkout sheet must advertise the amount the server
 * will charge. That amount comes from `/api/paddle/pricing` (USD everywhere
 * except India); this suite pins the landing page to it and proves the page no
 * longer swaps in a regional catalog price that checkout would not honour.
 */

const fetchMock = vi.hoisted(() => vi.fn());

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

import LandingPage from '@/app/page';

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
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
  // The footer repeats the quoted prices for SEO, so scope price assertions to
  // the pricing section; a bare screen.getByText would see both occurrences.
  function quotedPrices() {
    const section = document.getElementById('pricing');
    if (!section) throw new Error('Pricing section was not rendered');
    return within(section);
  }

  it('shows the server-quoted USD price, not a regional catalog price', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ country: 'GB', currency: 'USD', monthly: 7.99, yearly: 59.99 }),
    });

    render(<LandingPage />);

    await waitFor(() => expect(quotedPrices().getByText(/\$7\.99/)).toBeInTheDocument());
    expect(quotedPrices().queryByText(/£6\.49/)).toBeNull();
  });

  it('swaps to the server-quoted yearly price', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ country: 'GB', currency: 'USD', monthly: 7.99, yearly: 59.99 }),
    });

    render(<LandingPage />);
    await waitFor(() => expect(quotedPrices().getByText(/\$7\.99/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^1 year/ }));

    await waitFor(() => expect(quotedPrices().getByText(/\$59\.99/)).toBeInTheDocument());
  });
});
