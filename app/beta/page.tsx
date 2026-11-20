import { KioskBoard } from '@/components/KioskBoard';
import { getKitchenState } from '@/lib/domain';
import { getBetaDeployment } from '@/lib/beta-deployment';

export default async function BetaPage() {
  const { kitchenUrl } = getBetaDeployment();
  if (!kitchenUrl) throw new Error('Missing kitchen return URL.');
  return <KioskBoard initial={await getKitchenState()} initialWeather={null} betaKitchenUrl={kitchenUrl} />;
}
