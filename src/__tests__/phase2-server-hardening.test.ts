import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CASHFREE_APP_ID = 'test-app-id';
process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
process.env.CASHFREE_ENV = 'sandbox';
process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';

vi.mock('@/auth', () => ({ auth: vi.fn(), findUserByEmail: vi.fn() }));
vi.mock('@/lib/email', () => ({
  sendPaymentConfirmationEmail: vi.fn().mockResolvedValue(undefined),
  sendAdminNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/r2', () => ({
  isR2Configured: () => true,
  getR2ConfigurationError: () => null,
  uploadRecording: vi.fn().mockResolvedValue(undefined),
  getSignedDownloadUrl: vi.fn(async () => 'https://r2.example/signed-url'),
  headObject: vi.fn(async () => ({ size: 1024, contentType: 'video/mp4', eTag: '"e"' })),
  copyRecording: vi.fn(async () => undefined),
  deleteRecording: vi.fn(async () => undefined),
  listUserRecordings: vi.fn(async () => []),
  generateFinalExportKey: (userId: string, jobId: string) => `exports/${userId}/${jobId}.mp4`,
  // Phase 3: the complete route's byte-range reader. Replay tests return
  // before verification, so this only needs to satisfy the import binding.
  getObjectRange: vi.fn(async () => new Uint8Array(0)),
}));

import { auth, findUserByEmail } from '@/auth';
import { headObject, getSignedDownloadUrl } from '@/lib/r2';
import { buildSyntheticMp4 } from '@/lib/export/mp4-metadata';
import { POST as jobsCreatePOST } from '@/app/api/export-jobs/route';
import { POST as completePOST } from '@/app/api/exports/complete/route';
import { POST as verifyPOST } from '@/app/api/cashfree/verify/route';
import { POST as webhookPOST } from '@/app/api/cashfree/webhook/route';
import { POST as orderPOST } from '@/app/api/cashfree/order/route';
import { DELETE as userDeleteDELETE } from '@/app/api/user/delete/route';
import { DELETE as exportDeleteDELETE } from '@/app/api/exports/[id]/route';
import { GET as downloadGET } from '@/app/api/download/route';
import { POST as exportUploadPOST } from '@/app/api/export-upload/route';
import { POST as forgotPOST } from '@/app/api/auth/forgot-password/route';
import { resetDb, getDb } from '@/lib/db/driver';
import {
  setMigrated,
  createUser,
  createExportJob,
  createExport,
  createPendingOrder,
  tryClaimWebhookOrder,
  updateExportJobStatus,
  setExportJobStagingKey,
} from '@/lib/db';

function cleanTestData() {
  resetDb();
  setMigrated(false);
  process.env.TURSO_DATABASE_URL = 'file::memory:';
}

/** The order route's bespoke per-IP limiter lives on globalThis — reset it. */
function clearOrderIpLimiter() {
  const g = globalThis as unknown as { __rateLimitMap?: Map<string, unknown> };
  g.__rateLimitMap?.clear();
}

let n = 0;
const MB = 1024 * 1024;
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString();

async function seedUser(plan: 'free' | 'creator_monthly' = 'creator_monthly') {
  n += 1;
  const user = await createUser(`p2-${n}@example.com`, 'P2', 'hash');
  if (plan === 'creator_monthly') {
    const { updateUserPlanById } = await import('@/lib/db');
    await updateUserPlanById(user.id, 'creator_monthly', FUTURE);
  }
  return user;
}

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  cleanTestData();
  clearOrderIpLimiter();
  vi.clearAllMocks();
  process.env.CASHFREE_APP_ID = 'test-app-id';
  process.env.CASHFREE_SECRET_KEY = 'test-secret-key';
  process.env.CASHFREE_ENV = 'sandbox';
  process.env.NEXT_PUBLIC_CASHFREE_ENV = 'sandbox';
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  cleanTestData();
});

