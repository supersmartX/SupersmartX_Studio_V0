import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  getPaddleEnvironment,
  getPaddleClient,
  getPaddlePriceConfiguration,
  isAuthoritativelyPaid,
  normalizePaddleAmount,
  PaddlePriceMismatchError,
  validatePaddlePaidTotals,
  verifySandboxPriceRecord,
  verifySandboxQuoteToken,
} from '@/lib/billing/paddle';
import {
  acquireBillingEventLease,
  applyAdjustmentEvent,
  applyFailedPaymentEvent,
  applyPaidBillingEvent,
  applySubscriptionSnapshot,
  releaseBillingEventLease,
  renewBillingEventLease,
} from '@/lib/billing/operations';
import { getPrisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH_SIZE = 8;
const LEASE_MS = 4 * 60_000;

class ReviewEventError extends Error {}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function field(source: JsonRecord, camel: string, snake: string): unknown {
  return source[camel] ?? source[snake];
}

function date(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function planValue(value: unknown): 'creator_monthly' | 'creator_yearly' | null {
  return value === 'creator_monthly' || value === 'creator_yearly' ? value : null;
}

function providedSecretMatches(request: NextRequest, expected: string): boolean {
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const configured = Buffer.from(expected);
  return provided.length === configured.length && crypto.timingSafeEqual(provided, configured);
}

async function findReservation(customData: JsonRecord, transactionId?: string) {
  const reservationId = text(customData.sup_reservation_id);
  if (!reservationId) return null;
  const reservation = await getPrisma().billingReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new ReviewEventError('checkout_reservation_not_found');
  if (transactionId && reservation.providerTransactionId &&
      reservation.providerTransactionId !== transactionId) {
    throw new ReviewEventError('checkout_transaction_mismatch');
  }
  const userId = text(customData.sup_user_id);
  const plan = planValue(customData.sup_plan);
  const consentHash = text(customData.sup_consent_hash);
  if ((userId && userId !== reservation.userId) ||
      (plan && plan !== reservation.plan) ||
      (consentHash && consentHash !== reservation.consentHash)) {
    throw new ReviewEventError('checkout_attribution_mismatch');
  }
  return reservation;
}

async function resolveOwner(input: {
  subscriptionId: string;
  customerId: string;
  customData: JsonRecord;
  transactionId?: string;
}) {
  const prisma = getPrisma();
  const [accountBySubscription, customUserId] = await Promise.all([
    prisma.billingAccount.findUnique({ where: { providerSubscriptionId: input.subscriptionId } }),
    text(input.customData.sup_user_id),
  ]);
  const accountByUser = customUserId
    ? await prisma.billingAccount.findUnique({ where: { userId: customUserId } })
    : null;
  const reservation = await findReservation(input.customData, input.transactionId);
  const mappedUserId = accountBySubscription?.userId ?? reservation?.userId ?? accountByUser?.userId ?? null;
  if (!mappedUserId) throw new ReviewEventError('provider_account_not_attributed');
  if ((accountBySubscription && accountBySubscription.userId !== mappedUserId) ||
      (reservation && reservation.userId !== mappedUserId) ||
      (customUserId && customUserId !== mappedUserId)) {
    throw new ReviewEventError('provider_account_owner_mismatch');
  }
  const account = accountByUser ?? await prisma.billingAccount.findUnique({ where: { userId: mappedUserId } });
  if (!account) throw new ReviewEventError('billing_account_not_found');
  if ((account.providerSubscriptionId && account.providerSubscriptionId !== input.subscriptionId) ||
      (account.providerCustomerId && account.providerCustomerId !== input.customerId)) {
    throw new ReviewEventError('provider_customer_or_subscription_mismatch');
  }
  return { userId: mappedUserId, account, reservation };
}

async function processPaidTransaction(
  eventId: string,
  leaseToken: string,
  occurredAt: Date | null,
  eventData: JsonRecord,
  eventCustomData: JsonRecord,
) {
  const paddle = getPaddleClient();
  if (!paddle) throw new Error('Paddle client is not configured');
  const transactionId = text(eventData.id);
  if (!transactionId) throw new ReviewEventError('transaction_id_missing');

  const transaction = await paddle.transactions.get(transactionId, { include: ['address'] });
  if (transaction.id !== transactionId) throw new ReviewEventError('transaction_id_mismatch');
  if (!isAuthoritativelyPaid(transaction.status)) {
    throw new ReviewEventError('transaction_not_paid');
  }
  const subscriptionId = transaction.subscriptionId;
  const customerId = transaction.customerId;
  if (!subscriptionId || !customerId) throw new ReviewEventError('subscription_or_customer_missing');
  const subscription = await paddle.subscriptions.get(subscriptionId);
  if (subscription.id !== subscriptionId || subscription.customerId !== customerId) {
    throw new ReviewEventError('subscription_customer_mismatch');
  }

  const authoritativeCustom = record(transaction.customData);
  const subscriptionCustom = record(subscription.customData);
  const reservationId = text(authoritativeCustom.sup_reservation_id) ??
    text(eventCustomData.sup_reservation_id);
  const customData = {
    ...subscriptionCustom,
    ...eventCustomData,
    ...authoritativeCustom,
    ...(reservationId ? { sup_reservation_id: reservationId } : {}),
  };
  const owner = await resolveOwner({ subscriptionId, customerId, customData, transactionId });
  const plan = planValue(authoritativeCustom.sup_plan) ??
    planValue(subscriptionCustom.sup_plan) ??
    planValue(eventCustomData.sup_plan) ??
    planValue(owner.reservation?.plan) ??
    planValue(owner.account.plan);
  if (!plan) throw new ReviewEventError('transaction_plan_missing');
  const planValues = [authoritativeCustom.sup_plan, subscriptionCustom.sup_plan, eventCustomData.sup_plan]
    .map(planValue).filter((value): value is NonNullable<typeof value> => value !== null);
  if (planValues.some((value) => value !== plan)) {
    throw new ReviewEventError('transaction_plan_mismatch');
  }
  const config = getPaddlePriceConfiguration(plan);
  if (!config) throw new ReviewEventError('price_mapping_not_configured');
  const quoteToken = text(authoritativeCustom.sup_quote_token);
  const consentVersion = text(authoritativeCustom.sup_consent_version);
  let expectedCurrency = config.currency;
  let expectedAmount = config.amount;
  let expectedPriceId = config.priceId;
  let expectedProductId: string | null = null;
  let expectedPeriod = config.period;
  let quotedCountry: string | null = null;
  if (quoteToken) {
    if (getPaddleEnvironment() !== 'sandbox' || consentVersion !== '2') {
      throw new ReviewEventError('checkout_quote_mismatch');
    }
    const transactionCreatedAt = date(transaction.createdAt);
    const quote = transactionCreatedAt
      ? verifySandboxQuoteToken(quoteToken, transactionCreatedAt)
      : null;
    if (!quote || quote.plan !== plan) throw new ReviewEventError('checkout_quote_mismatch');
    if (!owner.reservation || owner.reservation.plan !== plan ||
        owner.reservation.period !== quote.period ||
        owner.reservation.currency !== quote.currency ||
        owner.reservation.consentHash !== text(authoritativeCustom.sup_consent_hash)) {
      throw new ReviewEventError('reservation_does_not_match_paid_transaction');
    }
    expectedCurrency = quote.currency;
    expectedAmount = quote.amount;
    expectedPriceId = quote.priceId;
    expectedProductId = quote.productId;
    expectedPeriod = quote.period;
    quotedCountry = quote.country;
  } else if (consentVersion === '2') {
    throw new ReviewEventError('checkout_quote_missing');
  }

  const items = transaction.items;
  if (items.length !== 1 || items[0].quantity !== 1 || !items[0].price ||
      items[0].price.id !== expectedPriceId ||
      (expectedProductId !== null && items[0].price.productId !== expectedProductId) ||
      items[0].price.unitPrice.currencyCode !== config.currency ||
      normalizePaddleAmount(items[0].price.unitPrice.amount, config.currency, 'minor') !==
        normalizePaddleAmount(config.amount, config.currency) ||
      items[0].price.trialPeriod !== null ||
      items[0].price.billingCycle?.interval !== (expectedPeriod === 'monthly' ? 'month' : 'year') ||
      items[0].price.billingCycle.frequency !== 1) {
    throw new ReviewEventError('transaction_price_mismatch');
  }
  if (getPaddleEnvironment() === 'sandbox') {
    try {
      verifySandboxPriceRecord(items[0].price, plan);
    } catch (error) {
      if (error instanceof PaddlePriceMismatchError) {
        throw new ReviewEventError('transaction_price_mismatch');
      }
      throw error;
    }
  }
  if (quotedCountry !== null &&
      transaction.address?.countryCode?.toUpperCase() !== quotedCountry) {
    throw new ReviewEventError('transaction_country_mismatch');
  }
  const eventSubscriptionId = text(field(eventData, 'subscriptionId', 'subscription_id'));
  const eventCustomerId = text(field(eventData, 'customerId', 'customer_id'));
  if ((eventSubscriptionId && eventSubscriptionId !== subscriptionId) ||
      (eventCustomerId && eventCustomerId !== customerId)) {
    throw new ReviewEventError('event_transaction_attribution_mismatch');
  }
  if (owner.reservation &&
      (owner.reservation.plan !== plan ||
       (quoteToken === null && owner.reservation.consentHash !== text(authoritativeCustom.sup_consent_hash)) ||
       (quoteToken === null && (owner.reservation.period !== config.period ||
         owner.reservation.currency !== config.currency)) ||
       (owner.reservation.providerTransactionId &&
        owner.reservation.providerTransactionId !== transactionId))) {
    throw new ReviewEventError('reservation_does_not_match_paid_transaction');
  }

  const periodStartAt = date(transaction.billingPeriod?.startsAt) ??
    date(subscription.currentBillingPeriod?.startsAt);
  const periodEndAt = date(transaction.billingPeriod?.endsAt) ??
    date(subscription.currentBillingPeriod?.endsAt);
  if (!periodStartAt || !periodEndAt || periodEndAt <= periodStartAt) {
    throw new ReviewEventError('provider_billing_period_missing');
  }
  const paidAt = date(transaction.billedAt) ?? occurredAt ?? date(transaction.updatedAt);
  const totals = transaction.details?.totals;
  const total = totals?.grandTotal;
  if (!paidAt || !total ||
      transaction.currencyCode !== expectedCurrency ||
      !validatePaddlePaidTotals({
        totals,
        lineItems: transaction.details?.lineItems ?? [],
        currency: expectedCurrency,
        quotedAmount: expectedAmount,
      })) {
    throw new ReviewEventError('paid_transaction_totals_invalid');
  }

  await applyPaidBillingEvent({
    eventId,
    leaseToken,
    reservationId: owner.reservation?.id,
    userId: owner.userId,
    plan,
    providerTransactionId: transactionId,
    providerSubscriptionId: subscriptionId,
    providerCustomerId: customerId,
    amount: total,
    currency: transaction.currencyCode,
    paidAt,
    periodStartAt,
    periodEndAt,
    nextChargeAt: date(subscription.nextBilledAt),
  });
}

async function processSubscriptionEvent(
  eventId: string,
  leaseToken: string,
  occurredAt: Date | null,
  eventData: JsonRecord,
) {
  const paddle = getPaddleClient();
  if (!paddle) throw new Error('Paddle client is not configured');
  const subscriptionId = text(eventData.id);
  if (!subscriptionId) throw new ReviewEventError('subscription_id_missing');
  const subscription = await paddle.subscriptions.get(subscriptionId);
  if (subscription.id !== subscriptionId || !subscription.customerId) {
    throw new ReviewEventError('subscription_identity_invalid');
  }
  const customData = record(subscription.customData);
  const owner = await resolveOwner({
    subscriptionId,
    customerId: subscription.customerId,
    customData,
  });
  const scheduledAction = subscription.scheduledChange?.action;
  await applySubscriptionSnapshot({
    eventId,
    leaseToken,
    userId: owner.userId,
    subscriptionId,
    customerId: subscription.customerId,
    status: subscription.status,
    nextChargeAt: date(subscription.nextBilledAt),
    cancelAtPeriodEnd: scheduledAction === 'cancel',
    occurredAt,
  });
}

async function processFailedTransaction(
  eventId: string,
  leaseToken: string,
  occurredAt: Date | null,
  eventData: JsonRecord,
) {
  const paddle = getPaddleClient();
  if (!paddle) throw new Error('Paddle client is not configured');
  const transactionId = text(eventData.id);
  if (!transactionId) throw new ReviewEventError('failed_transaction_id_missing');
  const transaction = await paddle.transactions.get(transactionId);
  if (!transaction.subscriptionId || !transaction.customerId) {
    throw new ReviewEventError('failed_transaction_attribution_missing');
  }
  const customData = {
    ...record(transaction.customData),
    ...record(eventData.customData ?? eventData.custom_data),
  };
  const owner = await resolveOwner({
    subscriptionId: transaction.subscriptionId,
    customerId: transaction.customerId,
    customData,
    transactionId,
  });
  await applyFailedPaymentEvent({
    eventId,
    leaseToken,
    userId: owner.userId,
    providerSubscriptionId: transaction.subscriptionId,
    providerCustomerId: transaction.customerId,
    occurredAt,
  });
}

async function processAdjustment(
  eventId: string,
  leaseToken: string,
  eventData: JsonRecord,
) {
  const adjustmentId = text(eventData.id);
  if (!adjustmentId) throw new ReviewEventError('adjustment_id_missing');
  const transactionId = text(field(eventData, 'transactionId', 'transaction_id'));
  if (!transactionId) throw new ReviewEventError('adjustment_transaction_missing');
  const transaction = await getPrisma().billingTransaction.findUnique({
    where: { providerTransactionId: transactionId },
  });
  if (!transaction?.userId) throw new ReviewEventError('adjustment_transaction_unattributed');
  const paddle = getPaddleClient();
  if (!paddle) throw new Error('Paddle client is not configured');
  const [authoritativeTransaction, adjustments] = await Promise.all([
    paddle.transactions.get(transactionId),
    paddle.adjustments.list({
      id: [adjustmentId],
      transactionId: [transactionId],
      perPage: 1,
    }).next(),
  ]);
  const authoritative = adjustments.find((adjustment) =>
    adjustment.id === adjustmentId && adjustment.transactionId === transactionId);
  if (!authoritative) throw new Error('Paddle adjustment is not yet available');
  if (authoritativeTransaction.id !== transactionId ||
      authoritativeTransaction.subscriptionId !== transaction.providerSubscriptionId ||
      authoritative.customerId !== authoritativeTransaction.customerId ||
      authoritative.subscriptionId !== authoritativeTransaction.subscriptionId ||
      authoritative.currencyCode !== transaction.currency) {
    throw new ReviewEventError('adjustment_transaction_mismatch');
  }
  const eventCustomerId = text(field(eventData, 'customerId', 'customer_id'));
  const eventSubscriptionId = text(field(eventData, 'subscriptionId', 'subscription_id'));
  if ((eventCustomerId && eventCustomerId !== authoritative.customerId) ||
      (eventSubscriptionId && eventSubscriptionId !== authoritative.subscriptionId)) {
    throw new ReviewEventError('adjustment_provider_attribution_mismatch');
  }
  const account = await getPrisma().billingAccount.findUnique({ where: { userId: transaction.userId } });
  if (!account || (account.providerCustomerId && account.providerCustomerId !== authoritative.customerId)) {
    throw new ReviewEventError('adjustment_customer_mismatch');
  }
  await applyAdjustmentEvent({
    eventId,
    leaseToken,
    adjustmentId,
    transactionId,
    action: authoritative.action,
    actionType: authoritative.type,
    status: authoritative.status,
    amount: authoritative.totals.total,
    currency: authoritative.currencyCode,
    updatedAt: new Date(authoritative.updatedAt),
  });
}

async function processEvent(event: JsonRecord, eventId: string, leaseToken: string, occurredAt: Date | null) {
  const eventType = text(field(event, 'eventType', 'event_type'));
  const data = record(event.data);
  const customData = record(field(data, 'customData', 'custom_data'));

  if (eventType === 'transaction.paid' || eventType === 'transaction.completed' || eventType === 'transaction.billed') {
    await processPaidTransaction(eventId, leaseToken, occurredAt, data, customData);
    return 'processed' as const;
  }
  if (eventType === 'transaction.payment_failed' || eventType === 'transaction.past_due') {
    await processFailedTransaction(eventId, leaseToken, occurredAt, data);
    return 'processed' as const;
  }
  if (eventType === 'subscription.created' || eventType === 'subscription.activated' ||
      eventType === 'subscription.updated' || eventType === 'subscription.canceled' ||
      eventType === 'subscription.past_due' || eventType === 'subscription.resumed' ||
      eventType === 'subscription.paused') {
    await processSubscriptionEvent(eventId, leaseToken, occurredAt, data);
    return 'processed' as const;
  }
  if (eventType === 'adjustment.created' || eventType === 'adjustment.updated') {
    await processAdjustment(eventId, leaseToken, data);
    return 'processed' as const;
  }
  return 'ignored' as const;
}

async function processWithLeaseHeartbeat<T>(
  eventId: string,
  leaseToken: string,
  process: () => Promise<T>,
): Promise<T> {
  const renew = () => renewBillingEventLease(
    eventId,
    leaseToken,
    new Date(Date.now() + LEASE_MS),
  );
  if (!await renew()) throw new Error('Billing event lease was lost before processing');

  let renewal = Promise.resolve();
  const heartbeat = setInterval(() => {
    renewal = renewal.then(async () => {
      try {
        if (!await renew()) {
          console.error('Paddle event lease renewal was fenced', eventId);
        }
      } catch {
        console.error('Paddle event lease renewal failed', eventId);
      }
    });
  }, 30_000);

  try {
    return await process();
  } finally {
    clearInterval(heartbeat);
    await renewal;
  }
}

async function reconcileCancellationOperations() {
  const prisma = getPrisma();
  const paddle = getPaddleClient();
  if (!paddle) return 0;
  const operations = await prisma.billingOperation.findMany({
    where: {
      operation: 'cancel_at_period_end',
      status: { in: ['pending', 'uncertain'] },
    },
    orderBy: { createdAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true, userId: true, resourceId: true },
  });
  let reconciled = 0;
  for (const operation of operations) {
    try {
      const subscription = await paddle.subscriptions.get(operation.resourceId);
      const scheduledCancel = subscription.scheduledChange?.action === 'cancel';
      if (scheduledCancel || subscription.status === 'canceled') {
        await prisma.$transaction([
          prisma.billingOperation.updateMany({
            where: { id: operation.id, status: { in: ['pending', 'uncertain'] } },
            data: { status: 'completed', completedAt: new Date(), lastError: null },
          }),
          prisma.billingAccount.updateMany({
            where: {
              userId: operation.userId,
              providerSubscriptionId: operation.resourceId,
            },
            data: {
              cancelAtPeriodEnd: scheduledCancel,
              status: subscription.status,
              ...(subscription.status === 'canceled' && subscription.canceledAt
                ? { canceledAt: new Date(subscription.canceledAt) }
                : {}),
            },
          }),
        ]);
        reconciled += 1;
      } else if (subscription.status === 'active' || subscription.status === 'trialing' ||
          subscription.status === 'past_due') {
        await prisma.billingOperation.updateMany({
          where: { id: operation.id, status: { in: ['pending', 'uncertain'] } },
          data: {
            status: 'failed',
            lastError: 'provider_confirms_cancellation_not_scheduled',
          },
        });
        reconciled += 1;
      }
    } catch {
      console.error('Paddle cancellation reconciliation failed', operation.id);
    }
  }
  return reconciled;
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: 'Billing worker is not configured' }, { status: 503 });
  if (!providedSecretMatches(request, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!getPaddleClient()) {
    return NextResponse.json({ error: 'Paddle client is not configured' }, { status: 503 });
  }

  const prisma = getPrisma();
  const now = new Date();
  const candidates = await prisma.billingEvent.findMany({
    where: {
      status: { in: ['received', 'failed', 'processing'] },
      nextAttemptAt: { lte: now },
      OR: [{ leaseOwner: null }, { leasedUntil: null }, { leasedUntil: { lt: now } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: BATCH_SIZE,
    select: { eventId: true, payloadJson: true, occurredAt: true },
  });
  const counts = { processed: 0, ignored: 0, review: 0, retry: 0, leased: 0, cancellationsReconciled: 0 };
  const owner = `paddle-worker:${crypto.randomUUID()}`;

  for (const candidate of candidates) {
    const leaseToken = crypto.randomUUID();
    const leased = await acquireBillingEventLease(
      candidate.eventId,
      owner,
      leaseToken,
      new Date(Date.now() + LEASE_MS),
    );
    if (!leased) continue;
    counts.leased += 1;
    try {
      const event = record(JSON.parse(candidate.payloadJson));
      const result = await processWithLeaseHeartbeat(
        candidate.eventId,
        leaseToken,
        () => processEvent(event, candidate.eventId, leaseToken, candidate.occurredAt),
      );
      if (result === 'ignored') {
        await releaseBillingEventLease(candidate.eventId, leaseToken, 'ignored', 'unsupported_event_type');
        counts.ignored += 1;
      } else {
        counts.processed += 1;
      }
    } catch (error) {
      if (error instanceof ReviewEventError) {
        await releaseBillingEventLease(candidate.eventId, leaseToken, 'review', error.message);
        counts.review += 1;
      } else {
        await releaseBillingEventLease(candidate.eventId, leaseToken, 'failed', 'provider_or_persistence_error');
        console.error('Paddle event processing failed', candidate.eventId);
        counts.retry += 1;
      }
    }
  }
  counts.cancellationsReconciled = await reconcileCancellationOperations();
  return NextResponse.json(counts, { headers: { 'Cache-Control': 'no-store' } });
}
