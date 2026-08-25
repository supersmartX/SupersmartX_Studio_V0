import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'SupersmartX Studio',
  description:
    'Interactive Teleprompter and Video Script Reader — Record professional videos from your browser.',
  icons: {
    icon: '/SXS_ICON.png',
  },
  metadataBase: new URL('https://studio.supersmartx.com'),
  openGraph: {
    title: 'SupersmartX Studio',
    description: 'Interactive Teleprompter and Video Script Reader — Record professional videos from your browser.',
    url: 'https://studio.supersmartx.com',
    siteName: 'SupersmartX Studio',
    images: [
      {
        url: '/SXS_ICON.png',
        width: 512,
        height: 512,
        alt: 'SupersmartX Studio',
      },
    ],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SupersmartX Studio',
    description: 'Interactive Teleprompter and Video Script Reader — Record professional videos from your browser.',
    images: ['/SXS_ICON.png'],
  },
  other: {
    'theme-color': '#09090B',
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
