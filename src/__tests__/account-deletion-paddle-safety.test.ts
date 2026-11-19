import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUserById: vi.fn(),
  listUserExportR2Keys: vi.fn(),
  purgeUserOwnedData: vi.fn(),
  deleteUserById: vi.fn(),
  recordDeletedIdentity: vi.fn(),
  listUserRecordings: vi.fn(),
  deleteRecording: vi.fn(),
  rateLimit: vi.fn(),
  billingAccountFindUnique: vi.fn(),
  reservationFindFirst: vi.fn(),
  operationFindFirst: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db', () => ({
  findUserById: mocks.findUserById,
  listUserExportR2Keys: mocks.listUserExportR2Keys,
  purgeUserOwnedData: mocks.purgeUserOwnedData,
  deleteUserById: mocks.deleteUserById,
  recordDeletedIdentity: mocks.recordDeletedIdentity,
}));
vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => ({
    billingAccount: { findUnique: mocks.billingAccountFindUnique },
    billingReservation: { findFirst: mocks.reservationFindFirst },
    billingOperation: { findFirst: mocks.operationFindFirst },
  }),
}));
vi.mock('@/lib/r2', () => ({
  listUserRecordings: mocks.listUserRecordings,
  deleteRecording: mocks.deleteRecording,
}));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: mocks.rateLimit }));

import { DELETE } from '@/app/api/user/delete/route';

function request() {
  return new NextRequest('http://localhost/api/user/delete', { method: 'DELETE' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-1', email: 'ada@example.com' } });
  mocks.findUserById.mockResolvedValue({ id: 'user-1', email: 'ada@example.com', sessionVersion: 2 });
  mocks.listUserExportR2Keys.mockResolvedValue([]);
  mocks.purgeUserOwnedData.mockResolvedValue(undefined);
  mocks.deleteUserById.mockResolvedValue(true);
  mocks.recordDeletedIdentity.mockResolvedValue(undefined);
  mocks.listUserRecordings.mockResolvedValue([]);
  mocks.deleteRecording.mockResolvedValue(undefined);
  mocks.rateLimit.mockReturnValue({ allowed: true });
  mocks.billingAccountFindUnique.mockResolvedValue(null);
  mocks.reservationFindFirst.mockResolvedValue(null);
  mocks.operationFindFirst.mockResolvedValue(null);
});

describe('account deletion Paddle safety', () => {
  it('blocks deletion while a Paddle subscription can still renew', async () => {
    mocks.billingAccountFindUnique.mockResolvedValue({
      providerSubscriptionId: 'sub-1',
      status: 'active',
      cancelAtPeriodEnd: false,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/stop future Paddle billing/i) });
    expect(mocks.listUserExportR2Keys).not.toHaveBeenCalled();
    expect(mocks.purgeUserOwnedData).not.toHaveBeenCalled();
    expect(mocks.deleteUserById).not.toHaveBeenCalled();
  });

  it('blocks deletion while a checkout reservation is unresolved', async () => {
    mocks.reservationFindFirst.mockResolvedValue({ id: 'reservation-1' });

    const response = await DELETE(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/still being reconciled/i) });
    expect(mocks.purgeUserOwnedData).not.toHaveBeenCalled();
    expect(mocks.deleteUserById).not.toHaveBeenCalled();
  });

  it('allows deletion after cancellation is provider-confirmed for the paid period', async () => {
    mocks.billingAccountFindUnique.mockResolvedValue({
      providerSubscriptionId: 'sub-1',
      status: 'active',
      cancelAtPeriodEnd: true,
    });

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(mocks.purgeUserOwnedData).toHaveBeenCalledWith('user-1');
    expect(mocks.deleteUserById).toHaveBeenCalledWith('user-1');
  });
});
