import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
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
  title: 'SupersmartX Studio',
  description:
    'Interactive Teleprompter and Video Script Reader — Record professional videos from your browser.',
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
  metadataBase: new URL('https://www.supersmartx.com'),
  openGraph: {
    title: 'SupersmartX Studio',
    description: 'Interactive Teleprompter and Video Script Reader — Record professional videos from your browser.',
    url: 'https://www.supersmartx.com',
    siteName: 'SupersmartX Studio',
    images: [
      {
        url: '/brand/studio/exports/social/og-image-1200x630.png',
        width: 1200,
        height: 630,
        alt: 'SupersmartX Studio',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SupersmartX Studio',
    description: 'Interactive Teleprompter and Video Script Reader — Record professional videos from your browser.',
    images: ['/brand/studio/exports/social/og-image-1200x630.png'],
  },
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