// ---------------------------------------------------------------------------
// Phase 2.2 — completion and final result metadata are server-authored
// ---------------------------------------------------------------------------
describe('Phase 2.2: server-authoritative completion', () => {
  function completeBody(jobId: string, key: string) {
    return new NextRequest('http://localhost/api/exports/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jobId,
        key,
        fileSize: 1 * MB,
        mimeType: 'video/mp4',
        platformId: 'youtube-landscape',
        outputWidth: 1920,
        outputHeight: 1080,
      }),
    });
  }

  it('refuses to echo a fabricated resultExportId on a claimed-completed job', async () => {
    const user = await seedUser();
    const key = `exports/${user.id}/job-forged.mp4`;
    const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
    await setExportJobStagingKey(job.id, user.id, key);
    // A completed job whose result references an export row that does not
    // exist (legacy client-written metadata or direct tampering).
    await updateExportJobStatus(job.id, 'completed', { resultExportId: 'forged-export-id', resultR2Key: key }, user.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);

    const res = await completePOST(completeBody(job.id, key));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Job is not available for completion');
    expect(vi.mocked(headObject)).not.toHaveBeenCalled();
  });

  it('still echoes a real owned export row — idempotent replay is preserved', async () => {
    const user = await seedUser();
    const key = `exports/${user.id}/job-real.mp4`;
    const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
    const exportRow = await createExport({
      userId: user.id,
      r2Key: key,
      platform: 'youtube-landscape',
      outputWidth: 1920,
      outputHeight: 1080,
      fileSize: 1 * MB,
      mimeType: 'video/mp4',
      status: 'completed',
    });
    await setExportJobStagingKey(job.id, user.id, key);
    await updateExportJobStatus(job.id, 'completed', { resultExportId: exportRow.id, resultR2Key: key }, user.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);

    const res = await completePOST(completeBody(job.id, key));

    expect(res.status).toBe(200);
    expect((await res.json()).exportId).toBe(exportRow.id);
  });

  it('refuses to replay a completed job through export-upload (no double consume)', async () => {
    const user = await seedUser();
    const job = await createExportJob(user.id, JSON.stringify({ platformId: 'youtube-landscape' }));
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);

    const uploadRequest = () => {
      const formData = new FormData();
      // Phase 3: uploads are verified against real bytes, so the fixture is a
      // structurally valid MP4 at the platform's server-authoritative frame
      // (1920x1080) — a plain string would be rejected as not-an-MP4.
      formData.set(
        'file',
        new File([buildSyntheticMp4(1920, 1080)], 'p2-export.mp4', { type: 'video/mp4' }),
      );
      formData.set('platformId', 'youtube-landscape');
      formData.set('jobId', job.id);
      const request = new NextRequest('http://localhost/api/export-upload', { method: 'POST' });
      Object.defineProperty(request, 'formData', { value: async () => formData });
      return request;
    };

    const first = await exportUploadPOST(uploadRequest());
    expect(first.status).toBe(200);

    const stats = await getDb().execute({
      sql: 'SELECT upload_count FROM user_stats WHERE user_id = ?',
      args: [user.id],
    });
    expect(Number(stats.rows[0]?.upload_count)).toBe(1);

    // Replaying the same job must not re-consume quota or mint a second export.
    const replay = await exportUploadPOST(uploadRequest());
    expect(replay.status).toBe(409);
    expect((await replay.json()).error).toBe('Job is not available for upload');

    const afterStats = await getDb().execute({
      sql: 'SELECT upload_count FROM user_stats WHERE user_id = ?',
      args: [user.id],
    });
    expect(Number(afterStats.rows[0]?.upload_count)).toBe(1);
    const exports = await getDb().execute({
      sql: 'SELECT COUNT(*) AS cnt FROM exports WHERE user_id = ?',
      args: [user.id],
    });
    expect(Number(exports.rows[0]?.cnt)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 2.8 — production geo/currency authority
// ---------------------------------------------------------------------------
describe('Phase 2.8: server-verified geo is authoritative in production', () => {
  function orderReq(opts: { country?: string; currency?: string; headers?: Record<string, string> } = {}) {
    return new NextRequest('http://localhost/api/cashfree/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
      body: JSON.stringify({
        plan: 'creator_monthly',
        currency: opts.currency ?? 'INR',
        country: opts.country ?? 'IN',
        name: 'Buyer',
        email: `geo-${n}-${Math.random().toString(36).slice(2, 8)}@example.com`,
        phone: '+919999999999',
      }),
    });
  }

  function stubOrderFetch() {
    const fetchMock = vi.fn(async (_url: unknown, _init?: { body?: string }) =>
      json({ order_id: 'sxs-created', order_status: 'ACTIVE', payment_session_id: 'ps-created' }),
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('production without a geo header ignores client country AND currency (default region)', async () => {
    const user = await seedUser('free');
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
    vi.stubEnv('NODE_ENV', 'production');
    const fetchMock = stubOrderFetch();

    const res = await orderPOST(orderReq({ country: 'IN', currency: 'INR' }));

    expect(res.status).toBe(200);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? '{}'));
    expect(payload.order_currency).toBe('USD');
    expect(payload.order_amount).toBe(7.99);
  });

  it('production trusts the geo header over a contradictory client region', async () => {
    const user = await seedUser('free');
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
    vi.stubEnv('NODE_ENV', 'production');
    const fetchMock = stubOrderFetch();

    const res = await orderPOST(
      orderReq({ country: 'US', currency: 'USD', headers: { 'x-vercel-ip-country': 'IN' } }),
    );

    expect(res.status).toBe(200);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? '{}'));
    expect(payload.order_currency).toBe('INR');
    expect(payload.order_amount).toBe(349);
  });

  it('non-production keeps the documented dev-only client-country fallback', async () => {
    const user = await seedUser('free');
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
    const fetchMock = stubOrderFetch();

    const res = await orderPOST(orderReq({ country: 'IN', currency: 'INR' }));

    expect(res.status).toBe(200);
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body ?? '{}'));
    expect(payload.order_currency).toBe('INR');
    expect(payload.order_amount).toBe(349);
  });
});

