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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} text-sm antialiased`}
        style={{ fontFamily: 'var(--font-inter), system-ui, sans-serif', background: '#000', color: '#fff' }}
        suppressHydrationWarning
      >
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
