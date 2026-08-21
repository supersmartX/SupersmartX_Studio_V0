import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Terms of Service | SupersmartX Studio',
  description: 'Terms of Service for SupersmartX Studio.',
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Terms of Service</h1>
          <p className="text-sm text-text-muted">Last updated: August 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-text-secondary">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">1. Acceptance of Terms</h2>
            <p>
              By accessing or using SupersmartX Studio (&quot;the Service&quot;), you agree to be bound by these Terms of Service.
              If you do not agree to these terms, do not use the Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">2. Description of Service</h2>
            <p>
              SupersmartX Studio is a browser-based teleprompter and video recording tool. The Service allows users
              to create, read, and record scripts using their device camera and microphone.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">3. User Accounts</h2>
            <p>
              You may use the Service without an account. An account is required to download recorded videos.
              You are responsible for maintaining the confidentiality of your account credentials.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">4. User Content</h2>
            <p>
              You retain ownership of all scripts and recordings you create using the Service.
              We do not claim ownership over your content. Recordings are processed locally in your browser
              and are not uploaded to our servers unless you explicitly choose to share them.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">5. Acceptable Use</h2>
            <p>You agree not to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Use the Service for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to the Service</li>
              <li>Interfere with or disrupt the Service</li>
              <li>Use the Service to record others without their consent</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">6. Payments</h2>
            <p>
              Paid features are processed through Cashfree. We do not store your payment information.
              Prices may vary by region based on purchasing power parity.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">7. Limitation of Liability</h2>
            <p>
              The Service is provided &quot;as is&quot; without warranties of any kind. We are not liable for any
              damages arising from your use of the Service.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">8. Changes to Terms</h2>
            <p>
              We reserve the right to modify these terms at any time. Continued use of the Service after
              changes constitutes acceptance of the new terms.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">9. Contact</h2>
            <p>
              For questions about these Terms, contact us at{' '}
              <a href="mailto:support@supersmartx.com" className="text-accent hover:text-accent-hover transition-colors">
                support@supersmartx.com
              </a>.
            </p>
          </section>
        </div>

        <div className="pt-8 border-t border-border-subtle">
          <a href="/" className="text-sm text-accent hover:text-accent-hover transition-colors">
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}