// ---------------------------------------------------------------------------
// Phase 2.6 — one payable order at a time
// ---------------------------------------------------------------------------
describe('Phase 2.6: overlapping pending orders', () => {
  function orderReq() {
    n += 1;
    return new NextRequest('http://localhost/api/cashfree/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plan: 'creator_monthly',
        currency: 'INR',
        country: 'IN',
        name: 'Buyer',
        email: `overlap-${n}@example.com`,
        phone: '+919999999999',
      }),
    });
  }

  async function seedPending(userId: string) {
    const orderId = `sxs-creator_monthly-p2-${n}-${Math.random().toString(36).slice(2, 8)}`;
    await createPendingOrder({
      orderId,
      userId,
      plan: 'creator_monthly',
      amount: 349,
      currency: 'INR',
    });
    return orderId;
  }

  it('refuses a second order while an earlier one is still payable', async () => {
    const user = await seedUser('free');
    const orderId = await seedPending(user.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
    const fetchMock = vi.fn(async (_url: unknown, init?: { method?: string }) => {
      // Probe (GET) reports the earlier order still ACTIVE → still payable.
      expect((init?.method ?? 'GET')).toBe('GET');
      return json({ order_id: orderId, order_status: 'ACTIVE' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await orderPOST(orderReq());

    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/earlier checkout/);
    // Only the probe ran — no second order was created at Cashfree.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets a retry through once the earlier order is terminally failed', async () => {
    const user = await seedUser('free');
    const orderId = await seedPending(user.id);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
    const fetchMock = vi.fn(async (_url: unknown, init?: { method?: string }) => {
      if ((init?.method ?? 'GET') === 'GET') {
        return json({ order_id: orderId, order_status: 'FAILED' });
      }
      return json({ order_id: 'sxs-retry', order_status: 'ACTIVE', payment_session_id: 'ps-retry' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await orderPOST(orderReq());

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not block on an earlier order that fulfilment already claimed', async () => {
    const user = await seedUser('free');
    const orderId = await seedPending(user.id);
    expect(await tryClaimWebhookOrder(orderId)).toBe(true);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);
    const fetchMock = vi.fn(async (_url: unknown) =>
      json({ order_id: 'sxs-after-claim', order_status: 'ACTIVE', payment_session_id: 'ps' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await orderPOST(orderReq());

    expect(res.status).toBe(200);
    // No probe: the claimed order cannot settle again, so it cannot block.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('sandbox.cashfree.com');
  });
});

// ---------------------------------------------------------------------------
// Phase 2.6 — signed webhook freshness (replay window)
// ---------------------------------------------------------------------------
describe('Phase 2.6: webhook replay freshness', () => {
  function signedWebhook(orderId: string, timestampSeconds: number) {
    const raw = JSON.stringify({
      event_type: 'PAYMENT_SUCCESS',
      data: { order: { order_id: orderId }, payment: { payment_status: 'SUCCESS' } },
    });
    const timestamp = String(timestampSeconds);
    const signature = crypto
      .createHmac('sha256', process.env.CASHFREE_SECRET_KEY!)
      .update(timestamp + raw)
      .digest('base64');
    return new NextRequest('http://localhost/api/cashfree/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-signature': signature,
        'x-webhook-timestamp': timestamp,
      },
      body: raw,
    });
  }

  it('rejects a correctly signed delivery with a stale timestamp', async () => {
    const res = await webhookPOST(signedWebhook('sxs-stale-p2', Math.floor(Date.now() / 1000) - 400));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Invalid signature');
  });

  it('admits a freshly signed delivery past the signature check', async () => {
    const res = await webhookPOST(signedWebhook('sxs-fresh-p2', Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(400);
    // Past freshness + HMAC → the failure is now the unknown order, not the signature.
    expect((await res.json()).error).toBe('Unknown order');
  });
});

// ---------------------------------------------------------------------------
// Phase 2.9 — rate-limit boundaries on high-risk mutations
// ---------------------------------------------------------------------------
describe('Phase 2.9: rate-limit boundaries', () => {
  function ghostAuth() {
    vi.mocked(auth).mockResolvedValue({ user: { id: `ghost-${n}-${Math.random().toString(36).slice(2, 8)}` } } as never);
  }

  async function expectBoundary(call: (i: number) => Promise<{ status: number }>, allowed: number) {
    for (let i = 0; i < allowed; i++) {
      const res = await call(i);
      expect(res.status, `call ${i + 1}/${allowed + 1}`).not.toBe(429);
    }
    const over = await call(allowed);
    expect(over.status).toBe(429);
  }

  it('export creation: 30/h then 429', async () => {
    ghostAuth();
    await expectBoundary(
      () => jobsCreatePOST(new NextRequest('http://localhost/api/export-jobs', { method: 'POST', body: '{}' })),
      30,
    );
  });

  it('export completion: 30/h then 429', async () => {
    ghostAuth();
    await expectBoundary(
      () =>
        completePOST(
          new NextRequest('http://localhost/api/exports/complete', { method: 'POST', body: '{}' }),
        ),
      30,
    );
  });

  it('payment verification: 30/min then 429', async () => {
    ghostAuth();
    await expectBoundary(
      () =>
        verifyPOST(new NextRequest('http://localhost/api/cashfree/verify', { method: 'POST' })),
      30,
    );
  });

  it('export deletion: 30/h then 429', async () => {
    ghostAuth();
    await expectBoundary(
      () => exportDeleteDELETE(new NextRequest('http://localhost/api/exports/x', { method: 'DELETE' }), {
        params: Promise.resolve({ id: 'x' }),
      }),
      30,
    );
  });

  it('account deletion: 5/h then 429', async () => {
    ghostAuth();
    await expectBoundary(
      () => userDeleteDELETE(new NextRequest('http://localhost/api/user/delete', { method: 'DELETE' })),
      5,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 2.4/2.5 — download only signs objects inside the caller's namespace
// ---------------------------------------------------------------------------
describe('Phase 2.4/2.5: download object-key guards', () => {
  async function seedExport(user: { id: string }, r2Key: string) {
    return createExport({
      userId: user.id,
      r2Key,
      platform: 'youtube-landscape',
      outputWidth: 1920,
      outputHeight: 1080,
      fileSize: 1 * MB,
      mimeType: 'video/mp4',
      status: 'completed',
    });
  }

  function downloadReq(exportId: string) {
    return new NextRequest(`http://localhost/api/download?exportId=${encodeURIComponent(exportId)}`);
  }

  it('refuses to sign a local/ key (no R2 object exists)', async () => {
    const user = await seedUser('free');
    const exp = await seedExport(user, `local/${user.id}/p2.mp4`);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);

    const res = await downloadGET(downloadReq(exp.id));

    expect(res.status).toBe(404);
    expect(vi.mocked(getSignedDownloadUrl)).not.toHaveBeenCalled();
  });

  it('refuses to sign another user\'s exports/ namespace', async () => {
    const user = await seedUser('free');
    const foreign = await seedUser('free');
    const exp = await seedExport(user, `exports/${foreign.id}/p2.mp4`);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);

    const res = await downloadGET(downloadReq(exp.id));

    expect(res.status).toBe(404);
    expect(vi.mocked(getSignedDownloadUrl)).not.toHaveBeenCalled();
  });

  it('signs the caller\'s own cloud object', async () => {
    const user = await seedUser('free');
    const exp = await seedExport(user, `exports/${user.id}/p2.mp4`);
    vi.mocked(auth).mockResolvedValue({ user: { id: user.id } } as never);

    const res = await downloadGET(downloadReq(exp.id));

    expect(res.status).toBe(200);
    expect((await res.json()).url).toBe('https://r2.example/signed-url');
    expect(vi.mocked(getSignedDownloadUrl)).toHaveBeenCalledWith(`exports/${user.id}/p2.mp4`, expect.any(Number));
  });
});

// ---------------------------------------------------------------------------
// Phase 2.10 — forgot-password answers identically on both paths
// ---------------------------------------------------------------------------
describe('Phase 2.10: forgot-password enumeration safety', () => {
  function forgotReq(email: string) {
    return new NextRequest('http://localhost/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  }

  it('returns the identical 200 body for existing and unknown addresses', async () => {
    const prevKey = process.env.RESEND_API_KEY;
    delete process.env.RESEND_API_KEY;
    try {
      const user = await createUser('p2-forgot@example.com', 'Forgot', 'hash');
      vi.mocked(findUserByEmail).mockImplementation(async (email: string) =>
        email === 'p2-forgot@example.com' ? user : undefined,
      );

      const existing = await forgotPOST(forgotReq('p2-forgot@example.com'));
      const unknown = await forgotPOST(forgotReq('p2-nobody-unknown@example.invalid'));

      expect(existing.status).toBe(200);
      expect(unknown.status).toBe(200);
      const existingBody = await existing.json();
      const unknownBody = await unknown.json();
      expect(existingBody).toEqual({ ok: true });
      expect(unknownBody).toEqual(existingBody);
    } finally {
      if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
      vi.mocked(findUserByEmail).mockReset();
    }
  });
});
