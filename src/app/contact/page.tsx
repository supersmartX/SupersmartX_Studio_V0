import type { Metadata } from 'next';

import { SEO_CONFIG } from '@/lib/seo/config';

export const metadata: Metadata = {
  title: 'Contact Us | SupersmartX Studio',
  description:
    'Contact SupersmartX Studio support for help with recordings, accounts, billing, payments and refunds.',
  alternates: { canonical: `${SEO_CONFIG.siteUrl}/contact` },
  openGraph: {
    title: 'Contact Us | SupersmartX Studio',
    description: 'Support contact details for SupersmartX Studio.',
    url: `${SEO_CONFIG.siteUrl}/contact`,
    type: 'website',
  },
};

export default function ContactPage() {
  return (
    <div className="bg-canvas text-text-primary min-h-screen">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Contact Us</h1>
          <p className="text-text-secondary text-sm">
            We answer support requests within 2 business days.
          </p>
        </div>

        <div className="text-text-secondary space-y-6 text-sm leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              Customer support
            </h2>
            <p>
              For help with recordings, exports, your account or a payment,
              email{' '}
              <a
                href="mailto:support@supersmartx.com"
                className="text-accent hover:text-accent-hover transition-colors"
              >
                support@supersmartx.com
              </a>
              .
            </p>
            <p>
              To help us resolve a billing question quickly, include the email
              on your account, the order ID, the date of payment and the amount
              charged. Please never send your card number, CVV, UPI PIN or
              password.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              Payments and refunds
            </h2>
            <p>
              Payments are processed by Cashfree Payments. Approved refunds are
              returned to the original payment method. Our full policy is on the{' '}
              <a
                href="/legal/refund"
                className="text-accent hover:text-accent-hover transition-colors"
              >
                Refunds &amp; Cancellations
              </a>{' '}
              page.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              Business details
            </h2>
            <dl className="ml-4 space-y-1">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-text-primary font-medium">Brand:</dt>
                <dd>SupersmartX</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-text-primary font-medium">Product:</dt>
                <dd>
                  SupersmartX Studio - browser-based teleprompter and video
                  recording
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-text-primary font-medium">Operating in:</dt>
                <dd>India</dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-text-primary font-medium">Support:</dt>
                <dd>support@supersmartx.com</dd>
              </div>
            </dl>
            <p>
              Registered business name and address are provided on the merchant
              record held by our payment partner and are available on request
              from the support address above.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              Policies
            </h2>
            <ul className="ml-4 list-inside list-disc space-y-1">
              <li>
                <a
                  href="/legal/terms"
                  className="text-accent hover:text-accent-hover transition-colors"
                >
                  Terms of Service
                </a>
              </li>
              <li>
                <a
                  href="/legal/privacy"
                  className="text-accent hover:text-accent-hover transition-colors"
                >
                  Privacy Policy
                </a>
              </li>
              <li>
                <a
                  href="/legal/refund"
                  className="text-accent hover:text-accent-hover transition-colors"
                >
                  Refunds &amp; Cancellations
                </a>
              </li>
            </ul>
          </section>
        </div>

        <div className="border-border-subtle border-t pt-8">
          <a
            href="/"
            className="text-accent hover:text-accent-hover text-sm transition-colors"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
