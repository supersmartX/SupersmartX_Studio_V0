import Link from 'next/link';
import { auth } from '@/auth';
import { getPrisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export default async function SupportSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ transaction_id?: string }>;
}) {
  const params = await searchParams;
  const session = await auth();
  let paid = false;
  let transactionId: string | null = null;

  if (session?.user?.id && params.transaction_id) {
    const transaction = await getPrisma().billingTransaction.findFirst({
      where: {
        providerTransactionId: params.transaction_id,
        userId: session.user.id,
        status: { in: ['paid', 'completed', 'billed'] },
      },
    });
    paid = Boolean(transaction);
    transactionId = transaction?.providerTransactionId ?? null;
  }

  return (
    <div className="bg-canvas flex min-h-screen items-center justify-center p-4">
      <div className="bg-surface border-border-default w-full max-w-md overflow-hidden rounded-xl border shadow-lg">
        <div className="border-border-subtle border-b p-8 text-center">
          <h1 className="text-text-primary mb-2 text-xl font-bold">
            {paid ? 'Payment confirmed' : 'Confirming your payment'}
          </h1>
          <p className="text-text-secondary text-sm">
            {paid
              ? 'Your Paddle payment has been confirmed. Your plan status is updated from server evidence.'
              : 'A browser redirect does not activate access. Paddle confirmation and server entitlement processing are required.'}
          </p>
        </div>
        <div className="p-6">
          {transactionId && (
            <div className="bg-elevated mb-4 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-text-secondary text-sm">Transaction ID</span>
                <span className="text-text-secondary font-mono text-xs">{transactionId}</span>
              </div>
            </div>
          )}
          <Link
            href="/studio"
            className="bg-accent block w-full rounded-lg py-3 text-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Open SupersmartX Studio
          </Link>
        </div>
      </div>
    </div>
  );
}
