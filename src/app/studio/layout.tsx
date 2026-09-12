import type { Metadata } from 'next';
import { SEO_CONFIG } from '@/lib/seo/config';

export const metadata: Metadata = {
  title: 'Studio — SupersmartX Studio',
  description: 'Record with teleprompter, export 1080p, private by design.',
  alternates: { canonical: `${SEO_CONFIG.siteUrl}/studio` },
  robots: { index: false, follow: false, noarchive: true, nosnippet: true },
};

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
