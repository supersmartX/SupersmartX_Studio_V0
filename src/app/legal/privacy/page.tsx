import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy | SupersmartX Studio',
  description: 'Privacy Policy for SupersmartX Studio.',
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-text-muted">Last updated: August 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-text-secondary">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">1. Information We Collect</h2>
            <p>We collect information you provide directly:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Account information:</strong> Email address, first name, last name (when you create an account)</li>
              <li><strong>Payment information:</strong> Processed by Cashfree — we do not store card details</li>
              <li><strong>Scripts:</strong> Teleprompter text you enter (stored locally in your browser)</li>
              <li><strong>Recordings:</strong> Video and audio recorded via your camera and microphone (processed locally, not uploaded unless you share)</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">2. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>To provide and maintain the Service</li>
              <li>To process payments and manage subscriptions</li>
              <li>To send transactional emails (password reset, payment confirmations)</li>
              <li>To improve the Service</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">3. Camera and Microphone</h2>
            <p>
              Camera and microphone access is requested solely for the purpose of recording your video presentations.
              Media streams are processed entirely in your browser. We do not capture, store, or transmit
              your camera or microphone data to our servers.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">4. Local Storage</h2>
            <p>
              Scripts, settings, and recordings are stored in your browser&apos;s local storage and IndexedDB.
              This data never leaves your device unless you explicitly download or share it.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">5. Third-Party Services</h2>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Cashfree:</strong> Payment processing</li>
              <li><strong>Vercel:</strong> Hosting and deployment</li>
              <li><strong>Resend:</strong> Transactional email delivery</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">6. Data Security</h2>
            <p>
              We implement appropriate security measures to protect your personal information.
              However, no method of transmission over the Internet is 100% secure.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">7. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>Access your personal data</li>
              <li>Correct inaccurate data</li>
              <li>Delete your account and associated data</li>
              <li>Export your data</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">8. Children&apos;s Privacy</h2>
            <p>
              The Service is not intended for children under 13. We do not knowingly collect
              personal information from children under 13.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify you of any
              changes by posting the new policy on this page.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">10. Contact</h2>
            <p>
              For questions about this Privacy Policy, contact us at{' '}
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
