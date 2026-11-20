import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => ({
    billingReservation: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  }),
}));

import {
  expireStaleUnclaimedCheckoutReservations,
  isStaleCheckoutReservation,
} from '@/lib/billing/reservations';

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reservation-1',
    userId: 'user-1',
    plan: 'creator_monthly',
    consentHash: 'consent-1',
    createdAt: new Date(Date.now() - 25 * 60_000),
    status: 'pending',
    providerTransactionId: null,
    ...overrides,
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'txn-1',
    status: 'ready',
    customData: {
      sup_user_id: 'user-1',
      sup_reservation_id: 'reservation-1',
      sup_plan: 'creator_monthly',
      sup_consent_hash: 'consent-1',
    },
    ...overrides,
  };
}

function collection(transactions: unknown[]) {
  return { hasMore: false, next: vi.fn().mockResolvedValue(transactions) };
}

function paddleWith(page: unknown) {
  return { transactions: { list: vi.fn(() => page) } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('stale checkout reservation lifecycle', () => {
  it('expires an old unclaimed reservation Paddle never saw', async () => {
    const row = reservation();
    mocks.findMany.mockResolvedValue([row]);

    await expect(expireStaleUnclaimedCheckoutReservations({
      userId: 'user-1',
      paddle: paddleWith(collection([])),
    })).resolves.toEqual({ expired: ['reservation-1'], linked: [] });

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'reservation-1',
        userId: 'user-1',
        status: { in: ['reserved', 'pending'] },
        providerTransactionId: null,
      },
      data: { status: 'expired' },
    });
  });

  it('links a late transaction instead of expiring its reservation', async () => {
    mocks.findMany.mockResolvedValue([reservation()]);

    await expect(expireStaleUnclaimedCheckoutReservations({
      userId: 'user-1',
      paddle: paddleWith(collection([transaction()])),
    })).resolves.toEqual({ expired: [], linked: ['reservation-1'] });

    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        providerTransactionId: 'txn-1',
        status: 'pending',
      }),
    }));
  });

  it('leaves the reservation blocking when Paddle cannot be reached', async () => {
    mocks.findMany.mockResolvedValue([reservation()]);
    const paddle = {
      transactions: { list: vi.fn(() => { throw new Error('provider unavailable'); }) },
    } as never;

    await expect(expireStaleUnclaimedCheckoutReservations({ userId: 'user-1', paddle }))
      .resolves.toEqual({ expired: [], linked: [] });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('leaves ambiguous matches for manual review', async () => {
    mocks.findMany.mockResolvedValue([reservation()]);

    await expect(expireStaleUnclaimedCheckoutReservations({
      userId: 'user-1',
      paddle: paddleWith(collection([transaction(), transaction({ id: 'txn-2' })])),
    })).resolves.toEqual({ expired: [], linked: [] });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('does not touch reservations that are not old enough', async () => {
    const paddle = paddleWith(collection([]));

    await expect(expireStaleUnclaimedCheckoutReservations({ userId: 'user-1', paddle }))
      .resolves.toEqual({ expired: [], linked: [] });
    expect((paddle as unknown as { transactions: { list: ReturnType<typeof vi.fn> } })
      .transactions.list).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('only treats unlinked, still-open, aged reservations as stale', () => {
    const now = new Date('2026-11-20T12:00:00.000Z');
    const old = new Date(now.getTime() - 25 * 60_000);
    const recent = new Date(now.getTime() - 5 * 60_000);

    expect(isStaleCheckoutReservation(
      { createdAt: old, status: 'pending', providerTransactionId: null }, now)).toBe(true);
    expect(isStaleCheckoutReservation(
      { createdAt: old, status: 'reserved', providerTransactionId: null }, now)).toBe(true);
    expect(isStaleCheckoutReservation(
      { createdAt: recent, status: 'pending', providerTransactionId: null }, now)).toBe(false);
    expect(isStaleCheckoutReservation(
      { createdAt: old, status: 'pending', providerTransactionId: 'txn-1' }, now)).toBe(false);
    expect(isStaleCheckoutReservation(
      { createdAt: old, status: 'confirmed', providerTransactionId: 'txn-1' }, now)).toBe(false);
  });
});
