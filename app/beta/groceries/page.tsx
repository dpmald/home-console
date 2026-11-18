import { BetaGroceries } from '@/components/BetaGroceries';
import { getBetaDeployment } from '@/lib/beta-deployment';

export default function BetaGroceriesPage() {
  return <BetaGroceries testData={getBetaDeployment().testData} />;
}
