import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, getRequestId, hashUserId, sanitizeMeta } from '@/lib/observe/logger';

describe('observe logger', () => {
  it('produces structured JSON', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('export.completed', { route: '/api/exports/complete', userIdHash: 'abc', platform: 'youtube' });
    const line = spy.mock.calls[0][0] as string;
    const obj = JSON.parse(line);
    expect(obj.level).toBe('info');
    expect(obj.event).toBe('export.completed');
    expect(obj.route).toBe('/api/exports/complete');
    spy.mockRestore();
  });

  it('generates valid requestId', () => {
    const req = new Request('https://example.com/api/test');
    const id = getRequestId(req);
    expect(id).toMatch(/^[0-9a-fA-F]{8}-/);
  });

  it('generates valid requestId when no incoming', () => {
    const req = new Request('https://example.com');
    const id = getRequestId(req);
    expect(id).toMatch(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
  });

  it('hashes userId deterministically', () => {
    const h1 = hashUserId('user-123');
    const h2 = hashUserId('user-123');
    expect(h1).toBe(h2);
    expect(h1).not.toBe('user-123');
    expect(hashUserId('user-456')).not.toBe(h1);
  });

  it('redacts R2 keys and signed URLs', () => {
    const out = sanitizeMeta({ r2Key: 'exports/user-1/abc.mp4', url: 'https://r2.cloudflarestorage.com/exports/user-1/abc.mp4?X-Amz-Signature=xyz' });
    expect(out.r2Key).toBe('exports/[REDACTED]');
    expect(out.url).toBe('[REDACTED_SIGNED_URL]');
  });

  it('never logs video blob', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.info('recording.failed', { route: '/api/test', blob: new Blob(['test']) } as any);
    const line = spy.mock.calls[0][0] as string;
    const obj = JSON.parse(line);
    expect(obj.blob).toBe('[REDACTED]');
    expect(line).not.toContain('Blob');
    spy.mockRestore();
  });

  it('never logs secrets', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('payment.order_failed', { route: '/api/cashfree/order', secret: 'supersecret' } as any);
    const line = spy.mock.calls[0][0] as string;
    expect(line).not.toContain('supersecret');
    expect(line).toContain('[REDACTED]');
    spy.mockRestore();
  });
});
