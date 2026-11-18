import { BetaHub } from '@/components/BetaHub';
import { getBetaDeployment } from '@/lib/beta-deployment';

export default function BetaPage() {
  return <BetaHub testData={getBetaDeployment().testData} />;
}
