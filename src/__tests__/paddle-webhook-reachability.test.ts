import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({
  getToken: mocks.getToken,
}));

import { middleware } from '@/middleware';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getToken.mockResolvedValue(null);
  vi.stubEnv('NEXTAUTH_SECRET', 'test-secret');
  vi.stubEnv('NODE_ENV', 'test');
});

describe('Paddle webhook middleware reachability', () => {
  it('allows POSTs to the exact Paddle webhook path without a session', async () => {
    const res = await middleware(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBeTruthy();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it('allows GET reachability checks to the exact Paddle webhook path', async () => {
    const res = await middleware(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'GET',
    }));

    expect(res.status).toBe(200);
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it('does not make Paddle webhook subpaths public', async () => {
    const res = await middleware(new NextRequest('http://localhost/api/paddle/webhook/unknown', {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.getToken).toHaveBeenCalledOnce();
  });

  it('keeps unrelated protected API endpoints session-protected', async () => {
    const res = await middleware(new NextRequest('http://localhost/api/recordings', {
      method: 'GET',
    }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.getToken).toHaveBeenCalledOnce();
  });
});
