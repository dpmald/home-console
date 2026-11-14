'use client';
import { useEffect } from 'react';
import { fmtTime } from '@/lib/time';
import { NAMES } from '@/lib/family';
import type { KitchenState } from '@/lib/types';

declare global {
  interface Window {
    /**
     * Fully Kiosk Browser JavaScript Interface (`Enable JavaScript Interface` = ON).
     * Docs: https://www.fully-kiosk.com/en/#configuration-javascript
     */
    fully?: {
      turnScreenOn?: () => void;
      turnScreenOff?: (keepAlive?: boolean) => void;
      setScreenBrightness?: (level: number) => void;
      getScreenBrightness?: () => number;
      textToSpeech?: (text: string, locale?: string) => void;
      stopTextToSpeech?: () => void;
      playSound?: (url: string, loop?: boolean) => void;
      stopSound?: () => void;
      vibrate?: (millis: number) => void;
      bringToForeground?: () => void;
      clearCache?: () => void;
      loadStartUrl?: () => void;
      getDeviceName?: () => string;
      getBatteryLevel?: () => number;
    };
    onFullyMotion?: () => void;
    onFullyScreenOn?: () => void;
  }
}

export const isFullyKiosk = () => typeof window !== 'undefined' && typeof window.fully !== 'undefined';

/** Wake the Cozyla 24" panel (e.g. when a timer finishes or an urgent alert arrives). */
export function wakeCozylaScreen() {
  try {
    window.fully?.turnScreenOn?.();
    window.fully?.bringToForeground?.();
  } catch {}
}

/** Speak a short alert over the Cozyla's dual 5W speakers via Android TTS if Fully Kiosk is present. */
export function speakOnCozyla(text: string) {
  try {
    if (window.fully?.textToSpeech) {
      window.fully.textToSpeech(text);
      return true;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      return true;
    }
  } catch {}
  return false;
}

/**
 * Cozyla Calendar+ 24" + Fully Kiosk Browser lifecycle hook:
 * 1. Requests a Screen Wake Lock so Android never dims mid-cooking.
 * 2. Registers `window.onFullyMotion` / `window.onFullyScreenOn` so walking up
 *    to the Cozyla camera immediately refreshes the board.
 * 3. Automatically lowers panel brightness during late-night hours (10 PM–6:30 AM)
 *    when running inside Fully Kiosk Browser, and restores full brightness by day.
 * 4. Disables accidental pinch-zoom / context-menu / long-press selection on the
 *    24" touchscreen.
 */
