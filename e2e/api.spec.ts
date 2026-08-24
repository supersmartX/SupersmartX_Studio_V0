import { test, expect } from '@playwright/test';

test.describe('API Protection - Unauthenticated Access', () => {
  test('protected endpoints return error without session', async ({ request }) => {
    const endpoints = [
      { method: 'GET' as const, path: '/api/recordings' },
      { method: 'POST' as const, path: '/api/upload' },
      { method: 'GET' as const, path: '/api/download' },
    ];

    for (const endpoint of endpoints) {
      const response = await request.fetch(endpoint.path, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
      });
      expect(response.status()).toBeGreaterThanOrEqual(400);
    }
  });
});

test.describe('API Security Headers', () => {
  test('auth routes have cache control headers', async ({ request }) => {
    const response = await request.fetch('/api/auth/providers');
    const headers = response.headers();
    const cacheControl = headers['cache-control'];
    const hasCacheHeader = cacheControl !== undefined;
    expect(hasCacheHeader).toBeTruthy();
  });
});

test.describe('API Error Handling', () => {
  test('returns error for nonexistent endpoint', async ({ request }) => {
    const response = await request.fetch('/api/nonexistent-endpoint');
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('handles malformed JSON gracefully', async ({ request }) => {
    const response = await request.fetch('/api/cashfree/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: 'this is not json{{{',
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test('handles empty body on POST endpoints', async ({ request }) => {
    const response = await request.fetch('/api/cashfree/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      data: '',
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
