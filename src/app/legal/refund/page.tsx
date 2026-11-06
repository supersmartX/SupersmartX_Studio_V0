import type { Metadata } from 'next';

import { SEO_CONFIG } from '@/lib/seo/config';

export const metadata: Metadata = {
  title: 'Refunds & Cancellations | SupersmartX Studio',
  description:
    'Refund and cancellation policy for SupersmartX Studio paid plans, including how to request a refund and how long it takes.',
  alternates: { canonical: `${SEO_CONFIG.siteUrl}/legal/refund` },
  openGraph: {
    title: 'Refunds & Cancellations | SupersmartX Studio',
    description: 'Refund and cancellation policy for SupersmartX Studio.',
    url: `${SEO_CONFIG.siteUrl}/legal/refund`,
    type: 'article',
  },
};

export default function RefundPage() {
  return (
    <div className="bg-canvas text-text-primary min-h-screen">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-16">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Refunds &amp; Cancellations</h1>
          <p className="text-text-secondary text-sm">
            Last updated: November 2026
          </p>
        </div>

        <div className="text-text-secondary space-y-6 text-sm leading-relaxed">
          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              1. Overview
            </h2>
            <p>
              SupersmartX Studio offers a free plan and paid Creator plans for
              browser-based teleprompting and video recording. This page
              explains when a paid plan can be cancelled and when a payment can
              be refunded.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              2. Billing
            </h2>
            <p>
              Paid plans are purchased as a single one-time payment for a fixed
              term - monthly or yearly. Prices are shown in Indian Rupees (INR)
              at checkout for customers in India, and in the local currency for
              other regions. Payments are processed by Cashfree Payments.
            </p>
            <p>
              Paid plans do not renew automatically. There is no recurring
              charge, so no cancellation is needed to stop future billing -
              simply do not purchase another term.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              3. Cancellation
            </h2>
            <p>
              You may stop using the Service at any time. If you want your paid
              plan closed before the end of its term, email us at the address in
              section 7 and we will close it on your account.
            </p>
            <p>
              Closing a plan does not automatically refund the remaining period.
              Access continues until the paid term expires unless a refund is
              approved under section 4.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              4. Refund eligibility
            </h2>
            <p>We will refund a payment when:</p>
            <ul className="ml-4 list-inside list-disc space-y-1">
              <li>
                You request a refund within 7 days of your first purchase of a
                plan and you have not used paid features such as Creator
                exports.
              </li>
              <li>
                You were charged more than once for the same order, or were
                charged after a failed or cancelled checkout.
              </li>
              <li>
                You were charged without authorising the payment, or the paid
                feature was not delivered and we could not restore it.
              </li>
            </ul>
            <p>
              Refunds are not available for a renewal or extension purchased
              after the 7-day window, or where an account was used in breach of
              our Terms of Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              5. How to request a refund
            </h2>
            <p>
              Email{' '}
              <a
                href="mailto:support@supersmartx.com"
                className="text-accent hover:text-accent-hover transition-colors"
              >
                support@supersmartx.com
              </a>{' '}
              from the address on your account and include:
            </p>
            <ul className="ml-4 list-inside list-disc space-y-1">
              <li>The order ID or the payment reference</li>
              <li>The date of payment and the amount charged</li>
              <li>A short description of the reason for the request</li>
            </ul>
            <p>
              We acknowledge refund requests within 2 business days and tell you
              whether the request is approved.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              6. How refunds are processed
            </h2>
            <p>
              Approved refunds are returned through Cashfree Payments to the
              original payment method, for the amount actually paid. Refunds are
              normally reflected within 5-7 business days, but the exact timing
              depends on your bank or card issuer.
            </p>
            <p>
              Charges that were reversed through a bank or card dispute
              (chargeback) are handled by the issuer, not by a duplicate refund
              from us.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              7. Contact
            </h2>
            <p>
              For questions about this policy or a specific payment, contact us
              at{' '}
              <a
                href="mailto:support@supersmartx.com"
                className="text-accent hover:text-accent-hover transition-colors"
              >
                support@supersmartx.com
              </a>
              . See also our{' '}
              <a
                href="/legal/terms"
                className="text-accent hover:text-accent-hover transition-colors"
              >
                Terms of Service
              </a>{' '}
              and{' '}
              <a
                href="/contact"
                className="text-accent hover:text-accent-hover transition-colors"
              >
                Contact page
              </a>
              .
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-text-primary text-lg font-semibold">
              8. Your statutory rights
            </h2>
            <p>
              Nothing in this policy limits any right you have under applicable
              consumer protection law.
            </p>
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
