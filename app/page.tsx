import { KioskBoard } from '@/components/KioskBoard';
import { demoKitchenState } from '@/lib/demo';
import { getKitchenState } from '@/lib/domain';
import { todayISO } from '@/lib/time';
import { getWeather, type Weather } from '@/lib/weather';
import type { KitchenState } from '@/lib/types';
import { getBetaDestination } from '@/lib/beta-navigation.mjs';
import { isBetaDeployment } from '@/lib/beta-deployment';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // Do not initialize kitchen data, calendars or weather in the beta deployment.
  if (isBetaDeployment()) redirect('/beta');
  const date = todayISO();
  let state: KitchenState;
  let initialDemo = false;
  try {
    state = await getKitchenState(date);
  } catch {
    state = demoKitchenState(date);
    initialDemo = true;
  }

  let weather: Weather | null = null;
  try {
    weather = await getWeather();
  } catch {}

  const host = (await headers()).get('host');
  const betaUrl = getBetaDestination(process.env, host);
  return <KioskBoard initial={state} initialDemo={initialDemo} initialWeather={weather} betaUrl={betaUrl}
    allowStreamAudio={process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT !== '1'}
    allowPantryEntry={!betaUrl && (process.env.NODE_ENV !== 'production' || process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1')} />;
}
