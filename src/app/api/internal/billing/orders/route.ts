import { CashfreeRequestError, fetchCashfreeOrder, isCashfreeEnvUsable } from '@/lib/cashfree-fulfillment';
import { getCashfreeConfig } from '@/lib/cashfree-config';
import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  countPendingOrdersByStatus,
  findPendingOrderLifecycle,
  listPendingOrdersForOps,
} from '@/lib/db';
import {
  buildReconciliationReport,
  reconcileOrder,
  releaseHeldOrder,
} from '@/lib/pending-order-reconcile';
import { PENDING_ORDER_STATUSES } from '@/lib/pending-order-status';
import { getRequestId, logger } from '@/lib/observe/logger';

/**
 * Billing operations surface for the pending-order lifecycle.
 *
 * It exists so that a PAID-but-unapplied order, or a reservation whose create
 * outcome can no longer be proven either way, has an explicit, auditable exit
 * that is not a timeout. Everything here is secret-gated, and every write path
 * re-reads the gateway before acting: an operator can make an order visible,
 * but cannot close a paid one by accident.
 *
 * `BILLING_OPS_SECRET` is deliberately separate from `CLEANUP_SECRET`: this
 * endpoint can move entitlement-bearing orders, and rotating it should not
 * require rotating the export cleanup job (or vice versa).
 */

const ACTIONABLE_STATUSES = [
  'creating',
  'open',
  'termination_requested',
  'held_review',
  'unverified',
] as const;

function readProvidedSecret(request: NextRequest): string | null {
  const header = request.headers.get('x-billing-ops-secret');
  if (header) return header;
  const authorization = request.headers.get('authorization');
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1] : null;
}

/**
 * Compares digests rather than the strings themselves, so the comparison time
 * carries no information about the secret's length or prefix.
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  const expectedDigest = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

type AuthOutcome = { ok: true } | { ok: false; response: NextResponse };

function authorize(request: NextRequest, requestId: string): AuthOutcome {
  const expected = process.env.BILLING_OPS_SECRET;
  if (!expected) {
    // Fail closed and say why: an unset secret is a deployment mistake, not an
    // invitation to run unauthenticated.
    logger.error('billing_ops.not_configured', { route: '/api/internal/billing/orders', requestId });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Billing operations endpoint is not configured' },
        { status: 503, headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } },
      ),
    };
  }
  const provided = readProvidedSecret(request);
  if (!provided || !secretsMatch(provided, expected)) {
    logger.warn('billing_ops.unauthorized', { route: '/api/internal/billing/orders', requestId });
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401, headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' } },
      ),
    };
  }
  return { ok: true };
}

function json(body: unknown, status = 200, requestId = 'unknown'): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { 'x-request-id': requestId, 'Cache-Control': 'no-store' },
  });
}

function parseStatuses(raw: string | null): readonly string[] {
  if (!raw) return ACTIONABLE_STATUSES;
  const requested = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const valid = requested.filter((status) => (PENDING_ORDER_STATUSES as readonly string[]).includes(status));
  return valid.length > 0 ? valid : ACTIONABLE_STATUSES;
}

function parseLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(200, parsed);
}

// Temporary investigation scope: supplied existing orders only, never arbitrary URLs.
const DIAGNOSTIC_ORDER_IDS = new Set([
  'sxs-creator_monthly-a0c3367c-0724-4061-84c6-bb418b119d09',
  'sxs-creator_monthly-e8c0348e-169f-4ffa-9779-60be176648c4',
  'sxs-creator_monthly-f4797b8d-911f-4638-ba42-640e948653ac',
]);

/** No database access, reconciliation, raw gateway bodies, or retries. */
async function diagnoseCashfree(params: URLSearchParams, requestId: string) {
  const orderId = params.get('orderId');
  if (params.getAll('orderId').length !== 1 || !orderId || !DIAGNOSTIC_ORDER_IDS.has(orderId)) {
    return json({ error: 'An explicitly supplied approved existing orderId is required' }, 400, requestId);
  }
  try {
    if (getCashfreeConfig().mode !== 'production') throw new Error('production_required');
  } catch {
    return json({ configurationValidation: 'FAIL', authentication: 'NOT_TESTED', httpStatus: null,
      gatewayErrorCode: null, gatewayMessage: null, gatewayRequestId: null, orderFound: null }, 503, requestId);
  }

  const result = {
    configurationValidation: 'PASS', authentication: 'UNVERIFIED',
    httpStatus: null as number | null, gatewayRequestId: null as string | null,
    gatewayErrorCode: null as string | null, gatewayMessage: null as string | null,
    orderFound: null as boolean | null,
  };
  try {
    const order = await fetchCashfreeOrder(orderId, (metadata) => {
      result.httpStatus = metadata.status;
      // Cashfree correlation IDs are UUIDs. Do not reflect arbitrary header text.
      const id = metadata.gatewayRequestId;
      result.gatewayRequestId = id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
    });
    if (order?.order_id === orderId) {
      result.authentication = 'PASS';
      result.orderFound = true;
    } else {
      result.gatewayErrorCode = 'unexpected_order_response';
      result.gatewayMessage = 'Cashfree did not return the requested order';
    }
  } catch (error) {
    if (error instanceof CashfreeRequestError) {
      result.httpStatus = error.status;
      result.authentication = error.status === 401 || error.status === 403 ? 'FAIL' : 'UNVERIFIED';
      result.orderFound = error.status === 404 ? false : null;
      // Allowlisted error text only: upstream messages can contain customer data.
      const code = error.diagnostics?.gatewayErrorCode;
      result.gatewayErrorCode = code && ['request_failed', 'authentication_error', 'order_not_found',
        'order_id_invalid', 'invalid_request_error'].includes(code) ? code : 'cashfree_error';
      result.gatewayMessage = error.diagnostics?.gatewayMessage === 'authentication Failed'
        ? 'authentication Failed' : `Cashfree returned HTTP ${error.status}`;
    } else {
      result.gatewayErrorCode = 'gateway_request_or_response_failed';
      result.gatewayMessage = 'Cashfree request or response could not be completed';
    }
  }
  // HTTP 200 means the diagnostic completed; httpStatus describes Cashfree.
  return json(result, 200, requestId);
}

