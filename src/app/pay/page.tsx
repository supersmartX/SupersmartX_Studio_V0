import Link from 'next/link';
import { PaddleCheckout } from '@/components/billing/PaddleCheckout';
import { getPaddleEnvironment } from '@/lib/billing/paddle';
import { getPrisma } from '@/lib/db/prisma';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Secure payment | SupersmartX Studio', robots: { index: false, follow: false } };

export default async function PaymentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const transactionId = params._ptxn;
  const token = process.env.PADDLE_CLIENT_TOKEN?.trim() ?? '';
  const available = getPaddleEnvironment() !== null && /^(test|live)_[a-zA-Z0-9]+$/.test(token) &&
    typeof transactionId === 'string' && /^txn_[a-z0-9]{26}$/.test(transactionId);

  // Paddle Retain needs the Paddle customer ID (not the internal user ID or
  // email), so the signed-in customer's provider customer ID is passed through.
  let paddleCustomerId: string | null = null;
  if (available) {
    try {
      const session = await auth();
      if (session?.user?.id) {
        const account = await getPrisma().billingAccount.findUnique({
          where: { userId: session.user.id },
          select: { providerCustomerId: true },
        });
        paddleCustomerId = account?.providerCustomerId ?? null;
      }
    } catch {
      paddleCustomerId = null;
    }
  }

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-text-primary sm:px-6 sm:py-12">
      <div className="mx-auto max-w-lg">
        {available ? <PaddleCheckout token={token} transactionId={transactionId as string} paddleCustomerId={paddleCustomerId} /> : (
          <section className="overflow-hidden rounded-2xl border border-border-default bg-surface shadow-2xl">
            <div className="border-b border-border-subtle bg-elevated/40 px-6 py-5 sm:px-8">
              <p className="text-sm font-semibold tracking-tight text-text-primary">SupersmartX <span className="font-normal text-accent-text">Studio</span></p>
              <p className="mt-1 text-xs uppercase tracking-[0.16em] text-text-muted">Secure checkout</p>
            </div>
            <div className="space-y-5 px-6 py-10 text-center sm:px-8">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-warning/10 text-warning" aria-hidden="true">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.3 3.7 2.8 17a2 2 0 0 0 1.75 3h14.9a2 2 0 0 0 1.75-3L13.7 3.7a2 2 0 0 0-3.4 0Z" /></svg>
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">This checkout link is no longer available</h1>
                <p role="alert" className="mx-auto mt-3 max-w-sm text-sm leading-6 text-text-secondary">Your account and any previous payment attempt are unchanged. Return to Studio to check your status or safely start again.</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <Link href="/studio" className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-white transition hover:bg-accent-hover">Return to Studio</Link>
                <Link href="/studio?checkout=creator_monthly" className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border-default px-5 text-sm font-medium text-text-secondary transition hover:bg-elevated hover:text-text-primary">View plans</Link>
              </div>
              <p className="text-xs text-text-muted">Never submit another payment while a previous checkout is still being checked.</p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
