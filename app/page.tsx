import { KioskBoard } from '@/components/KioskBoard';
import { demoKitchenState } from '@/lib/cozyla';
import { getKitchenState } from '@/lib/domain';
import { todayISO } from '@/lib/time';
import { getWeather, type Weather } from '@/lib/weather';
import type { KitchenState } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const date = todayISO();
  let state: KitchenState;
  let demoMode = false;
  try {
    state = await getKitchenState(date);
  } catch {
    state = demoKitchenState(date);
    demoMode = true;
  }

  let weather: Weather | null = null;
  try {
    weather = await getWeather();
  } catch {}

  return (
    <>
      {demoMode && (
        <div
          style={{
            padding: '8px 20px',
            background: 'rgba(56, 189, 248, 0.14)',
            borderBottom: '1px solid rgba(56, 189, 248, 0.35)',
            color: '#bae6fd',
            fontSize: '0.88rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            🖥️ <strong>Cozyla 24&quot; Kiosk Preview Mode</strong> — showing sample family data until{' '}
            <code>.env.local</code> is connected to Supabase.
          </span>
          <span>Fully Kiosk Browser ready (1920×1080 / 2560×1440)</span>
        </div>
      )}
      <KioskBoard initial={state} initialWeather={weather} />
    </>
  );
}