/**
 * GET — read-only reconciliation report.
 *
 * Never writes: it reports what the database and (optionally) the gateway say
 * about each order, plus a recommendation. `?probe=1` costs one gateway read
 * per `unverified`/`held_review` row, so it is opt-in.
 */
export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = authorize(request, requestId);
  if (!auth.ok) return auth.response;

  if (request.nextUrl.searchParams.has('diagnostic')) {
    if (request.nextUrl.searchParams.getAll('diagnostic').length !== 1 ||
      request.nextUrl.searchParams.get('diagnostic') !== 'cashfree-auth') {
      return json({ error: 'Unsupported diagnostic' }, 400, requestId);
    }
    return diagnoseCashfree(request.nextUrl.searchParams, requestId);
  }

  try {
    const params = request.nextUrl.searchParams;
    const statuses = parseStatuses(params.get('status'));
    const limit = parseLimit(params.get('limit'));
    const probe = params.get('probe') === '1' || params.get('probe') === 'true';

    if (probe && !isCashfreeEnvUsable()) return json({ error: 'Payment gateway not configured' }, 503, requestId);

    const rows = await listPendingOrdersForOps({ statuses, limit });
    const report = await buildReconciliationReport({ rows, probe });
    const counts = await countPendingOrdersByStatus();

    return json(
      {
        generatedAt: new Date().toISOString(),
        filter: { statuses, limit, probe },
        counts,
        gatewayCalls: report.gatewayCalls,
        orders: report.rows,
      },
      200,
      requestId,
    );
  } catch (error) {
    logger.error('billing_ops.report_failed', {
      route: '/api/internal/billing/orders',
      requestId,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return json({ error: 'Report failed' }, 500, requestId);
  }
}

interface OpsBody {
  action?: 'reconcile' | 'release';
  orderId?: string;
  /** Reconcile defaults to a dry run: only `dryRun: false` writes. */
  dryRun?: boolean;
  resolution?: 'fulfilled_manually' | 'refunded' | 'not_paid';
  /** Release requires the literal string, so it cannot be sent by accident. */
  confirm?: string;
}

/**
 * POST — `reconcile` or `release`.
 *
 * `reconcile` with `dryRun !== false` is the same read-only report as GET,
 * scoped to one order. With `dryRun: false` it runs the same state machine the
 * checkout path runs, so an operator cannot produce a state a checkout would
 * not.
 */
export async function POST(request: NextRequest) {
  const requestId = getRequestId(request);
  const auth = authorize(request, requestId);
  if (!auth.ok) return auth.response;

  let body: OpsBody;
  try {
    body = (await request.json()) as OpsBody;
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, requestId);
  }

  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
  if (!orderId) return json({ error: 'orderId is required' }, 400, requestId);

  if (!isCashfreeEnvUsable()) return json({ error: 'Payment gateway not configured' }, 503, requestId);

  const row = await findPendingOrderLifecycle(orderId).catch(() => null);
  if (!row) return json({ error: 'Order not found' }, 404, requestId);

  if (body.action === 'release') {
    if (body.confirm !== 'RELEASE') {
      return json(
        { error: 'Release requires confirm: "RELEASE"', currentStatus: row.status },
        400,
        requestId,
      );
    }
    const resolution = body.resolution;
    if (resolution !== 'fulfilled_manually' && resolution !== 'refunded' && resolution !== 'not_paid') {
      return json(
        { error: 'resolution must be one of fulfilled_manually, refunded, not_paid' },
        400,
        requestId,
      );
    }
    try {
      const result = await releaseHeldOrder({ orderId, resolution, ctx: { requestId, source: 'ops' } });
      const refreshed = await findPendingOrderLifecycle(orderId);
      return json(
        { action: 'release', ...result, currentStatus: refreshed?.status ?? row.status },
        result.ok ? 200 : 409,
        requestId,
      );
    } catch (error) {
      logger.error('billing_ops.release_failed', {
        route: '/api/internal/billing/orders',
        requestId,
        orderId,
        errorType: error instanceof Error ? error.name : 'unknown',
      });
      return json({ error: 'Release failed' }, 500, requestId);
    }
  }

  if (body.action !== 'reconcile') {
    return json({ error: 'action must be "reconcile" or "release"' }, 400, requestId);
  }

  const dryRun = body.dryRun !== false;
  if (dryRun) {
    // Reuse the same report path so the dry run and the live view cannot drift.
    const candidates = await listPendingOrdersForOps({
      statuses: ACTIONABLE_STATUSES,
      limit: 500,
    });
    const match = candidates.find((candidate) => candidate.orderId === orderId);
    if (!match) {
      return json(
        { error: 'Order is not in an actionable state', currentStatus: row.status },
        409,
        requestId,
      );
    }
    const report = await buildReconciliationReport({ rows: [match], probe: true });
    return json({ action: 'reconcile', dryRun: true, order: report.rows[0] }, 200, requestId);
  }

  try {
    const outcome = await reconcileOrder(orderId, { requestId, source: 'ops' });
    const refreshed = await findPendingOrderLifecycle(orderId);
    logger.warn('billing_ops.reconcile_applied', {
      route: '/api/internal/billing/orders',
      requestId,
      orderId,
      state: outcome?.state ?? 'missing',
      status: refreshed?.status ?? null,
    });
    return json(
      {
        action: 'reconcile',
        dryRun: false,
        orderId,
        state: outcome?.state ?? 'missing',
        note: outcome?.note ?? null,
        currentStatus: refreshed?.status ?? null,
      },
      200,
      requestId,
    );
  } catch (error) {
    logger.error('billing_ops.reconcile_failed', {
      route: '/api/internal/billing/orders',
      requestId,
      orderId,
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    return json({ error: 'Reconcile failed' }, 500, requestId);
  }
}
