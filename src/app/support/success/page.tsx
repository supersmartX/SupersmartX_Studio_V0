import Link from 'next/link';
import { auth } from '@/auth';
import { findPendingOrder, findUserById } from '@/lib/db';
import { fetchCashfreeOrder, isCashfreeOrderPaid, isCashfreeConfigured } from '@/lib/cashfree-fulfillment';

export const dynamic = 'force-dynamic';

function planLabel(plan: string | null | undefined): string {
  if (plan === 'creator_yearly' || plan === 'pro_yearly') return 'Creator Yearly';
  if (plan === 'creator_monthly' || plan === 'pro_monthly') return 'Creator Monthly';
  return 'Creator';
}

type Verification =
  | { state: 'paid'; orderId: string; plan: string | null }
  | { state: 'unverified'; reason: 'no_order' | 'not_found' | 'not_paid' | 'unavailable' | 'forbidden' };

/**
 * The query string is fully attacker-controllable, so "Payment Successful" is
 * only ever rendered when Cashfree's authoritative order state (looked up
 * server-side for the signed-in account) says PAID. Everything else renders a
 * neutral "we're confirming" state.
 */
async function verifyOrder(orderIdParam: string | undefined): Promise<Verification> {
  if (!orderIdParam || orderIdParam.length > 200) return { state: 'unverified', reason: 'no_order' };
  if (!isCashfreeConfigured()) return { state: 'unverified', reason: 'unavailable' };

  const session = await auth();
  if (!session?.user?.id) return { state: 'unverified', reason: 'forbidden' };

  const pendingOrder = await findPendingOrder(orderIdParam);
  if (!pendingOrder) return { state: 'unverified', reason: 'not_found' };

  const owner = await findUserById(pendingOrder.userId);
  const sameAccount =
    pendingOrder.userId === session.user.id ||
    (owner?.email?.toLowerCase() === session.user.email?.toLowerCase());
  if (!sameAccount) return { state: 'unverified', reason: 'forbidden' };

  try {
    const order = await fetchCashfreeOrder(orderIdParam);
    if (!isCashfreeOrderPaid(order)) return { state: 'unverified', reason: 'not_paid' };
  } catch {
    return { state: 'unverified', reason: 'unavailable' };
  }

  return { state: 'paid', orderId: pendingOrder.orderId, plan: pendingOrder.plan };
}

const REASONS = {
  no_order: 'We could not find a payment reference on this page. Open SupersmartX Studio and check your plan status — if you were charged, support will confirm it shortly.',
  not_found: 'We could not find this order in our records. If you were charged, your bank statement will show the reference and support can trace it.',
  not_paid: 'Your payment has not been confirmed as settled yet. This page updates automatically once the payment provider confirms it — usually within a minute.',
  unavailable: 'We cannot reach the payment provider right now, so we cannot confirm this payment yet. Please check your plan status in Studio shortly.',
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
  const reason = paid ? null : (verification as { reason: keyof typeof REASONS }).reason;
  const orderId = paid ? verification.orderId : params.order_id;
  const planName = planLabel(paid ? (verification as { plan: string | null }).plan : params.plan);

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-border-default rounded-xl shadow-lg overflow-hidden">
        <div className="p-8 text-center border-b border-border-subtle">
          <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${paid ? 'bg-success/10' : 'bg-elevated'}`}>
            {paid ? (
              <svg className="w-8 h-8 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-8 h-8 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          <h1 className="text-xl font-bold text-text-primary mb-2">
            {paid ? 'Payment Successful' : 'Confirming your payment'}
          </h1>
          {paid ? (
            <p className="text-sm text-text-secondary">
              Thank you for subscribing to <span className="font-semibold text-accent">{planName}</span>!
            </p>
          ) : (
            <p className="text-sm text-text-secondary">{REASONS[reason!]}</p>
          )}
        </div>

        <div className="p-6">
          <div className="bg-elevated rounded-xl p-4 mb-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary mb-3">Receipt</h3>
            <div className="space-y-2">
              {orderId && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-text-secondary">Order ID</span>
                  <span className="text-xs font-mono text-text-secondary">{orderId}</span>
                </div>
              )}
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Plan</span>
                <span className="text-sm font-semibold text-text-primary">{planName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-text-secondary">Status</span>
                <span className={`text-sm font-semibold ${paid ? 'text-success' : 'text-text-secondary'}`}>
                  {paid ? 'Paid' : 'Awaiting confirmation'}
                </span>
              </div>
            </div>
          </div>

          {paid && (
            <div className="flex items-start gap-3 p-3 bg-accent/5 border border-accent/20 rounded-lg mb-6">
              <svg className="w-4 h-4 text-accent shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a1.07 1.07 0 01-.607.916l-7.5 4.615a2.36 2.36 0 01-2.36 0L3.32 8.91a1.07 1.07 0 01-.607-.916V6.75" />
              </svg>
              <div>
                <p className="text-xs font-semibold text-accent">Your plan is active</p>
                <p className="text-[12px] text-text-secondary mt-0.5">
                  A receipt is emailed to the address used at checkout. Your plan is already live in
                  Studio either way.
                </p>
              </div>
            </div>
          )}

          <Link
            href="/studio"
            className="block w-full py-3 bg-accent text-white rounded-lg font-semibold text-sm text-center hover:opacity-90 transition-opacity"
          >
            Open SupersmartX Studio
          </Link>

          <Link
            href="/"
            className="block w-full py-3 mt-2 text-text-secondary text-center text-sm hover:text-text-primary transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
