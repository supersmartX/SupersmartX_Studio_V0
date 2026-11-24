import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { PaddleCheckout } from '@/components/billing/PaddleCheckout';

vi.mock('next/script', () => ({ default: ({ onReady }: { onReady(): void }) => {
  useEffect(() => { onReady(); }, []);
  return null;
} }));

const initialize = vi.fn();
const open = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Paddle', { Environment: { set: vi.fn() }, Initialize: initialize,
    Update: vi.fn(), Checkout: { open } });
});

describe('Paddle payment page', () => {
  it('initializes sandbox checkout and reopens only the existing transaction', () => {
    render(<PaddleCheckout token="test_public" transactionId="txn_existing" />);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ token: 'test_public' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen checkout' }));
    expect(open).toHaveBeenCalledWith({ transactionId: 'txn_existing' });
    expect(screen.getByRole('link', { name: 'Return to Studio' })).toHaveAttribute('href', '/studio');
  });

  it('reports browser completion as pending verification, never activation', async () => {
    initialize.mockImplementationOnce(({ eventCallback }) => eventCallback({ name: 'checkout.completed' }));
    render(<PaddleCheckout token="test_public" transactionId="txn_existing" />);
    // Deliver the event after initialization, like the real asynchronous SDK.
    const { act } = await import('@testing-library/react');
    act(() => initialize.mock.calls[0][0].eventCallback({ name: 'checkout.completed' }));
    expect(screen.getByRole('status')).toHaveTextContent('Payment received');
    expect(screen.queryByRole('button', { name: 'Reopen checkout' })).toBeNull();
  });

  it('shows a recovery action if the provider script is unavailable', () => {
    vi.stubGlobal('Paddle', undefined);
    render(<PaddleCheckout token="test_public" transactionId="txn_existing" />);
    expect(screen.getByRole('alert')).toHaveTextContent('could not load');
    expect(screen.getByRole('button', { name: 'Reload checkout' })).toBeVisible();
  });
});
