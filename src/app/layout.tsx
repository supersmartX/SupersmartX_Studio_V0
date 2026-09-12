import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { SEO_CONFIG } from '@/lib/seo/config';
import { JsonLd, organizationSchema, websiteSchema, softwareApplicationSchema } from '@/components/seo/JsonLd';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#09090B',
};

export const metadata: Metadata = {
  title: {
    default: SEO_CONFIG.defaultTitle,
    template: `%s | ${SEO_CONFIG.siteName}`,
  },
  description: SEO_CONFIG.defaultDescription,
  metadataBase: new URL(SEO_CONFIG.siteUrl),
  alternates: {
    canonical: SEO_CONFIG.siteUrl,
  },
  icons: {
    icon: [
      { url: '/brand/studio/icon/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/studio/icon/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/brand/studio/icon/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/brand/studio/icon/app-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/brand/studio/icon/apple-touch-icon.png',
    other: [
      { rel: 'icon', url: '/brand/studio/icon/favicon.svg', type: 'image/svg+xml' },
    ],
  },
  openGraph: {
    title: SEO_CONFIG.defaultTitle,
    description: SEO_CONFIG.defaultDescription,
    url: SEO_CONFIG.siteUrl,
    siteName: SEO_CONFIG.siteName,
    images: [
      {
        url: SEO_CONFIG.defaultImage,
        width: 1200,
        height: 630,
        alt: SEO_CONFIG.siteName,
      },
    ],
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title: SEO_CONFIG.defaultTitle,
    description: SEO_CONFIG.defaultDescription,
    images: [SEO_CONFIG.defaultImage],
  },
  robots: SEO_CONFIG.defaultRobots,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.querySelectorAll('[fdprocessedid]').forEach(function(e){e.removeAttribute('fdprocessedid')})}catch(e){}`,
          }}
        />
        <JsonLd
          data={[organizationSchema(), websiteSchema(), softwareApplicationSchema()]}
        />
      </head>
      <body
        className={`${inter.variable} text-sm antialiased`}
        style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif', background: 'var(--color-canvas)', color: '#fff' }}
        suppressHydrationWarning
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
