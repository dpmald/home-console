import { BetaGroceries } from '@/components/BetaGroceries';
import { parseConsoleUrl } from '@/lib/beta-navigation.mjs';
import { getBetaDeployment } from '@/lib/beta-deployment';
import { cookies, headers } from 'next/headers';
import { safeEqual } from '@/lib/auth';
import { kioskCookieName } from '@/lib/kiosk-cookie';

export default async function BetaGroceriesPage() {
  const { testData } = getBetaDeployment();
  const hosted = testData ? parseConsoleUrl(process.env.HOME_CONSOLE_HOSTED_BETA_URL ?? '') : null;
  const token = process.env.KIOSK_ACCESS_TOKEN;
  const cookie = (await cookies()).get(kioskCookieName())?.value;
  const authorization = (await headers()).get('authorization');
  const canWrite = Boolean(token && ((cookie && safeEqual(cookie, token)) ||
    (authorization && safeEqual(authorization, `Bearer ${token}`))));
  return <BetaGroceries testData={testData} canWrite={canWrite} unlockAvailable={Boolean(token)}
    hostedUrl={hosted ? new URL('/beta/groceries', hosted).href : null} />;
}
