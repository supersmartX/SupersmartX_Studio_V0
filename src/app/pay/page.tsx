import Link from 'next/link';
import { PaddleCheckout } from '@/components/billing/PaddleCheckout';
import { getPaddleEnvironment } from '@/lib/billing/paddle';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Secure payment | SupersmartX Studio', robots: { index: false, follow: false } };

export default async function PaymentPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const transactionId = params._ptxn;
  const token = process.env.PADDLE_CLIENT_TOKEN?.trim() ?? '';
  const available = getPaddleEnvironment() === 'sandbox' && /^test_[a-zA-Z0-9]+$/.test(token) &&
    typeof transactionId === 'string' && /^txn_[a-z0-9]{26}$/.test(transactionId);

  return (
    <main className="min-h-screen bg-canvas px-6 py-12 text-text-primary">
      <div className="mx-auto max-w-lg">
        {available ? <PaddleCheckout token={token} transactionId={transactionId as string} /> : (
          <section className="space-y-4">
            <h1 className="text-2xl font-semibold">Checkout is unavailable</h1>
            <p role="alert" className="text-text-secondary">Return to Studio to check your payment status or start checkout.</p>
            <Link href="/studio" className="text-accent-text underline">Return to Studio</Link>
          </section>
        )}
      </div>
    </main>
  );
}
