import { BetaGroceries } from '@/components/BetaGroceries';
import { parseConsoleUrl } from '@/lib/beta-navigation.mjs';
import { getBetaDeployment } from '@/lib/beta-deployment';

export default function BetaGroceriesPage() {
  const { testData } = getBetaDeployment();
  const hosted = testData ? parseConsoleUrl(process.env.HOME_CONSOLE_HOSTED_BETA_URL ?? '') : null;
  return <BetaGroceries testData={testData} hostedUrl={hosted ? new URL('/beta/groceries', hosted).href : null} />;
}
