import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findReservation: vi.fn(),
  findTransaction: vi.fn(),
  paddleGet: vi.fn(),
  reconcile: vi.fn(),
  after: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/prisma', () => ({ getPrisma: () => ({ billingReservation: { findUnique: mocks.findReservation }, billingTransaction: { findUnique: mocks.findTransaction } }) }));
vi.mock('@/lib/billing/paddle', () => ({ getPaddleEnvironment: () => 'sandbox', getPaddleClient: () => ({ transactions: { get: mocks.paddleGet } }) }));
vi.mock('@/lib/billing/reservations', () => ({ requestPaidCheckoutReconciliation: mocks.reconcile }));
vi.mock('@/lib/billing/worker-trigger', () => ({ triggerBillingWorker: vi.fn() }));
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return { ...actual, after: mocks.after };
});

import { GET } from '@/app/api/paddle/activation/route';

const reservation = {
  id: 'reservation-1', userId: 'user-1', plan: 'creator_monthly', consentHash: 'hash-1',
  providerTransactionId: 'txn-1', status: 'pending',
};
const paidTransaction = {
  id: 'txn-1', status: 'paid', billedAt: '2026-11-22T10:00:00.000Z',
  customData: { sup_user_id: 'user-1', sup_reservation_id: 'reservation-1', sup_plan: 'creator_monthly', sup_consent_hash: 'hash-1' },
};

function request(reservationId = 'reservation-1', transactionId = 'txn-1') {
  return new NextRequest(`http://localhost/api/paddle/activation?reservationId=${reservationId}&transactionId=${transactionId}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
  mocks.findReservation.mockResolvedValue(reservation);
  mocks.paddleGet.mockResolvedValue(paidTransaction);
  mocks.findTransaction.mockResolvedValue(null);
  mocks.reconcile.mockResolvedValue(undefined);
  mocks.after.mockImplementation((fn: () => unknown) => { void fn; });
});

describe('Paddle activation verification', () => {
  it('rejects unauthenticated requests', async () => { mocks.auth.mockResolvedValue(null); expect((await GET(request())).status).toBe(401); });
  it('rejects missing correlation identifiers', async () => {
    expect((await GET(new NextRequest('http://localhost/api/paddle/activation?transactionId=txn-1'))).status).toBe(400);
    expect((await GET(new NextRequest('http://localhost/api/paddle/activation?reservationId=reservation-1'))).status).toBe(400);
  });
  it('rejects another user reservation', async () => { mocks.findReservation.mockResolvedValue({ ...reservation, userId: 'user-2' }); expect((await GET(request())).status).toBe(404); expect(mocks.paddleGet).not.toHaveBeenCalled(); });
  it('rejects reservation/transaction mismatch', async () => { mocks.findReservation.mockResolvedValue({ ...reservation, providerTransactionId: 'txn-other' }); expect((await GET(request())).status).toBe(409); });
  it('rejects incorrect Paddle metadata', async () => { mocks.paddleGet.mockResolvedValue({ ...paidTransaction, customData: { ...paidTransaction.customData, sup_user_id: 'user-2' } }); expect((await GET(request())).status).toBe(409); expect(mocks.reconcile).not.toHaveBeenCalled(); });
  it('keeps draft and ready transactions pending', async () => {
    for (const status of ['draft', 'ready']) {
      mocks.paddleGet.mockResolvedValue({ ...paidTransaction, status });
      const response = await GET(request());
      expect(await response.json()).toMatchObject({ status: 'pending', orderId: 'txn-1' });
      expect(mocks.reconcile).not.toHaveBeenCalled();
    }
  });
  it('keeps paid transactions pending until the matching entitlement exists', async () => {
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ status: 'pending' });
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
  });
  it('returns activated only for the matching granted entitlement', async () => {
    mocks.findTransaction.mockResolvedValue({ userId: 'user-1', plan: 'creator_monthly', entitlementGrantedAt: new Date(), periodEndAt: new Date(Date.now() + 86_400_000) });
    const response = await GET(request());
    expect(await response.json()).toMatchObject({ status: 'activated', orderId: 'txn-1', plan: 'creator_monthly' });
  });
  it('rejects a cross-user local entitlement', async () => {
    mocks.findTransaction.mockResolvedValue({ userId: 'user-2', plan: 'creator_monthly', entitlementGrantedAt: new Date(), periodEndAt: new Date(Date.now() + 86_400_000) });
    expect((await GET(request())).status).toBe(200);
    expect(await (await GET(request())).json()).toMatchObject({ status: 'pending' });
  });
  it('is idempotent across repeated activation requests', async () => {
    mocks.findTransaction.mockResolvedValue({ userId: 'user-1', plan: 'creator_monthly', entitlementGrantedAt: new Date(), periodEndAt: new Date(Date.now() + 86_400_000) });
    const first = await GET(request()); const second = await GET(request());
    expect((await first.json()).status).toBe('activated'); expect((await second.json()).status).toBe('activated');
  });
  it('keeps provider failures recoverable', async () => { mocks.paddleGet.mockRejectedValue(new Error('provider unavailable')); const response = await GET(request()); expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ status: 'pending' }); });
});
