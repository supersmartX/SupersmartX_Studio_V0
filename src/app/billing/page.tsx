import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getPrisma } from '@/lib/db/prisma';
import { currencyFractionDigits } from '@/lib/billing/paddle';

export const dynamic = 'force-dynamic';

// billing_transactions.amount stores Paddle minor units. Convert to major
// units on the currency's scale so zero-decimal and three-decimal currencies
// format correctly, matching the email receipt formatter.
function formatAmount(amount: number, currency: string) {
  const fractionDigits = currencyFractionDigits(currency) ?? 2;
  const major = amount / 10 ** fractionDigits;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(major);
  } catch {
    return `${major.toFixed(fractionDigits)} ${currency}`;
  }
}

function formatDate(value: Date | null) {
  return value
    ? value.toLocaleDateString(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
    : '—';
}

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const prisma = getPrisma();
  const [account, transactions] = await Promise.all([
    prisma.billingAccount.findUnique({
      where: { userId: session.user.id },
      select: { plan: true, status: true, paidThroughAt: true, nextChargeAt: true },
    }),
    prisma.billingTransaction.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { providerTransactionId: true, status: true, amount: true, currency: true, paidAt: true, createdAt: true },
    }),
  ]);

  return (
    <main className="min-h-screen bg-canvas px-4 py-10 text-text-primary sm:px-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-text-secondary">Account</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Billing history</h1>
            <p className="mt-2 text-sm text-text-secondary">Review your payments and current Creator access.</p>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href="/studio" className="rounded-md border border-border-default px-3 py-2 text-text-secondary hover:bg-elevated">Back to Studio</Link>
            <Link href="/contact" className="rounded-md bg-accent px-3 py-2 font-medium text-white hover:bg-accent-hover">Billing help</Link>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-border-default bg-surface p-5"><p className="text-xs uppercase tracking-wide text-text-muted">Plan</p><p className="mt-2 text-lg font-semibold">{account?.plan === 'free' || !account ? 'Free' : 'Creator'}</p></div>
          <div className="rounded-xl border border-border-default bg-surface p-5"><p className="text-xs uppercase tracking-wide text-text-muted">Status</p><p className="mt-2 text-lg font-semibold capitalize">{account?.status ?? 'free'}</p></div>
          <div className="rounded-xl border border-border-default bg-surface p-5"><p className="text-xs uppercase tracking-wide text-text-muted">Access until</p><p className="mt-2 text-lg font-semibold">{formatDate(account?.paidThroughAt ?? null)}</p></div>
        </section>

        <section className="overflow-hidden rounded-xl border border-border-default bg-surface">
          <div className="border-b border-border-subtle px-5 py-4"><h2 className="font-semibold">Payments</h2><p className="mt-1 text-sm text-text-secondary">Paddle sends the official invoice for each completed payment.</p></div>
          {transactions.length === 0 ? (
            <div className="px-5 py-12 text-center"><p className="font-medium">No payments yet</p><p className="mt-2 text-sm text-text-secondary">Completed payments will appear here after they are verified.</p></div>
          ) : (
            <div className="divide-y divide-border-subtle">
              {transactions.map((transaction) => (
                <div key={transaction.providerTransactionId} className="grid gap-2 px-5 py-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                  <div><p className="font-medium">{transaction.providerTransactionId}</p><p className="text-xs text-text-muted">{formatDate(transaction.paidAt ?? transaction.createdAt)}</p></div>
                  <span className="text-sm capitalize text-text-secondary">{transaction.status}</span>
                  <span className="font-medium">{formatAmount(Number(transaction.amount), transaction.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <p className="text-sm text-text-secondary">Need an invoice or help with a payment? <Link href="/contact" className="text-accent hover:text-accent-hover">Contact support</Link> with the transaction ID shown above. Never send card details or a UPI PIN.</p>
      </div>
    </main>
  );
}
