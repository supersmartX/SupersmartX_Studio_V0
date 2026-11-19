import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  unmarshal: vi.fn(),
  receive: vi.fn(),
}));

vi.mock('@/lib/billing/paddle', () => ({
  getPaddleClient: () => ({
    webhooks: { unmarshal: mocks.unmarshal },
  }),
}));

vi.mock('@/lib/billing/operations', () => ({
  receiveBillingEvent: mocks.receive,
}));

import { POST } from '@/app/api/paddle/webhook/route';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('PADDLE_API_KEY', 'test-key');
  vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
  vi.stubEnv('PADDLE_WEBHOOK_SECRET', 'test-secret');
  vi.stubEnv('CRON_SECRET', 'worker-secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://studio.supersmartx.com');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  mocks.receive.mockResolvedValue({ duplicate: false });
});

describe('Paddle webhook route', () => {
  it('rejects an unsigned request as an invalid Paddle signature', async () => {
    mocks.unmarshal.mockRejectedValue(new Error('missing signature'));
    const raw = '{"event_id":"evt-unsigned","event_type":"transaction.paid","data":{}}';
    const res = await POST(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'POST',
      body: raw,
    }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Invalid webhook signature' });
    expect(mocks.unmarshal).toHaveBeenCalledWith(raw, 'test-secret', '');
  });

  it('passes the raw body to SDK signature verification', async () => {
    mocks.unmarshal.mockRejectedValue(new Error('invalid signature'));
    const raw = '{"event_id":"evt-1","event_type":"transaction.paid","data":{}}';
    const res = await POST(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'bad-signature' },
      body: raw,
    }));
    expect(res.status).toBe(401);
    expect(mocks.unmarshal).toHaveBeenCalledWith(raw, 'test-secret', 'bad-signature');
  });

  it('persists verified events before acknowledging the webhook', async () => {
    mocks.unmarshal.mockResolvedValue({
      eventId: 'evt-duplicate',
      eventType: 'transaction.paid',
      occurredAt: '2026-11-18T12:00:00.000Z',
      data: { id: 'txn-1' },
    });
    const res = await POST(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'valid' },
      body: '{}',
    }));
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ status: 'accepted', duplicate: false });
    expect(mocks.receive).toHaveBeenCalledWith(expect.objectContaining({
      eventId: 'evt-duplicate',
      eventType: 'transaction.paid',
      occurredAt: new Date('2026-11-18T12:00:00.000Z'),
    }));
    expect(fetch).toHaveBeenCalledWith(
      'https://studio.supersmartx.com/api/internal/paddle/worker',
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: 'Bearer worker-secret',
        }),
      }),
    );
  });

  it('acknowledges a duplicate only after durable inbox reports it exists', async () => {
    mocks.unmarshal.mockResolvedValue({
      eventId: 'evt-duplicate',
      eventType: 'transaction.paid',
      occurredAt: '2026-11-18T12:00:00.000Z',
      data: { id: 'txn-1' },
    });
    mocks.receive.mockResolvedValue({ duplicate: true });
    const res = await POST(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'valid' },
      body: '{}',
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'accepted', duplicate: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a verified event without a valid occurred-at timestamp', async () => {
    mocks.unmarshal.mockResolvedValue({
      eventId: 'evt-no-time',
      eventType: 'subscription.updated',
      occurredAt: 'not-a-date',
      data: { id: 'sub-1' },
    });
    const res = await POST(new NextRequest('http://localhost/api/paddle/webhook', {
      method: 'POST',
      headers: { 'paddle-signature': 'valid' },
      body: '{}',
    }));
    expect(res.status).toBe(400);
    expect(mocks.receive).not.toHaveBeenCalled();
  });
});
