import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

type IpGuard = typeof import('@/lib/billing/paddle-ips');

function webhookRequest(ip?: string) {
  return new NextRequest('http://localhost/api/paddle/webhook', {
    method: 'POST',
    headers: ip ? {
      'x-forwarded-for': ip,
    } : {},
  });
}

async function loadGuard(): Promise<IpGuard> {
  await vi.resetModules();
  return import('@/lib/billing/paddle-ips');
}

describe('Paddle live webhook IP allowlist', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('allows webhook sources in the sandbox environment without any list check', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    const { isPaddleNotificationSource } = await loadGuard();
    expect(await isPaddleNotificationSource(webhookRequest('203.0.113.1'))).toBe('allowed');
  });

  it('allows an unconfigured environment without any list check', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', '');
    const { isPaddleNotificationSource } = await loadGuard();
    expect(await isPaddleNotificationSource(webhookRequest('203.0.113.1'))).toBe('allowed');
  });

  it('rejects a live delivery from a foreign address and allows a published one', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { ipv4_cidrs: ['34.194.127.42/32'], ipv6_cidrs: [] },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { isPaddleNotificationSource } = await loadGuard();

    expect(await isPaddleNotificationSource(webhookRequest('34.194.127.42'))).toBe('allowed');
    expect(await isPaddleNotificationSource(webhookRequest('203.0.113.99'))).toBe('rejected');
    expect(fetchMock).toHaveBeenCalledWith('https://api.paddle.com/ips', { cache: 'no-store' });
  });

  it('matches a range CIDR, not just a whole address', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { ipv4_cidrs: ['34.194.0.0/16'], ipv6_cidrs: [] },
    }), { status: 200 })));
    const { isPaddleNotificationSource } = await loadGuard();

    expect(await isPaddleNotificationSource(webhookRequest('34.194.127.42'))).toBe('allowed');
    expect(await isPaddleNotificationSource(webhookRequest('34.195.0.1'))).toBe('rejected');
  });

  it('is unverifiable when the IP list cannot be fetched at all', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { getPaddleNotificationCidrs, isPaddleNotificationSource } = await loadGuard();

    expect(await getPaddleNotificationCidrs()).toBeNull();
    expect(await isPaddleNotificationSource(webhookRequest('34.194.127.42'))).toBe('unverifiable');
  });

  it('is unverifiable when no client IP is available', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { ipv4_cidrs: ['34.194.127.42/32'], ipv6_cidrs: [] },
    }), { status: 200 })));
    const { isPaddleNotificationSource } = await loadGuard();

    expect(await isPaddleNotificationSource(webhookRequest())).toBe('unverifiable');
  });

  it('caches the list and prefers the cached copy when the API is down', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'live');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { ipv4_cidrs: ['34.194.127.42/32'], ipv6_cidrs: [] },
    }), { status: 200 })));
    const { getPaddleNotificationCidrs } = await loadGuard();

    expect(await getPaddleNotificationCidrs()).toEqual(['34.194.127.42/32']);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('api down')));
    expect(await getPaddleNotificationCidrs()).toEqual(['34.194.127.42/32']);
  });
});
