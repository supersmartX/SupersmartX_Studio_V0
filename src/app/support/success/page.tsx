import Link from 'next/link';
import { auth } from '@/auth';
import { findPendingOrder, findUserById } from '@/lib/db';
import {
  fetchCashfreeOrder,
  isCashfreeOrderPaid,
  isCashfreeConfigured,
} from '@/lib/cashfree-fulfillment';

export const dynamic = 'force-dynamic';

function planLabel(plan: string | null | undefined): string {
  if (plan === 'creator_yearly' || plan === 'pro_yearly')
    return 'Creator (1 year)';
  if (plan === 'creator_monthly' || plan === 'pro_monthly')
    return 'Creator (1 month)';
  return 'Creator';
}

type Verification =
  | { state: 'paid'; orderId: string; plan: string | null }
  | {
      state: 'unverified';
      reason:
        'no_order' | 'not_found' | 'not_paid' | 'unavailable' | 'forbidden';
    };

/**
 * The query string is fully attacker-controllable, so "Payment Successful" is
 * only ever rendered when Cashfree's authoritative order state (looked up
 * server-side for the signed-in account) says PAID. Everything else renders a
 * neutral "we're confirming" state.
 */
async function verifyOrder(
  orderIdParam: string | undefined,
): Promise<Verification> {
  if (!orderIdParam || orderIdParam.length > 200)
    return { state: 'unverified', reason: 'no_order' };
  if (!isCashfreeConfigured())
    return { state: 'unverified', reason: 'unavailable' };

  const session = await auth();
  if (!session?.user?.id) return { state: 'unverified', reason: 'forbidden' };

  const pendingOrder = await findPendingOrder(orderIdParam);
  if (!pendingOrder) return { state: 'unverified', reason: 'not_found' };

  const owner = await findUserById(pendingOrder.userId);
  const sameAccount =
    pendingOrder.userId === session.user.id ||
    owner?.email?.toLowerCase() === session.user.email?.toLowerCase();
  if (!sameAccount) return { state: 'unverified', reason: 'forbidden' };

  try {
    const order = await fetchCashfreeOrder(orderIdParam);
    if (!isCashfreeOrderPaid(order))
      return { state: 'unverified', reason: 'not_paid' };
  } catch {
    return { state: 'unverified', reason: 'unavailable' };
  }

  return {
    state: 'paid',
    orderId: pendingOrder.orderId,
    plan: pendingOrder.plan,
  };
}

const REASONS = {
  no_order:
    'We could not find a payment reference on this page. Open SupersmartX Studio and check your plan status - if you were charged, support will confirm it shortly.',
  not_found:
    'We could not find this order in our records. If you were charged, your bank statement will show the reference and support can trace it.',
  not_paid:
    'Your payment has not been confirmed as settled yet. This page updates automatically once the payment provider confirms it - usually within a minute.',
  unavailable:
    'We cannot reach the payment provider right now, so we cannot confirm this payment yet. Please check your plan status in Studio shortly.',
  forbidden: 'This payment reference does not belong to the signed-in account.',
} as const;

export default async function SupportSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order_id?: string; plan?: string }>;
}) {
  const params = await searchParams;
  const verification = await verifyOrder(params.order_id);
  const paid = verification.state === 'paid';
  const reason = paid
    ? null
    : (verification as { reason: keyof typeof REASONS }).reason;
  const orderId = paid ? verification.orderId : params.order_id;
  const planName = planLabel(
    paid ? (verification as { plan: string | null }).plan : params.plan,
  );

  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center p-4">
      <div className="bg-surface border-border-default w-full max-w-md overflow-hidden rounded-xl border shadow-lg">
        <div className="border-border-subtle border-b p-8 text-center">
          <div
            className={`mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full ${paid ? 'bg-success/10' : 'bg-elevated'}`}
          >
            {paid ? (
              <svg
                className="text-success h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            ) : (
              <svg
                className="text-text-secondary h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
          </div>
          <h1 className="text-text-primary mb-2 text-xl font-bold">
            {paid ? 'Payment Successful' : 'Confirming your payment'}
          </h1>
          {paid ? (
            <p className="text-text-secondary text-sm">
              Thank you for purchasing{' '}
              <span className="text-accent font-semibold">{planName}</span>{' '}
              access!
            </p>
          ) : (
            <p className="text-text-secondary text-sm">{REASONS[reason!]}</p>
          )}
        </div>

        <div className="p-6">
          <div className="bg-elevated mb-4 rounded-xl p-4">
            <h3 className="text-text-secondary mb-3 text-xs font-semibold tracking-wider uppercase">
              Receipt
            </h3>
            <div className="space-y-2">
              {orderId && (
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-sm">Order ID</span>
                  <span className="text-text-secondary font-mono text-xs">
                    {orderId}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-sm">Plan</span>
                <span className="text-text-primary text-sm font-semibold">
                  {planName}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-sm">Status</span>
                <span
                  className={`text-sm font-semibold ${paid ? 'text-success' : 'text-text-secondary'}`}
                >
                  {paid ? 'Paid' : 'Awaiting confirmation'}
                </span>
              </div>
            </div>
          </div>

          {paid && (
            <div className="bg-accent/5 border-accent/20 mb-6 flex items-start gap-3 rounded-lg border p-3">
              <svg
                className="text-accent mt-0.5 h-4 w-4 shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth="2"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a1.07 1.07 0 01-.607.916l-7.5 4.615a2.36 2.36 0 01-2.36 0L3.32 8.91a1.07 1.07 0 01-.607-.916V6.75"
                />
              </svg>
              <div>
                <p className="text-accent text-xs font-semibold">
                  Your plan is active
                </p>
                <p className="text-text-secondary mt-0.5 text-[12px]">
                  A receipt is emailed to the address used at checkout. Your
                  plan is already live in Studio either way.
                </p>
              </div>
            </div>
          )}

          <Link
            href="/studio"
            className="bg-accent block w-full rounded-lg py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Open SupersmartX Studio
          </Link>

          <Link
            href="/"
            className="text-text-secondary hover:text-text-primary mt-2 block w-full py-3 text-center text-sm transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
