import type { Metadata } from 'next';

import { SEO_CONFIG } from '@/lib/seo/config';

export const metadata: Metadata = {
  title: 'Privacy Policy | SupersmartX Studio',
  description: 'Privacy Policy for SupersmartX Studio — how scripts, recordings and payments are handled. Local-first, private by design.',
  alternates: { canonical: `${SEO_CONFIG.siteUrl}/legal/privacy` },
  openGraph: {
    title: 'Privacy Policy | SupersmartX Studio',
    description: 'How SupersmartX Studio handles scripts, recordings and payments.',
    url: `${SEO_CONFIG.siteUrl}/legal/privacy`,
    type: 'article',
  },
};

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16 space-y-8">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold">Privacy Policy</h1>
          <p className="text-sm text-text-secondary">Last updated: August 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-text-secondary">
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">1. Information We Collect</h2>
            <p>We collect information you provide directly:</p>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Account information:</strong> Email address, first name, last name (when you create an account)</li>
              <li><strong>Payment information:</strong> Processed by Cashfree — we do not store card details</li>
              <li><strong>Scripts:</strong> Teleprompter text you enter (stored locally in your browser)</li>
              <li><strong>Recordings:</strong> Video and audio captured via your camera and microphone. On the Free plan these stay on your device and are never uploaded to us. On the Creator plan, the exported MP4 file you choose to export is uploaded to our storage provider (Cloudflare R2) and linked to your account — see section 4.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">2. How We Use Your Information</h2>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>To provide and maintain the Service</li>
              <li>To process payments and manage subscriptions</li>
              <li>To send transactional emails (password reset, payment confirmations)</li>
              <li>To store, display and deliver the videos you export on a paid plan</li>
              <li>To improve the Service</li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">3. Camera and Microphone</h2>
            <p>
              Camera and microphone access is requested solely for the purpose of recording your video presentations.
              The live camera and microphone streams are processed entirely in your browser and are never sent to our
              servers by the recording feature. Recording and exporting also happen on your device: the MP4 is
              encoded locally in your browser.
            </p>
            <p>
              What does leave your device is the finished MP4 file, and only when you export it on the Creator plan —
              see the next section. Free exports are never uploaded.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">4. Local Storage and Uploaded Exports</h2>
            <p>
              Scripts, settings, and your original recordings are stored in your browser&apos;s local storage and
              IndexedDB. On the Free plan this data never leaves your device unless you explicitly download or share it,
              and a Free local export is also stored only on your device (in your browser&apos;s local export storage)
              for 7 days before it is no longer listed.
            </p>
            <p>
              On the Creator plan, exporting a video uploads the finished MP4 directly from your browser to Cloudflare
              R2, our object storage provider, and records it against your account so it can appear in your Creator
              library and be downloaded again later. Those files are stored under a key namespaced to your user ID and
              are served only through short-lived signed download links; the bucket is not publicly readable and there
              is no public URL for your video.
            </p>
            <p>
              An uploaded Creator export is retained until you delete it yourself from your library, or until you
              delete your account, at which point the stored file and its database record are removed. We do not
              currently apply an automatic expiry to Creator library files. An unfinished export upload that was never
              completed is removed by a nightly cleanup job after 30 days; files that belong to a completed export are
              never touched by that job.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-text-primary">5. Third-Party Services</h2>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li><strong>Cashfree:</strong> Payment processing</li>
              <li><strong>Vercel:</strong> Hosting and deployment</li>
              <li><strong>Cloudflare R2:</strong> Object storage for the videos you export on the Creator plan</li>
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
              <li>Delete your account and associated data — deleting your account removes your stored exports from Cloudflare R2 and your records from our database, and ends every active session for that account</li>
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
