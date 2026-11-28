import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { SettingsClient } from '@/components/settings/SettingsClient';

export const metadata: Metadata = {
  title: 'Account settings — SupersmartX Studio',
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  return <SettingsClient />;
}
