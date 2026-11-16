import { KioskBoard } from '@/components/KioskBoard';
import { demoKitchenState } from '@/lib/demo';
import { getKitchenState } from '@/lib/domain';
import { todayISO } from '@/lib/time';
import { getWeather, type Weather } from '@/lib/weather';
import type { KitchenState } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const date = todayISO();
  let state: KitchenState;
  try {
    state = await getKitchenState(date);
  } catch {
    state = demoKitchenState(date);
  }

  let weather: Weather | null = null;
  try {
    weather = await getWeather();
  } catch {}

  return <KioskBoard initial={state} initialWeather={weather} groceryDevelopment={process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1'} />;
}
