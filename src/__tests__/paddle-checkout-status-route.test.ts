import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findReservation: vi.fn(),
  updateReservation: vi.fn(),
  transactionGet: vi.fn(),
  transactionList: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mocks.auth }));
vi.mock('@/lib/db/prisma', () => ({
  getPrisma: () => ({
    billingReservation: {
      findUnique: mocks.findReservation,
      updateMany: mocks.updateReservation,
    },
  }),
}));
vi.mock('@/lib/billing/paddle', () => ({
  getPaddleEnvironment: () => 'sandbox',
  getPaddleClient: () => ({
    transactions: {
      get: mocks.transactionGet,
      list: mocks.transactionList,
    },
  }),
  isSafePaddleCheckoutUrl: (value: string) => value.startsWith('https://checkout.paddle.com/'),
}));

import { GET } from '@/app/api/paddle/checkout/status/route';

const reservation = {
  id: 'reservation-1',
  userId: 'user-1',
  plan: 'creator_monthly',
  consentHash: 'consent-1',
  providerTransactionId: 'txn-1',
  status: 'pending',
  createdAt: new Date('2026-11-18T12:00:00.000Z'),
};

function request(reservationId = 'reservation-1') {
  return new NextRequest(
    `http://localhost/api/paddle/checkout/status?reservationId=${reservationId}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: 'user-1' } });
  mocks.findReservation.mockResolvedValue(reservation);
  mocks.updateReservation.mockResolvedValue({ count: 1 });
});

describe('Paddle checkout recovery', () => {
  it('returns a verified hosted checkout URL for the owning user', async () => {
    mocks.transactionGet.mockResolvedValue({
      id: 'txn-1',
      status: 'ready',
      customData: {
        sup_user_id: 'user-1',
        sup_reservation_id: 'reservation-1',
        sup_plan: 'creator_monthly',
        sup_consent_hash: 'consent-1',
      },
      checkout: { url: 'https://checkout.paddle.com/checkout/txn-1' },
    });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'pending',
      retryAllowed: false,
      checkoutUrl: 'https://checkout.paddle.com/checkout/txn-1',
    });
  });

  it('keeps verified payment pending until the webhook applies entitlement', async () => {
    mocks.transactionGet.mockResolvedValue({
      id: 'txn-1',
      status: 'paid',
      customData: {
        sup_user_id: 'user-1',
        sup_reservation_id: 'reservation-1',
        sup_plan: 'creator_monthly',
        sup_consent_hash: 'consent-1',
      },
      checkout: null,
    });

    const response = await GET(request());

    expect(await response.json()).toMatchObject({
      status: 'payment_received',
      retryAllowed: false,
      checkoutUrl: null,
    });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it('does not expose another user’s reservation', async () => {
    mocks.findReservation.mockResolvedValue({ ...reservation, userId: 'user-2' });

    const response = await GET(request());

    expect(response.status).toBe(404);
    expect(mocks.transactionGet).not.toHaveBeenCalled();
  });

  it('reports a released reservation as retryable without asking Paddle again', async () => {
    mocks.findReservation.mockResolvedValue({
      ...reservation,
      status: 'failed',
      providerTransactionId: null,
    });

    const response = await GET(request());

    expect(await response.json()).toMatchObject({
      status: 'failed',
      retryAllowed: true,
      checkoutUrl: null,
    });
    expect(mocks.transactionGet).not.toHaveBeenCalled();
    expect(mocks.transactionList).not.toHaveBeenCalled();
  });

  it('recovers a timed-out create by exact reservation metadata without granting access', async () => {
    mocks.findReservation.mockResolvedValue({
      ...reservation,
      providerTransactionId: null,
    });
    const recovered = {
      id: 'txn-recovered',
      status: 'ready',
      customData: {
        sup_user_id: 'user-1',
        sup_reservation_id: 'reservation-1',
        sup_plan: 'creator_monthly',
        sup_consent_hash: 'consent-1',
      },
    };
    const collection = {
      hasMore: false,
      next: vi.fn().mockResolvedValue([recovered]),
    };
    mocks.transactionList.mockReturnValue(collection);
    mocks.transactionGet.mockResolvedValue({
      ...recovered,
      checkout: { url: 'https://checkout.paddle.com/checkout/txn-recovered' },
    });

    const response = await GET(request());

    expect(mocks.transactionList).toHaveBeenCalledWith(expect.objectContaining({
      perPage: 100,
    }));
    expect(mocks.updateReservation).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'reservation-1',
        providerTransactionId: null,
      }),
      data: expect.objectContaining({
        providerTransactionId: 'txn-recovered',
        status: 'pending',
      }),
    }));
    expect(await response.json()).toMatchObject({
      status: 'pending',
      checkoutUrl: 'https://checkout.paddle.com/checkout/txn-recovered',
    });
  });

  it('keeps a recent checkout pending while its create window is still open', async () => {
    mocks.findReservation.mockResolvedValue({
      ...reservation,
      providerTransactionId: null,
      createdAt: new Date(Date.now() - 60_000),
    });
    mocks.transactionList.mockReturnValue({ hasMore: false, next: vi.fn().mockResolvedValue([]) });

    const response = await GET(request());

    expect(await response.json()).toMatchObject({
      status: 'pending',
      retryAllowed: false,
      message: 'Checkout creation is still being reconciled. Do not start another checkout yet.',
    });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });

  it('expires a stale reservation Paddle never saw and allows a new checkout', async () => {
    mocks.findReservation.mockResolvedValue({
      ...reservation,
      providerTransactionId: null,
      createdAt: new Date(Date.now() - 25 * 60_000),
    });
    mocks.transactionList.mockReturnValue({ hasMore: false, next: vi.fn().mockResolvedValue([]) });

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'failed',
      retryAllowed: true,
      checkoutUrl: null,
    });
    expect(mocks.updateReservation).toHaveBeenCalledWith({
      where: {
        id: 'reservation-1',
        userId: 'user-1',
        status: { in: ['reserved', 'pending'] },
        providerTransactionId: null,
      },
      data: { status: 'expired' },
    });
  });

  it('does not expire a stale reservation while the transaction search is inconclusive', async () => {
    mocks.findReservation.mockResolvedValue({
      ...reservation,
      providerTransactionId: null,
      createdAt: new Date(Date.now() - 25 * 60_000),
    });
    let pages = 0;
    mocks.transactionList.mockReturnValue({
      hasMore: true,
      next: vi.fn().mockImplementation(async () => {
        pages += 1;
        return [];
      }),
    });

    const response = await GET(request());

    expect(pages).toBe(5);
    expect(await response.json()).toMatchObject({ status: 'pending', retryAllowed: false });
    expect(mocks.updateReservation).not.toHaveBeenCalled();
  });
});
