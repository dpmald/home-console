import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BetaShell } from '@/components/BetaShell';
import { getBetaDeployment } from '@/lib/beta-deployment';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Home Console · Beta', robots: { index: false, follow: false } };

export default function BetaLayout({ children }: { children: React.ReactNode }) {
  const beta = getBetaDeployment();
  if (!beta.enabled || !beta.kitchenUrl) notFound();
  return <BetaShell kitchenUrl={beta.kitchenUrl} testData={beta.testData}>{children}</BetaShell>;
}