export function useCozylaKiosk(onWakeRefresh: () => void) {
  useEffect(() => {
    let wakeLock: any = null;
    const acquireWakeLock = async () => {
      try {
        if ('wakeLock' in navigator && document.visibilityState === 'visible') {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {}
    };
    acquireWakeLock();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        acquireWakeLock();
        onWakeRefresh();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Fully Kiosk front-camera motion & screen-on callbacks
    window.onFullyMotion = () => {
      window.fully?.turnScreenOn?.();
      onWakeRefresh();
    };
    window.onFullyScreenOn = () => {
      onWakeRefresh();
    };

    // Day/night brightness schedule for the 24" IPS panel (when inside Fully Kiosk)
    const syncBrightness = () => {
      if (!window.fully?.setScreenBrightness) return;
      const h = new Date().getHours();
      const night = h >= 22 || h < 6;
      try {
        window.fully.setScreenBrightness(night ? 25 : 210);
      } catch {}
    };
    syncBrightness();
    const brightnessTimer = setInterval(syncBrightness, 15 * 60_000);

    // Prevent long-press context menu on Android WebView touchscreen
    const preventContext = (e: Event) => e.preventDefault();
    window.addEventListener('contextmenu', preventContext);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('contextmenu', preventContext);
      clearInterval(brightnessTimer);
      try {
        wakeLock?.release?.();
      } catch {}
    };
  }, [onWakeRefresh]);
}

/** Rich demo state so the 24" Cozyla layout can be previewed before Supabase is wired up. */
export function demoKitchenState(date: string): KitchenState {
  return {
    date,
    dinner: {
      date,
      chef: 'unclaimed',
      recipe_name: null,
      linked_backlog_id: null,
      status: 'unclaimed',
      unavailable: [],
      claimed_via: null,
    },
    backlog: [
      {
        id: 'demo-salmon',
        recipe_or_item_name: 'Miso Glazed Salmon & Bok Choy',
        key_perishables: ['salmon fillets', 'baby bok choy', 'scallions'],
        location: 'fridge',
        delivery_date: date,
        status: 'in_fridge',
        added_by: "Warren's Sat cart",
      },
      {
        id: 'demo-pasta',
        recipe_or_item_name: 'Lemon Ricotta Orecchiette with Peas',
        key_perishables: ['ricotta', 'fresh basil', 'snap peas'],
        location: 'fridge',
        delivery_date: '2026-11-09',
        status: 'in_fridge',
        added_by: "Warren's Sat cart",
      },
    ],
    chores: [
      { id: 'c1', chore_title: 'Make bed', emoji: '🛏️', chore_date: date, completed: true, completed_at: new Date().toISOString(), verified_in_greenlight: false },
      { id: 'c2', chore_title: 'Clear plate after dinner', emoji: '🍽️', chore_date: date, completed: false, completed_at: null, verified_in_greenlight: false },
      { id: 'c3', chore_title: 'Pack backpack for tomorrow', emoji: '🎒', chore_date: date, completed: false, completed_at: null, verified_in_greenlight: false },
      { id: 'c4', chore_title: 'Tidy bedroom', emoji: '🧸', chore_date: date, completed: true, completed_at: new Date().toISOString(), verified_in_greenlight: false },
    ],
    events: [
      {
        id: 'e1',
        external_event_id: 'gcal:1',
        source_calendar: 'daniela_google',
        title: 'Wesley Pediatric Dentist Checkup',
        start_time: `${date}T15:30:00-05:00`,
        end_time: `${date}T16:30:00-05:00`,
        logistics_type: 'appointment',
        assigned_parent: 'daniela',
      },
      {
        id: 'e2',
        external_event_id: 'outlook:2',
        source_calendar: 'warren_outlook',
        title: 'Pick up Wesley from soccer practice',
        start_time: `${date}T17:15:00-05:00`,
        end_time: `${date}T17:45:00-05:00`,
        logistics_type: 'pickup',
        assigned_parent: 'unassigned',
      },
      {
        id: 'e3',
        external_event_id: 'outlook:3',
        source_calendar: 'warren_outlook',
        title: 'Late office — Q4 partner review',
        start_time: `${date}T18:00:00-05:00`,
        end_time: `${date}T19:30:00-05:00`,
        logistics_type: 'late_office',
        assigned_parent: 'warren',
      },
    ],
    conflicts: [
      {
        eventId: 'e2',
        kind: 'unassigned',
        message: `${fmtTime(`${date}T17:15:00-05:00`)} Pick up Wesley from soccer practice has no owner`,
      },
    ],
    groceries: [
      { id: 'g1', name: 'Paper towels', quantity: '6-pack', status: 'needed', added_by: 'voice' },
      { id: 'g2', name: 'Oat milk', quantity: '2 cartons', status: 'needed', added_by: 'kiosk' },
    ],
    lateTonight: [
      { parent: 'warren', title: 'Late office — Q4 partner review', until: `${date}T19:30:00-05:00` },
    ],
    orders: [
      {
        id: 'ord-demo',
        delivery_date: date,
        status: 'pending',
        target_meal_count: 4,
        kept_recipes: [
          { name: 'Sheet-Pan Harissa Chicken Thighs', perishables: ['chicken thighs', 'cauliflower'] },
          { name: 'Crispy Black Bean Tacos', perishables: ['avocado', 'cilantro', 'limes'] },
        ],
        dropped_recipes: [{ name: 'Thai Green Curry' }, { name: 'Mushroom Risotto' }],
        items: [
          { name: 'Chicken thighs', quantity: '2 lb', source: 'Sheet-Pan Harissa Chicken Thighs' },
          { name: 'Cauliflower', quantity: '1 head', source: 'Sheet-Pan Harissa Chicken Thighs' },
          { name: 'Avocados', quantity: '3', source: 'Crispy Black Bean Tacos' },
          { name: 'Paper towels', quantity: '6-pack', source: 'household' },
        ],
        skipped_items: [{ name: 'Scallions', reason: 'already have scallions' }],
        backlog_snapshot: [],
        grocery_item_ids: ['g1'],
        slack_channel: null,
        slack_ts: null,
        decided_by: null,
        decided_at: null,
        created_at: new Date().toISOString(),
      },
    ],
  };
}
