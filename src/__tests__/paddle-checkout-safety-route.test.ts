import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));

import { POST as quotePOST } from '@/app/api/paddle/quote/route';
import { POST as checkoutPOST } from '@/app/api/paddle/checkout/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
  vi.stubEnv('PADDLE_LIVE_CHECKOUT_DISABLED', 'true');
});

describe('Paddle checkout safety gates', () => {
  it('allows Sandbox quote requests while live checkout remains disabled', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');

    const response = await quotePOST(new Request('http://localhost/api/paddle/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: 'monthly' }),
    }));

    expect(response.status).toBe(200);
  });

  it('passes Sandbox checkout consent validation instead of the live-disable 503', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_SANDBOX_PRICE_CREATOR_MONTHLY', 'pri_monthly');
    vi.stubEnv('PADDLE_SANDBOX_AMOUNT_MONTHLY', '7.99');
    vi.stubEnv('PADDLE_SANDBOX_CURRENCY', 'USD');

    const response = await checkoutPOST(new NextRequest('http://localhost/api/paddle/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'creator_monthly' }),
    }));

    expect(response.status).toBe(400);
  });

  it('fails closed for live environment while the safety flag is true', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');

    const response = await quotePOST(new Request('http://localhost/api/paddle/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ period: 'monthly' }),
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'Live Paddle checkout is disabled' });
  });
});
