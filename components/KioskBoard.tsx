'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';
import {
  NAMES,
  PARENTS,
  SOURCE_LABEL,
  formatClaimedDescription,
  isClaimableLogistics,
  isParent,
  isSchoolLogisticsEvent,
} from '@/lib/family';
import { daysBetween, fmtDay, fmtEventTime, fmtShortDate, fmtTime, isAllDay, todayISO } from '@/lib/time';
import {
  isFullyKiosk,
  launchGeminiOnCozyla,
  launchGreenlightOnCozyla,
  speakOnCozyla,
  useCozylaKiosk,
  wakeCozylaScreen,
  wakeSpotifyOnCozyla,
} from '@/lib/cozyla';
import type { BacklogLocation, KioskAction, KitchenState } from '@/lib/types';
import { NYC_LAT, NYC_LON, parseOpenMeteoResponse, type Weather } from '@/lib/weather';
import type { SpotifyNowPlaying } from '@/lib/spotify';
import { ThemeToggle } from './ThemeToggle';

interface Timer {
  id: string;
  label: string;
  initialSecs: number;
  endsAt: number;
  pausedRemaining?: number;
}

type ViewMode = 'ambient' | 'dinner' | 'bento' | 'timeline';
type MemberFilter = 'all' | 'school' | 'daniela' | 'warren' | 'wesley' | 'lachlan';

interface RecipeStep {
  stage: string;
  instruction: string;
  nextPreview: string;
  defaultTimerSecs: number;
}

const DEFAULT_RECIPE_STEPS: RecipeStep[] = [
  {
    stage: 'PREP & SCORE',
    instruction: 'Pat 4 wild salmon fillets dry with paper towels and lightly score skin at 1-inch intervals so the glaze caramelizes evenly.',
    nextPreview: 'Whisk sweet miso-mirin glaze (3m)',
    defaultTimerSecs: 180,
  },
  {
    stage: 'GLAZE WHISK',
    instruction: 'Whisk 2 tbsp white miso, 1 tbsp mirin, 1 tsp soy sauce, and 1/2 tsp grated ginger in a small bowl until glossy and smooth.',
    nextPreview: 'Broil glazed salmon fillets on High (6m)',
    defaultTimerSecs: 180,
  },
  {
    stage: 'BROILING',
    instruction: 'Brush wild salmon fillets with sweet miso-mirin glaze and broil on High for 6 minutes until caramelized blisters form.',
    nextPreview: 'Plate over warm steamed jasmine rice (4m)',
    defaultTimerSecs: 342,
  },
  {
    stage: 'RICE & SEAR',
    instruction: 'Fluff warm steamed jasmine rice from the Zojirushi into 4 wide ceramic bowls and drizzle lightly with toasted sesame oil.',
    nextPreview: 'Garnish with scallions & sesame seeds (2m)',
    defaultTimerSecs: 240,
  },
  {
    stage: 'GARNISH & SERVE',
    instruction: 'Top each bowl with a blistered miso salmon fillet, sliced scallions, and toasted white sesame seeds. Serve immediately.',
    nextPreview: 'Complete & mark dinner cooked',
    defaultTimerSecs: 120,
  },
];

interface UnstructuredMealTip {
  icon: string;
  title: string;
  detail: string;
  tag: string;
  isKidPick?: boolean;
}

const CHARCUTERIE_IMAGE_URL =
  'https://lh3.googleusercontent.com/aida/ALJJyrDkXsWWUygnUBaIy8vBt1Yh8LX65EDDZ9IZu2XKcERGw84lZdwj0ivw4vq2e4U2JaygGhWFPT8VNzDvIKSMvA5NfFchFizGbYbhDV0aDNbXMEGSWb5X-VcJ-APPeCzaH5HuUhYqWAiVXPq-jnbgJBM7JpRmqBA5dG_O6Zb7fzhyU4rnUPgCEc-Z3fy03kq77BfuE3ckYQz9AOKxW5Zvq0fmmcCqGNgQastPsHV0Ph1Q';

const STRUCTURED_RECIPE_TITLES = new Set([
  'crispy miso salmon rice bowls',
  'crispy black bean tacos',
  'lemon ricotta orecchiette',
  'sheet-pan harissa chicken',
]);

function getUnstructuredMealDetails(rawTitle: string | null | undefined): {
  mealTitle: string;
  imageUrl: string;
  imageAlt: string;
  sectionHeading: string;
  tips: UnstructuredMealTip[];
} {
  const mealTitle = rawTitle?.trim() || 'Charcuterie Board';
  const lower = mealTitle.toLowerCase();

  if (lower.includes('charcuterie') || lower.includes('cheese') || lower.includes('board') || !rawTitle?.trim()) {
    return {
      mealTitle,
      imageUrl: CHARCUTERIE_IMAGE_URL,
      imageAlt: 'Artisanal Charcuterie Board',
      sectionHeading: 'Assembly Tips & Recommendations',
      tips: [
        {
          icon: 'thermostat',
          title: 'Cheese Temperature & Slicing',
          detail: 'Let brie rest at room temp ~20m; slice sharp cheddar into wedges',
          tag: 'Cheese Tip',
        },
        {
          icon: 'layers',
          title: 'Meat Staging & Volume',
          detail: 'Fold prosciutto ribbons loosely & rosette salami for easy grabbing',
          tag: 'Meat Staging',
        },
        {
          icon: 'auto_awesome',
          title: 'Sweet & Savory Balance',
          detail: 'Center wildflower honey & mustard; pair grapes & figs near sharp cheeses',
          tag: 'Flavor Balance',
        },
        {
          icon: 'scatter_plot',
          title: 'Texture & Crunch',
          detail: 'Nestle sourdough crisps & Marcona almonds in dry pockets',
          tag: 'Crunch & Texture',
        },
        {
          icon: 'child_care',
          title: 'Kid-Friendly Staging',
          detail: 'Set mild Colby sticks & apple slices on dedicated corner for Wesley',
          tag: 'Wesley Pick',
          isKidPick: true,
        },
      ],
    };
  }

  return {
    mealTitle,
    imageUrl: CHARCUTERIE_IMAGE_URL,
    imageAlt: mealTitle,
    sectionHeading: 'Assembly Tips & Recommendations',
    tips: [
      {
        icon: 'thermostat',
        title: 'Prep & Temperature Staging',
        detail: `Pull core ingredients for ${mealTitle} 15–20m ahead for even cooking & plating`,
        tag: 'Prep Tip',
      },
      {
        icon: 'layers',
        title: 'Plating & Station Flow',
        detail: 'Stage warm serving bowls and platters near the main prep counter',
        tag: 'Station Flow',
      },
      {
        icon: 'auto_awesome',
        title: 'Bright Finishing Touches',
        detail: 'Finish with a squeeze of citrus, flaky sea salt, or fresh herbs right before serving',
        tag: 'Flavor Balance',
      },
      {
        icon: 'scatter_plot',
        title: 'Side & Texture Pairing',
        detail: 'Add a crisp green salad or toasted sourdough on the side for contrast',
        tag: 'Crunch & Texture',
      },
      {
        icon: 'child_care',
        title: 'Kid-Friendly Staging',
        detail: `Portion a milder plate of ${mealTitle} with sliced fruit on the side for Wesley`,
        tag: 'Wesley Pick',
        isKidPick: true,
      },
    ],
  };
}

const NPR_URL = process.env.NEXT_PUBLIC_NPR_STREAM_URL || 'https://npr-ice.streamguys1.com/live.mp3';

function GeminiSparkIcon({ size = 18, white = false }: { size?: number; white?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      {!white && (
        <defs>
          <linearGradient id="geminiSparkGrad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="var(--cobalt)" />
            <stop offset="55%" stopColor="var(--terracotta)" />
            <stop offset="100%" stopColor="var(--amber)" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M12 1.75C12.35 7.1 16.9 11.65 22.25 12C16.9 12.35 12.35 16.9 12 22.25C11.65 16.9 7.1 12.35 1.75 12C7.1 11.65 11.65 7.1 12 1.75Z"
        fill={white ? '#ffffff' : 'url(#geminiSparkGrad)'}
      />
    </svg>
  );
}

function GeminiEqualizerPill({ active = true }: { active?: boolean }) {
  const bars: { color: string; height: number; delay: string }[] = [
    { color: '#1d4ed8', height: 11, delay: '0s' },
    { color: '#1d4ed8', height: 19, delay: '0.12s' },
    { color: '#c2410c', height: 24, delay: '0.24s' },
    { color: '#b93815', height: 14, delay: '0.08s' },
    { color: '#15803d', height: 21, delay: '0.3s' },
    { color: '#c2410c', height: 10, delay: '0.18s' },
    { color: '#b93815', height: 17, delay: '0.36s' },
  ];
  return (
    <div className={`gemini-eq-pill ${active ? 'active' : ''}`}>
      {bars.map((b, i) => (
        <span
          key={i}
          className="gemini-eq-bar"
          style={{
            background: b.color,
            height: b.height,
            animationDelay: b.delay,
          }}
        />
      ))}
    </div>
  );
}

function chime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [0, 0.25, 0.5, 0.85, 1.1, 1.35].forEach((offset, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = i % 2 === 0 ? 880 : 660;
      gain.gain.setValueAtTime(0.22, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + offset + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.22);
    });
  } catch {}
}

function applyOptimisticAction(cur: KitchenState, a: KioskAction): KitchenState {
  switch (a.type) {
    case 'claim_dinner':
      return {
        ...cur,
        dinner: {
          ...cur.dinner,
          chef: a.chef,
          status: 'planned',
          recipe_name:
            a.recipeName !== undefined
              ? a.recipeName
              : a.chef === 'takeout'
                ? 'Takeout / Order In'
                : cur.dinner.chef === 'takeout'
                  ? null
                  : cur.dinner.recipe_name,
          linked_backlog_id: a.chef === 'takeout' ? null : cur.dinner.linked_backlog_id,
          unavailable: cur.dinner.unavailable.filter((p) => p !== a.chef),
          claimed_via: 'kiosk',
        },
      };
    case 'unclaim_dinner':
      return {
        ...cur,
        dinner: {
          ...cur.dinner,
          chef: 'unclaimed',
          status: 'unclaimed',
          recipe_name: null,
          linked_backlog_id: null,
          claimed_via: 'kiosk',
        },
      };
    case 'not_tonight': {
      const set = new Set(cur.dinner.unavailable);
      if (a.unavailable) set.add(a.parent);
      else set.delete(a.parent);
      return { ...cur, dinner: { ...cur.dinner, unavailable: [...set], claimed_via: 'kiosk' } };
    }
    case 'cook_from_backlog': {
      const item = cur.backlog.find((b) => b.id === a.backlogId);
      return {
        ...cur,
        dinner: {
          ...cur.dinner,
          chef: isParent(cur.dinner.chef) ? cur.dinner.chef : 'daniela',
          status: 'planned',
          recipe_name: item?.recipe_or_item_name ?? cur.dinner.recipe_name,
          linked_backlog_id: a.backlogId,
          claimed_via: 'kiosk',
        },
      };
    }
    case 'dinner_cooked':
      return {
        ...cur,
        dinner: { ...cur.dinner, status: 'cooked', claimed_via: 'kiosk' },
        backlog: cur.backlog.filter((b) => b.id !== cur.dinner.linked_backlog_id),
      };
    case 'backlog_status':
      return { ...cur, backlog: cur.backlog.filter((b) => b.id !== a.id) };
    case 'add_backlog':
      return {
        ...cur,
        backlog: [
          ...cur.backlog,
          {
            id: `local-${Date.now()}`,
            recipe_or_item_name: a.name,
            key_perishables: [],
            location: a.location,
            delivery_date: cur.date,
            status: 'in_fridge',
            added_by: 'kiosk',
          },
        ],
      };
    case 'toggle_chore':
      return {
        ...cur,
        chores: cur.chores.map((c) => (c.id === a.id ? { ...c, completed: a.completed } : c)),
      };
    case 'assign_logistics':
      return {
        ...cur,
        events: cur.events.map((e) =>
          e.id === a.id
            ? {
                ...e,
                assigned_parent: a.parent,
                description: formatClaimedDescription(e.description, e.title, a.parent),
              }
            : e,
        ),
        conflicts: cur.conflicts.filter((c) => c.eventId !== a.id || a.parent === 'unassigned'),
      };
    case 'add_grocery':
      return {
        ...cur,
        groceries: [
          ...cur.groceries,
          { id: `g-${Date.now()}`, name: a.name, quantity: null, status: 'needed', added_by: 'kiosk' },
        ],
      };
    case 'grocery_status':
      return { ...cur, groceries: cur.groceries.filter((g) => g.id !== a.id) };
  }
}

export function KioskBoard({ initial, initialWeather, betaUrl = null }: { initial: KitchenState; initialWeather: Weather | null; betaUrl?: string | null }) {
  const [state, setState] = useState<KitchenState>(initial);
  const [weather, setWeather] = useState<Weather | null>(initialWeather);
  const [mode, setMode] = useState<ViewMode>('ambient');
  const [memberFilter, setMemberFilter] = useState<MemberFilter>('all');
  const [now, setNow] = useState<Date>(() => new Date());
  const [timers, setTimers] = useState<Timer[]>([]);
  const [nprPlaying, setNprPlaying] = useState(false);
  const [spotify, setSpotify] = useState<SpotifyNowPlaying>({ configured: false, playing: false });
  const [newBacklog, setNewBacklog] = useState('');
  const [newBacklogLoc, setNewBacklogLoc] = useState<BacklogLocation>('fridge');
  const [newGrocery, setNewGrocery] = useState('');
  const [geminiOpen, setGeminiOpen] = useState(false);
  const [geminiCustomQuery, setGeminiCustomQuery] = useState('');
  const [geminiListening, setGeminiListening] = useState(false);
  const [geminiStampedAt, setGeminiStampedAt] = useState('');
  const [recipeStepIdx, setRecipeStepIdx] = useState(2); // Default Step 3 of 5 — BROILING
  const [broilSeconds, setBroilSeconds] = useState(342); // Default 05:42
  const [broilRunning, setBroilRunning] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [dinnerRecipeMode, setDinnerRecipeMode] = useState<'auto' | 'structured' | 'tips'>('auto');
  const [pendingChef, setPendingChef] = useState<'daniela' | 'warren' | null>(null);
  const [captureMealInput, setCaptureMealInput] = useState('');
  const [captureListening, setCaptureListening] = useState(false);
  const [liveDinnerTips, setLiveDinnerTips] = useState<{
    mealTitle: string;
    imageUrl: string;
    imageAlt: string;
    sectionHeading: string;
    tips: UnstructuredMealTip[];
  } | null>(null);
  const [liveStructuredRecipe, setLiveStructuredRecipe] = useState<{
    mealTitle: string;
    prepTime: string;
    cookTime: string;
    method: string;
    servings: string;
    steps: RecipeStep[];
    ingredients: { name: string; amount: string; prep: string }[];
    stationNotes: { icon: string; title: string; detail: string }[];
  } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nprRef = useRef<HTMLAudioElement | null>(null);
  const firedTimers = useRef<Set<string>>(new Set());

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setToastMsg(null);
    }, 2600);
  }, []);

  const openGeminiOverlay = useCallback(() => {
    setGeminiStampedAt(
      new Date().toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
      }),
    );
    setGeminiOpen(true);
  }, []);

  const applyVoiceCommandIfTimer = useCallback((text: string) => {
    const lower = text.toLowerCase();
    if (/\b(cancel|clear|stop|delete)\b.*\btimer/.test(lower)) {
      setTimers([]);
      return true;
    }
    const m = lower.match(/(\d+)\s*(?:-\s*)?(minute|minutes|min|mins|second|seconds|sec|secs)\b(?:\s+([a-z0-9 ]+?))?\s*(?:timer)?/);
    if (lower.includes('timer') && m) {
      const n = parseInt(m[1], 10);
      const unit = m[2].startsWith('sec') ? 1 : 60;
      const secs = Math.max(1, n * unit);
      const rawLabel = m[3]?.replace(/\b(for|timer|a|the)\b/g, '').trim();
      const label = rawLabel
        ? `${rawLabel.charAt(0).toUpperCase()}${rawLabel.slice(1)} Timer`
        : `${n} ${unit === 60 ? 'Min' : 'Sec'} Timer`;
      const id = `${Date.now()}`;
      firedTimers.current.delete(id);
      setTimers([{ id, label, initialSecs: secs, endsAt: Date.now() + secs * 1000 }]);
      return true;
    }
    return false;
  }, []);

  const startGeminiDictation = useCallback(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      launchGeminiOnCozyla();
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      setGeminiListening(true);
      rec.onresult = (ev: any) => {
        const transcript = ev.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setGeminiCustomQuery(transcript);
          applyVoiceCommandIfTimer(transcript);
          setGeminiStampedAt(
            new Date().toLocaleTimeString('en-US', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
              hour12: true,
            }),
          );
        }
      };
      rec.onend = () => setGeminiListening(false);
      rec.onerror = () => setGeminiListening(false);
      rec.start();
    } catch {
      setGeminiListening(false);
    }
  }, [applyVoiceCommandIfTimer]);

  const refreshKitchen = useCallback(async () => {
    try {
      const r = await fetch('/api/kiosk', { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } catch {}
  }, []);

  const refresh = useCallback(async () => {
    await refreshKitchen();
    try {
      const sr = await fetch('/api/spotify', { cache: 'no-store' });
      if (sr.ok) setSpotify(await sr.json());
    } catch {}
  }, [refreshKitchen]);

  useCozylaKiosk(refresh);

  const act = useCallback(async (action: KioskAction) => {
    try {
      const r = await fetch('/api/kiosk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (r.ok) {
        setState(await r.json());
        return;
      }
    } catch {}
    setState((cur) => applyOptimisticAction(cur, action));
  }, []);

  const decideOrder = useCallback(async (id: string, approve: boolean) => {
    try {
      const r = await fetch('/api/kiosk/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, approve }),
      });
      if (r.ok) {
        setState(await r.json());
        return;
      }
    } catch {}
    setState((cur) => ({
      ...cur,
      orders: cur.orders.map((o) => (o.id === id ? { ...o, status: approve ? 'approved' : 'rejected' } : o)),
      backlog: approve
        ? [
            ...cur.backlog,
            ...(cur.orders
              .find((o) => o.id === id)
              ?.kept_recipes.map((r, idx) => ({
                id: `approved-${idx}-${Date.now()}`,
                recipe_or_item_name: r.name,
                key_perishables: r.perishables ?? [],
                location: 'fridge' as const,
                delivery_date: cur.date,
                status: 'in_fridge' as const,
                added_by: "Warren's Sat cart",
              })) ?? []),
          ]
        : cur.backlog,
    }));
  }, []);

  const actSpotify = useCallback(async (op: 'play' | 'pause' | 'next', query?: string) => {
    try {
      const r = await fetch('/api/spotify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op, query }),
      });
      const j = await r.json();
      if (j.needsWake && wakeSpotifyOnCozyla()) {
        setTimeout(async () => {
          const r2 = await fetch('/api/spotify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, query }),
          });
          const j2 = await r2.json();
          if (j2.state) setSpotify(j2.state);
        }, 1800);
        return;
      }
      if (j.state) setSpotify(j.state);
    } catch {}
  }, []);

  // 1 Hz Clock + Rotary Timer tick + Dinner Hub Broiler Timer tick
  useEffect(() => {
    const id = setInterval(() => {
      const t = new Date();
      setNow(t);
      setTimers((cur) => {
        for (const tm of cur) {
          if (tm.pausedRemaining === undefined && tm.endsAt <= t.getTime() && !firedTimers.current.has(tm.id)) {
            firedTimers.current.add(tm.id);
            wakeCozylaScreen();
            chime();
            if (isFullyKiosk()) speakOnCozyla(`${tm.label} is done`);
          }
        }
        return cur;
      });
      setBroilSeconds((s) => {
        if (!broilRunning) return s;
        if (s > 1) return s - 1;
        setBroilRunning(false);
        chime();
        showToast('🔔 Salmon Broil Complete! Check caramelized blisters.');
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [broilRunning, showToast]);

  const refreshWeather = useCallback(async () => {
    try {
      const r = await fetch('/api/weather', { cache: 'no-store' });
      if (r.ok) {
        setWeather(await r.json());
        return;
      }
    } catch {}
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${NYC_LAT}&longitude=${NYC_LON}` +
        '&current=temperature_2m,apparent_temperature,weather_code' +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&temperature_unit=fahrenheit&timezone=auto&forecast_days=2';
      const r2 = await fetch(url);
      if (r2.ok) {
        setWeather(parseOpenMeteoResponse(await r2.json()));
      }
    } catch {}
  }, []);

  // Supabase Realtime broadcast subscription + fallback poll
  useEffect(() => {
    if (!initialWeather) {
      refreshWeather();
    }
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const sb = browserSupabase();
    const channel = sb
      ?.channel('kitchen')
      .on('broadcast', { event: 'db_change' }, () => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = null;
          refreshKitchen();
        }, 350);
      })
      .subscribe();
    const poll = setInterval(refresh, 45_000);
    const wx = setInterval(refreshWeather, 600_000);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (channel && sb) sb.removeChannel(channel);
      clearInterval(poll);
      clearInterval(wx);
    };
  }, [initialWeather, refresh, refreshKitchen, refreshWeather]);

  const playNpr = useCallback(() => {
    if (!nprRef.current) nprRef.current = new Audio(NPR_URL);
    nprRef.current.src = NPR_URL;
    nprRef.current.play().then(() => setNprPlaying(true)).catch(() => setNprPlaying(false));
  }, []);

  const stopNpr = useCallback(() => {
    if (nprRef.current) {
      nprRef.current.pause();
      nprRef.current.src = '';
    }
    setNprPlaying(false);
  }, []);

  const startTimer = useCallback((seconds: number, label = 'Kitchen Timer') => {
    const id = `${Date.now()}`;
    firedTimers.current.delete(id);
    setTimers([
      {
        id,
        label,
        initialSecs: seconds,
        endsAt: Date.now() + seconds * 1000,
      },
    ]);
  }, []);

  const activeTimer = timers[0];
  const timerRemainingSecs = activeTimer
    ? activeTimer.pausedRemaining !== undefined
      ? activeTimer.pausedRemaining
      : Math.max(0, Math.ceil((activeTimer.endsAt - now.getTime()) / 1000))
    : 0;
  const timerRunning = Boolean(activeTimer && activeTimer.pausedRemaining === undefined && timerRemainingSecs > 0);
  const timerMM = String(Math.floor(timerRemainingSecs / 60)).padStart(2, '0');
  const timerSS = String(timerRemainingSecs % 60).padStart(2, '0');
  const circumference = 2 * Math.PI * 41; // 257.6
  const timerRatio = activeTimer ? Math.min(1, Math.max(0, timerRemainingSecs / Math.max(1, activeTimer.initialSecs))) : 0;
  const timerDashOffset = circumference * (1 - timerRatio);

  const toggleActiveTimer = () => {
    if (!activeTimer) {
      startTimer(600, 'Kitchen Timer');
      return;
    }
    setTimers((cur) =>
      cur.map((tm, i) => {
        if (i !== 0) return tm;
        if (tm.pausedRemaining !== undefined) {
          return { ...tm, endsAt: Date.now() + tm.pausedRemaining * 1000, pausedRemaining: undefined };
        }
        const rem = Math.max(0, Math.ceil((tm.endsAt - Date.now()) / 1000));
        return { ...tm, pausedRemaining: rem };
      }),
    );
  };

  const bumpTimerMinute = () => {
    if (!activeTimer) {
      startTimer(60, '1 Min Timer');
      return;
    }
    setTimers((cur) =>
      cur.map((tm, i) => {
        if (i !== 0) return tm;
        if (tm.pausedRemaining !== undefined) {
          return { ...tm, pausedRemaining: tm.pausedRemaining + 60, initialSecs: tm.initialSecs + 60 };
        }
        return { ...tm, endsAt: tm.endsAt + 60_000, initialSecs: tm.initialSecs + 60 };
      }),
    );
  };

  const resetActiveTimer = () => {
    if (!activeTimer) return;
    setTimers((cur) =>
      cur.map((tm, i) => (i === 0 ? { ...tm, pausedRemaining: tm.initialSecs, endsAt: Date.now() + tm.initialSecs * 1000 } : tm)),
    );
  };

  const d = state.dinner;
  const activeRecipeSteps =
    liveStructuredRecipe &&
    d.recipe_name &&
    liveStructuredRecipe.mealTitle.toLowerCase() === d.recipe_name.trim().toLowerCase() &&
    liveStructuredRecipe.steps.length > 0
      ? liveStructuredRecipe.steps
      : DEFAULT_RECIPE_STEPS;
  const currentStep = activeRecipeSteps[recipeStepIdx % activeRecipeSteps.length] ?? DEFAULT_RECIPE_STEPS[2];
  const fmtBroilTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  const toggleBroilTimer = () => {
    setBroilRunning((running) => {
      const next = !running;
      showToast(next ? 'Broiler timer running' : `Timer paused at ${fmtBroilTime(broilSeconds)}`);
      return next;
    });
  };

  const adjustBroilTimer = (deltaSecs: number) => {
    setBroilSeconds((s) => {
      const updated = Math.max(0, s + deltaSecs);
      showToast(`Added +1m (Timer: ${fmtBroilTime(updated)})`);
      return updated;
    });
  };

  const toggleReadStepAloud = () => {
    if (ttsSpeaking) {
      setTtsSpeaking(false);
      try {
        window.speechSynthesis?.cancel();
      } catch {}
      return;
    }
    setTtsSpeaking(true);
    showToast('Playing voice assist via Kitchen Hub speaker...');
    if (isFullyKiosk()) {
      speakOnCozyla(currentStep.instruction);
    } else {
      try {
        const u = new SpeechSynthesisUtterance(currentStep.instruction);
        u.onend = () => setTtsSpeaking(false);
        window.speechSynthesis?.speak(u);
      } catch {}
    }
    setTimeout(() => {
      setTtsSpeaking(false);
    }, 4000);
  };

  const advanceRecipeStep = () => {
    const nextIdx = (recipeStepIdx + 1) % activeRecipeSteps.length;
    setRecipeStepIdx(nextIdx);
    const nextStep = activeRecipeSteps[nextIdx];
    setBroilSeconds(nextStep.defaultTimerSecs);
    showToast(`Advancing to Step ${nextIdx + 1}: ${nextStep.stage}`);
  };

  const prevRecipeStep = () => {
    const prevIdx = (recipeStepIdx - 1 + activeRecipeSteps.length) % activeRecipeSteps.length;
    setRecipeStepIdx(prevIdx);
    const prevStep = activeRecipeSteps[prevIdx];
    setBroilSeconds(prevStep.defaultTimerSecs);
    showToast(`Viewing Step ${prevIdx + 1}: ${prevStep.stage}`);
  };

  const selectFastRecipe = (recipeName: string, backlogId?: string) => {
    setPendingChef(null);
    setDinnerRecipeMode('structured');
    setRecipeStepIdx(0);
    if (backlogId) {
      act({ type: 'cook_from_backlog', backlogId });
    } else {
      act({ type: 'claim_dinner', chef: 'daniela', recipeName });
    }
    showToast(`Selected: ${recipeName}! Setting up recipe...`);
  };

  const startCaptureMealDictation = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      showToast('Voice dictation not available in this browser — type or tap a chip below');
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      setCaptureListening(true);
      rec.onresult = (ev: any) => {
        const transcript = ev.results?.[0]?.[0]?.transcript;
        if (transcript) {
          setCaptureMealInput(transcript);
        }
      };
      rec.onend = () => setCaptureListening(false);
      rec.onerror = () => setCaptureListening(false);
      rec.start();
    } catch {
      setCaptureListening(false);
    }
  };

  const confirmCapturedDinner = (chef: 'daniela' | 'warren', needRecipe: boolean, customMeal?: string) => {
    const chosenMeal =
      (customMeal ?? captureMealInput).trim() ||
      (needRecipe ? 'Crispy Miso Salmon Rice Bowls' : 'Charcuterie Board');
    setDinnerRecipeMode(needRecipe ? 'structured' : 'tips');
    if (needRecipe) setRecipeStepIdx(0);
    setPendingChef(null);
    setCaptureMealInput('');
    act({ type: 'claim_dinner', chef, recipeName: chosenMeal });
    showToast(
      needRecipe
        ? `${NAMES[chef]} is cooking ${chosenMeal} — generating step-by-step recipe!`
        : `${NAMES[chef]} is making ${chosenMeal} — loading Gemini tips & photo!`,
    );
  };

  // Time formatting
  const rawTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const [clockDigits, clockAmPm] = rawTime.split(' ');
  const autoHasStructuredRecipe =
    Boolean(d.linked_backlog_id) ||
    Boolean(d.recipe_name && STRUCTURED_RECIPE_TITLES.has(d.recipe_name.toLowerCase().trim()));
  const isStructuredRecipeView =
    dinnerRecipeMode === 'structured'
      ? true
      : dinnerRecipeMode === 'tips'
        ? false
        : autoHasStructuredRecipe;
  const isCapturingMeal =
    pendingChef !== null ||
    (d.status !== 'unclaimed' && isParent(d.chef) && !d.recipe_name?.trim() && !d.linked_backlog_id);
  const activeCaptureChef: 'daniela' | 'warren' =
    pendingChef ?? (isParent(d.chef) ? d.chef : 'daniela');
  const fallbackUnstructured = getUnstructuredMealDetails(d.recipe_name);
  const activeMealTitle = d.recipe_name?.trim() || 'Charcuterie Board';

  useEffect(() => {
    if (d.status === 'unclaimed' || isCapturingMeal) return;
    let cancelled = false;
    fetch(`/api/dinner-tips?meal=${encodeURIComponent(activeMealTitle)}&mode=tips`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data && Array.isArray(data.tips) && data.tips.length > 0) {
          setLiveDinnerTips(data);
        }
      })
      .catch(() => {});

    if (isStructuredRecipeView) {
      fetch(`/api/dinner-tips?meal=${encodeURIComponent(activeMealTitle)}&mode=recipe`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!cancelled && data && Array.isArray(data.steps) && data.steps.length > 0) {
            setLiveStructuredRecipe(data);
            setBroilSeconds(data.steps[0]?.defaultTimerSecs ?? 342);
          }
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [d.status, activeMealTitle, isStructuredRecipeView, isCapturingMeal]);

  const unstructuredDetails =
    liveDinnerTips && liveDinnerTips.mealTitle.toLowerCase() === activeMealTitle.toLowerCase()
      ? liveDinnerTips
      : fallbackUnstructured;
  const claimedChefName = isParent(d.chef) ? NAMES[d.chef] : d.chef === 'takeout' ? 'Takeout' : 'Daniela';
  const claimedChefEmoji = d.chef === 'warren' ? '👨‍🍳' : d.chef === 'takeout' ? '🥡' : '🙋‍♀️';
  const doneChores = state.chores.filter((c) => c.completed).length;
  const chorePct = state.chores.length > 0 ? Math.round((doneChores / state.chores.length) * 100) : 0;
  const allowanceChores = state.chores.filter((c) => (c.reward_cents ?? 0) === 0);
  const allowanceDone = allowanceChores.filter((c) => c.completed).length;
  const bonusEarnedCents = state.chores
    .filter((c) => c.completed && (c.reward_cents ?? 0) > 0)
    .reduce((sum, c) => sum + (c.reward_cents ?? 0), 0);
  const bonusTotalCents = state.chores
    .filter((c) => (c.reward_cents ?? 0) > 0)
    .reduce((sum, c) => sum + (c.reward_cents ?? 0), 0);
  const allowanceEarned = (bonusEarnedCents / 100).toFixed(2);
  const allowanceTotal = (bonusTotalCents / 100).toFixed(2);
  const pendingOrders = state.orders.filter((o) => o.status === 'pending');
  const nextUnassigned = state.events.find(
    (e) => isClaimableLogistics(e) && e.assigned_parent === 'unassigned',
  );
  const filteredEvents = state.events.filter((ev) => {
    if (memberFilter === 'all') return true;
    if (memberFilter === 'school') return isSchoolLogisticsEvent(ev);
    if (memberFilter === 'wesley') return ev.title.toLowerCase().includes('wesley');
    if (memberFilter === 'lachlan') {
      const t = ev.title.toLowerCase();
      return t.includes('lachlan') || t.includes('goddard');
    }
    return ev.assigned_parent === memberFilter || ev.source_calendar.startsWith(memberFilter);
  });
  const primaryEvent = filteredEvents[0] ?? state.events[0];
  const eventDate = primaryEvent ? todayISO(new Date(primaryEvent.start_time)) : state.date;
  const weatherIcon = weather?.current?.icon || 'sunny';
  const weatherIconColor =
    weatherIcon === 'rainy' || weatherIcon === 'weather_snowy'
      ? 'var(--cobalt)'
      : weatherIcon === 'thunderstorm'
        ? 'var(--terracotta)'
        : weatherIcon === 'cloud' || weatherIcon === 'foggy'
          ? 'var(--muted)'
          : 'var(--amber)';

  const audioStatusLabel = nprPlaying
    ? 'NPR LIVE STREAM (PLAYING)'
    : spotify.playing
      ? `SPOTIFY: ${(spotify.track || 'PLAYING').toUpperCase()}`
      : 'AUDIO STANDBY • NPR / SPOTIFY';

  return (
    <div className="hearth-canvas">
      {/* Ambient dot-pattern & warm terracotta/cobalt glow */}
      <div className="hearth-bg-dots" />
      <div className="hearth-glow-top" />
      <div className="hearth-glow-bottom" />

      <main className="hearth-shell">
        {/* ── 1. Top Glance Header (Clock + Date + NYC Outdoor Temp) ── */}
        {mode !== 'ambient' && (
          <header className="hearth-topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: '2.65rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {clockDigits}
                </span>
                <span
                  className="font-mono"
                  style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}
                >
                  {clockAmPm}
                </span>
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--text)' }}>
                {fmtDay(state.date)}
              </div>
              {weather?.current?.temp != null && (
                <>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--dot)' }} />
                  <div
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: '1.05rem',
                      fontWeight: 700,
                      color: 'var(--text)',
                    }}
                    title={weather.current.label}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{ color: weatherIconColor, fontSize: 22 }}
                    >
                      {weatherIcon}
                    </span>
                    <span>{weather.current.temp}°F</span>
                  </div>
                </>
              )}
            </div>
          </header>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            VIEW 1: CLEAN 10-FOOT AMBIENT STANDBY HEARTH VIEW (Matches Stitch Ambient Design)
            ════════════════════════════════════════════════════════════════════ */}
        {mode === 'ambient' && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              paddingBottom: 8,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '55fr 45fr',
                gap: 24,
                minHeight: 500,
                maxHeight: 720,
                height: '76vh',
              }}
            >
              {/* Left Primary Glanceable Card: Clean Giant Clock + Date + Outdoor Temp + Conditional Schedule Callout */}
              <div
                className="ceramic-card"
                style={{
                  padding: '44px 48px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  position: 'relative',
                  overflow: 'hidden',
                  background:
                    'radial-gradient(circle at 86% 16%, rgba(217, 78, 52, 0.085), transparent 54%), var(--surface)',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                    <span
                      style={{
                        fontSize: 'clamp(96px, 9.2vw, 138px)',
                        fontWeight: 800,
                        letterSpacing: '-0.045em',
                        lineHeight: 0.9,
                      }}
                    >
                      {clockDigits}
                    </span>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '1.6rem',
                          fontWeight: 700,
                          color: 'var(--terracotta)',
                          letterSpacing: '0.04em',
                          lineHeight: 1,
                        }}
                      >
                        {clockAmPm}
                      </span>
                    </div>
                  </div>

                  {/* Clean Single-Line Date & Weather Glance */}
                  <div
                    style={{
                      marginTop: 22,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 14,
                      fontSize: '1.35rem',
                      fontWeight: 600,
                    }}
                  >
                    <span>{fmtDay(state.date)}</span>
                    {weather?.current?.temp != null && (
                      <>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)' }} />
                        <span
                          style={{ display: 'flex', alignItems: 'center', gap: 7 }}
                          title={weather.current.label}
                        >
                          <span
                            className="material-symbols-outlined"
                            style={{ color: weatherIconColor, fontSize: 26 }}
                          >
                            {weatherIcon}
                          </span>
                          <span>{weather.current.temp}°F</span>
                        </span>
                      </>
                    )}
                  </div>

                  {/* Conditional SCHEDULE & LOGISTICS Callout (Only shown when events exist) */}
                  {state.events.length > 0 && (
                    <div
                      onClick={() => setMode('timeline')}
                      className="ceramic-well"
                      style={{
                        marginTop: 24,
                        padding: '16px 20px',
                        borderRadius: 18,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                        <div
                          style={{
                            width: 38,
                            height: 38,
                            borderRadius: 12,
                            background: 'rgba(43, 89, 255, 0.1)',
                            border: '1px solid rgba(43, 89, 255, 0.22)',
                            color: 'var(--cobalt)',
                            display: 'grid',
                            placeItems: 'center',
                            flexShrink: 0,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                            calendar_clock
                          </span>
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span
                              className="font-mono"
                              style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--cobalt)', letterSpacing: '0.06em' }}
                            >
                              SCHEDULE &amp; LOGISTICS
                            </span>
                            {nextUnassigned && (
                              <>
                                <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--dot)' }} />
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '0.64rem',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 6,
                                    background: 'var(--warm-badge-bg)',
                                    color: 'var(--terracotta)',
                                  }}
                                >
                                  UNCLAIMED
                                </span>
                              </>
                            )}
                          </div>
                          <div style={{ fontSize: '0.96rem', fontWeight: 700, marginTop: 3 }}>
                            {nextUnassigned
                              ? `${fmtEventTime(nextUnassigned.start_time, state.date)} • ${nextUnassigned.title}`
                              : `${fmtEventTime(state.events[0].start_time, state.date)} • ${state.events[0].title}`}
                          </div>
                        </div>
                      </div>
                      <div
                        style={{
                          marginTop: 10,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          color: 'var(--cobalt)',
                        }}
                      >
                        <span>View Family Schedule</span>
                        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                          arrow_forward
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Stack: Dinner Card + Conditional Bottom Container (Voice Timer OR Evening Routine & Restock) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minHeight: 0 }}>
                {/* Card 1: Undecided ("Tonight's Dinner Decision") vs Claimed ("[MENU // TONIGHT]") */}
                <div
                  className="ceramic-card"
                  style={{
                    padding: '24px 28px',
                    flex: activeTimer || state.groceries.length > 0 || state.events.length > 0 ? '0 0 auto' : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  {d.status === 'unclaimed' ? (
                    <>
                      <div>
                        <h2 style={{ fontSize: '1.46rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                          Tonight&apos;s Dinner Decision
                        </h2>
                        <p
                          style={{
                            fontSize: '0.86rem',
                            color: 'var(--text-secondary)',
                            marginTop: 6,
                            lineHeight: 1.5,
                          }}
                        >
                          {state.backlog.length > 0
                            ? `No cook selected yet. ${state.backlog.length} ${
                                state.backlog.length === 1 ? 'kit' : 'kits'
                              } ready to cook in <25m.`
                            : 'No cook selected yet. Tap below or claim dinner in Slack #food.'}
                        </p>

                        {/* Conditional Backlog Meal Kit Rows (Only rendered when backlog items exist) */}
                        {state.backlog.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                            {state.backlog.slice(0, 2).map((b, idx) => (
                              <div
                                key={b.id}
                                className="ceramic-well"
                                style={{
                                  padding: '10px 14px',
                                  borderRadius: 14,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 10,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                  <span
                                    className="material-symbols-outlined"
                                    style={{ fontSize: 18, color: idx === 0 ? 'var(--emerald)' : 'var(--terracotta)' }}
                                  >
                                    {idx === 0 ? 'eco' : 'ramen_dining'}
                                  </span>
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontSize: '0.82rem',
                                        fontWeight: 700,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                      }}
                                    >
                                      {b.recipe_or_item_name}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                                      {b.key_perishables.join(' • ') || 'Ready in fridge'}
                                    </div>
                                  </div>
                                </div>
                                <button
                                  className={`hw-btn ${idx === 0 ? 'emerald' : ''}`}
                                  style={{ padding: '8px 14px', fontSize: '0.75rem', borderRadius: 10, minHeight: 40 }}
                                  onClick={() => act({ type: 'cook_from_backlog', backlogId: b.id })}
                                >
                                  SELECT
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div
                            className="ceramic-well"
                            style={{
                              marginTop: 18,
                              padding: '16px 18px',
                              borderRadius: 16,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: 14,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <span
                                style={{
                                  width: 40,
                                  height: 40,
                                  borderRadius: 12,
                                  background: 'var(--warm-badge-bg)',
                                  color: 'var(--terracotta)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0,
                                }}
                              >
                                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                                  restaurant_menu
                                </span>
                              </span>
                              <div>
                                <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text)' }}>
                                  3 pantry &amp; fridge ideas ready in 15–25 min
                                </div>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                                  Crispy Black Bean Tacos • Lemon Ricotta Orecchiette • Harissa Chicken
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="hw-btn"
                              style={{
                                minHeight: 44,
                                padding: '10px 16px',
                                fontSize: '0.8rem',
                                borderRadius: 12,
                                background: 'var(--surface)',
                                flexShrink: 0,
                              }}
                              onClick={() => setMode('dinner')}
                            >
                              <span>Browse Ideas</span>
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                                arrow_forward
                              </span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* 2x2 Chef Assignment Tactile Grid (Sized for 24" Touch Display) */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 14,
                          marginTop: 18,
                          flex: state.backlog.length === 0 ? 1 : '0 0 auto',
                        }}
                      >
                        <button
                          className="hw-btn"
                          style={{
                            padding: state.backlog.length === 0 ? '18px 20px' : '12px 16px',
                            minHeight: state.backlog.length === 0 ? 108 : 56,
                            borderRadius: 18,
                            background: 'var(--surface)',
                            border: '1.5px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: 14,
                            textAlign: 'left',
                          }}
                          onClick={() => {
                            setCaptureMealInput('');
                            setPendingChef('daniela');
                            setMode('dinner');
                          }}
                        >
                          <span
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 14,
                              background: 'var(--emerald-surface)',
                              border: '1px solid var(--emerald-border)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--emerald)' }}>
                              skillet
                            </span>
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                              Daniela cooks
                            </div>
                            {state.backlog.length === 0 && (
                              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 3 }}>
                                Claim &amp; pick tonight&apos;s recipe
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          className="hw-btn"
                          style={{
                            padding: state.backlog.length === 0 ? '18px 20px' : '12px 16px',
                            minHeight: state.backlog.length === 0 ? 108 : 56,
                            borderRadius: 18,
                            background: 'var(--surface)',
                            border: '1.5px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: 14,
                            textAlign: 'left',
                          }}
                          onClick={() => {
                            setCaptureMealInput('');
                            setPendingChef('warren');
                            setMode('dinner');
                          }}
                        >
                          <span
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 14,
                              background: 'var(--warn-surface)',
                              border: '1px solid var(--warn-border)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--amber)' }}>
                              soup_kitchen
                            </span>
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                              Warren cooks
                            </div>
                            {state.backlog.length === 0 && (
                              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 3 }}>
                                Claim &amp; pick tonight&apos;s recipe
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          className="hw-btn"
                          style={{
                            padding: state.backlog.length === 0 ? '18px 20px' : '12px 16px',
                            minHeight: state.backlog.length === 0 ? 108 : 56,
                            borderRadius: 18,
                            background: 'var(--surface)',
                            border: '1.5px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: 14,
                            textAlign: 'left',
                          }}
                          onClick={() => act({ type: 'claim_dinner', chef: 'takeout' })}
                        >
                          <span
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 14,
                              background: 'var(--warm-badge-bg)',
                              border: '1px solid var(--warm-border)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--terracotta)' }}>
                              takeout_dining
                            </span>
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                              Takeout / Order In
                            </div>
                            {state.backlog.length === 0 && (
                              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 3 }}>
                                3 go-to spots • 20–35m delivery
                              </div>
                            )}
                          </div>
                        </button>
                        <button
                          className="hw-btn"
                          style={{
                            padding: state.backlog.length === 0 ? '18px 20px' : '12px 16px',
                            minHeight: state.backlog.length === 0 ? 108 : 56,
                            borderRadius: 18,
                            background: 'var(--surface)',
                            border: '1.5px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: 14,
                            textAlign: 'left',
                          }}
                          onClick={() => act({ type: 'claim_dinner', chef: 'takeout' })}
                        >
                          <span
                            style={{
                              width: 46,
                              height: 46,
                              borderRadius: 14,
                              background: 'var(--cobalt-surface)',
                              border: '1px solid var(--cobalt-border)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'var(--cobalt)' }}>
                              kitchen
                            </span>
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                              Leftovers &amp; Fend
                            </div>
                            {state.backlog.length === 0 && (
                              <div style={{ fontSize: '0.8rem', fontWeight: 500, color: 'var(--text-secondary)', marginTop: 3 }}>
                                Quick fridge clear-out night
                              </div>
                            )}
                          </div>
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 10,
                            marginBottom: 12,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span
                              className="font-mono"
                              style={{
                                fontSize: '0.78rem',
                                fontWeight: 700,
                                color: 'var(--terracotta)',
                                letterSpacing: '0.05em',
                              }}
                            >
                              TONIGHT&apos;S MENU
                            </span>
                            <span
                              className="font-mono"
                              style={{
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                padding: '3px 10px',
                                borderRadius: 6,
                                background: 'var(--warm-badge-bg)',
                                color: 'var(--terracotta)',
                                letterSpacing: '0.04em',
                              }}
                            >
                              {d.chef === 'takeout'
                                ? 'TAKEOUT'
                                : isParent(d.chef)
                                  ? `${NAMES[d.chef].toUpperCase()} LEAD`
                                  : 'PLANNED'}
                            </span>
                          </div>

                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.7rem',
                              fontWeight: 600,
                              color: 'var(--muted)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--terracotta)' }}>
                              skillet
                            </span>
                            6:30 PM PREP
                          </span>
                        </div>

                        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1.25 }}>
                          {d.recipe_name || `${isParent(d.chef) ? NAMES[d.chef] : 'Family'}'s Dinner`}
                        </h2>

                        <p
                          style={{
                            fontSize: '0.88rem',
                            color: 'var(--text-secondary)',
                            marginTop: 8,
                            lineHeight: 1.55,
                          }}
                        >
                          {state.backlog.find((b) => b.id === d.linked_backlog_id)?.key_perishables.join(', ') ||
                            'All fresh ingredients prepped on station.'}
                        </p>
                      </div>

                      <div
                        style={{
                          marginTop: 18,
                          paddingTop: 14,
                          borderTop: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <div
                          className="font-mono"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: 'var(--muted)',
                          }}
                        >
                          <span style={{ color: 'var(--emerald)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                              eco
                            </span>
                            4 Servings
                          </span>
                          <span>•</span>
                          <span>Prep: 20 min</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            className="hw-btn"
                            style={{ padding: '6px 12px', fontSize: '0.72rem' }}
                            onClick={() => setMode('dinner')}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                              menu_book
                            </span>
                            <span>VIEW RECIPE</span>
                          </button>
                          <button
                            className="hw-btn"
                            style={{ padding: '6px 10px', fontSize: '0.7rem' }}
                            onClick={() => act({ type: 'unclaim_dinner' })}
                          >
                            RESET
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Card 2A: Physical Rotary Kitchen Timer Widget (Conditional on an active voice-triggered timer) */}
                {activeTimer && (
                  <div
                    className="ceramic-card"
                    style={{
                      padding: '22px 28px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 18,
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 9,
                            height: 9,
                            borderRadius: '50%',
                            background: timerRunning ? 'var(--terracotta)' : 'var(--muted)',
                          }}
                        />
                        <span
                          className="font-mono"
                          style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--terracotta)', letterSpacing: '0.06em' }}
                        >
                          KITCHEN TIMER • {timerRunning ? 'ACTIVE' : 'PAUSED'}
                        </span>
                      </div>
                      <div style={{ margin: '6px 0 14px' }}>
                        <div style={{ fontSize: '1.22rem', fontWeight: 800 }}>
                          {activeTimer.label}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                          Stove Station • Voice Timer
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <button className="hw-btn terracotta" onClick={toggleActiveTimer}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                            {timerRunning ? 'pause' : 'play_arrow'}
                          </span>
                          <span>{timerRunning ? 'PAUSE' : 'RESUME'}</span>
                        </button>
                        <button className="hw-btn" onClick={bumpTimerMinute}>
                          +1 MIN
                        </button>
                        <button className="hw-btn" onClick={resetActiveTimer}>
                          RESET
                        </button>
                      </div>
                    </div>

                    {/* Circular SVG Rotary Gauge Dial */}
                    <div
                      style={{
                        position: 'relative',
                        width: 132,
                        height: 132,
                        borderRadius: '50%',
                        background: 'var(--surface-tint)',
                        border: '1px solid var(--border)',
                        boxShadow: 'inset 0 4px 10px rgba(0,0,0,0.05), 0 4px 12px rgba(0,0,0,0.03)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <svg style={{ width: 118, height: 118, transform: 'rotate(-90deg)' }} viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="41" fill="none" stroke="var(--border)" strokeWidth="7" />
                        <circle
                          cx="50"
                          cy="50"
                          r="41"
                          fill="none"
                          stroke="var(--terracotta)"
                          strokeWidth="7"
                          strokeLinecap="round"
                          strokeDasharray={circumference}
                          strokeDashoffset={timerDashOffset}
                          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
                        />
                      </svg>
                      <div
                        style={{
                          position: 'absolute',
                          inset: 0,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <span style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
                          {timerMM}:{timerSS}
                        </span>
                        <span
                          className="font-mono"
                          style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--muted)', letterSpacing: '0.1em' }}
                        >
                          REMAINING
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card 2B: Conditional [ EVENING ROUTINE & RESTOCK ] Card (Only shown when no active timer AND groceries/events exist) */}
                {!activeTimer && (state.groceries.length > 0 || state.events.length > 0) && (
                  <div
                    className="ceramic-card"
                    style={{
                      padding: '20px 24px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--cobalt)',
                          }}
                        />
                        <span
                          className="font-mono"
                          style={{ fontSize: '0.76rem', fontWeight: 700, color: 'var(--cobalt)', letterSpacing: '0.05em' }}
                        >
                          EVENING ROUTINE &amp; RESTOCK
                        </span>
                      </div>

                      <span
                        className="font-mono"
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          color: 'var(--muted)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--emerald)' }}>
                          check_circle
                        </span>
                        {doneChores}/{state.chores.length} Done
                      </span>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          state.groceries.length > 0 && state.events.length > 0 ? '1fr 1fr' : '1fr',
                        gap: 12,
                      }}
                    >
                      {state.groceries.length > 0 && (
                        <div
                          className="ceramic-well"
                          style={{
                            padding: '14px 16px',
                            borderRadius: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--muted)' }}>
                                RESTOCK STAGING
                              </span>
                              <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--terracotta)' }}>
                                shopping_cart
                              </span>
                            </div>
                            <div style={{ fontSize: '1.12rem', fontWeight: 800, marginTop: 4 }}>
                              {state.groceries.length} {state.groceries.length === 1 ? 'item' : 'items'} low
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                              {state.groceries.map((g) => g.name).join(' & ')}
                            </div>
                          </div>
                          <button
                            className="hw-btn"
                            style={{ width: '100%', padding: '6px 10px', fontSize: '0.72rem' }}
                            onClick={() => setMode('bento')}
                          >
                            + Add Item
                          </button>
                        </div>
                      )}

                      {state.events.length > 0 && (
                        <div
                          className="ceramic-well"
                          style={{
                            padding: '14px 16px',
                            borderRadius: 16,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 10,
                          }}
                        >
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span className="font-mono" style={{ fontSize: '0.64rem', fontWeight: 700, color: 'var(--muted)' }}>
                                NIGHT PREP
                              </span>
                              <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--cobalt)' }}>
                                dark_mode
                              </span>
                            </div>
                            <div style={{ fontSize: '1.12rem', fontWeight: 800, marginTop: 4 }}>
                              Wind-down 8:30
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                              {state.events[0].title}
                            </div>
                          </div>
                          <button
                            className="hw-btn"
                            style={{ width: '100%', padding: '6px 10px', fontSize: '0.72rem' }}
                            onClick={() => setMode('timeline')}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--cobalt)' }}>
                              check_circle
                            </span>
                            <span>Logistics Preview</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            VIEW 2: DINNER HUB — PLANNED DINNER (HAPPY PATH) & UNDECIDED DINNER
            ════════════════════════════════════════════════════════════════════ */}
        {mode === 'dinner' && (
          <div
            id="bentoMainGrid"
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              gap: 16,
              paddingTop: 4,
              overflow: 'hidden',
            }}
          >
            {/* LEFT MAIN CANVAS (~79% width): Planned Cooking Guide OR Undecided Dinner Decision */}
            <section
              className="ceramic-card"
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                borderRadius: 18,
                padding: '20px 24px',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              {/* Subtle top-right radial glow */}
              <div
                style={{
                  position: 'absolute',
                  top: -64,
                  right: -64,
                  width: 224,
                  height: 224,
                  borderRadius: '50%',
                  background: 'var(--warm-glow)',
                  filter: 'blur(40px)',
                  pointerEvents: 'none',
                }}
              />

              {isCapturingMeal ? (
                /* ── CAPTURE FLOW: WHAT IS BEING COOKED & IS A RECIPE NEEDED? ── */
                <>
                  {/* Top Banner: Chef Selected — What's on the Menu? */}
                  <div
                    style={{
                      borderRadius: 16,
                      padding: '20px 24px',
                      background: 'var(--warm-banner-bg)',
                      border: '2px solid var(--warm-border)',
                      boxShadow: '0 1px 2px rgba(40, 25, 15, 0.03)',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 16,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                      <div
                        style={{
                          width: 52,
                          height: 52,
                          borderRadius: 16,
                          background: 'var(--warm-badge-bg)',
                          border: '1px solid var(--warm-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 26,
                          flexShrink: 0,
                        }}
                      >
                        <span>{activeCaptureChef === 'warren' ? '👨‍🍳' : '🙋‍♀️'}</span>
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            className="font-mono"
                            style={{
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: 'var(--warm-badge-bg)',
                              color: 'var(--warm-badge-text)',
                              fontSize: 11,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                            }}
                          >
                            STEP 1 OF 2 • SET TONIGHT&apos;S MENU
                          </span>
                        </div>
                        <h1
                          style={{
                            fontSize: 'clamp(1.55rem, 2vw, 1.85rem)',
                            fontWeight: 800,
                            color: 'var(--text)',
                            letterSpacing: '-0.025em',
                            marginTop: 4,
                          }}
                        >
                          {NAMES[activeCaptureChef]} is cooking tonight — what&apos;s on the menu?
                        </h1>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setPendingChef(null);
                        setCaptureMealInput('');
                        if (d.status !== 'unclaimed' && !d.recipe_name?.trim()) {
                          act({ type: 'unclaim_dinner' });
                        }
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 16px',
                        borderRadius: 12,
                        background: 'var(--surface)',
                        color: 'var(--text-secondary)',
                        border: '1px solid var(--border)',
                        fontSize: 14,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--muted)' }}>
                        arrow_back
                      </span>
                      <span>Change Cook</span>
                    </button>
                  </div>

                  {/* Middle Card: Dish Name Input + Voice Dictation + Quick Chips */}
                  <div
                    style={{
                      padding: '18px 22px',
                      borderRadius: 16,
                      background: 'var(--surface-tint)',
                      border: '1px solid var(--border)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 14,
                      marginTop: 12,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          color: 'var(--text-secondary)',
                          letterSpacing: '0.06em',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--clay)' }}>
                          restaurant_menu
                        </span>
                        WHAT ARE YOU MAKING? (TYPE, SPEAK, OR TAP A QUICK PICK)
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                      <input
                        type="text"
                        value={captureMealInput}
                        onChange={(e) => setCaptureMealInput(e.target.value)}
                        placeholder="e.g. Charcuterie Board, Crispy Miso Salmon Rice Bowls, Lemon Pasta…"
                        style={{
                          flex: 1,
                          padding: '14px 18px',
                          borderRadius: 12,
                          background: 'var(--surface)',
                          border: '1.5px solid var(--border)',
                          fontSize: '1.15rem',
                          fontWeight: 600,
                          color: 'var(--text)',
                        }}
                      />
                      <button
                        type="button"
                        onClick={startCaptureMealDictation}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '0 20px',
                          borderRadius: 12,
                          background: captureListening ? 'var(--terracotta)' : 'var(--cobalt-surface)',
                          color: captureListening ? '#ffffff' : 'var(--cobalt)',
                          border: `1px solid ${captureListening ? 'var(--terracotta)' : 'var(--cobalt-border)'}`,
                          fontSize: '0.98rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                          {captureListening ? 'graphic_eq' : 'mic'}
                        </span>
                        <span>{captureListening ? 'Listening…' : 'Speak Dish'}</span>
                      </button>
                    </div>

                    {/* Quick-Tap Dish Chips */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)' }}>
                        QUICK PICKS:
                      </span>
                      {[
                        ...state.backlog.map((b) => b.recipe_or_item_name),
                        'Charcuterie Board',
                        'Crispy Miso Salmon Rice Bowls',
                        'Lemon Ricotta Orecchiette',
                        'Crispy Black Bean Tacos',
                        'Sheet-Pan Harissa Chicken',
                        'Homemade Pizza Night',
                      ]
                        .filter((v, i, arr) => arr.indexOf(v) === i)
                        .slice(0, 6)
                        .map((chip) => {
                          const selected = captureMealInput.trim().toLowerCase() === chip.toLowerCase();
                          return (
                            <button
                              key={chip}
                              type="button"
                              onClick={() => setCaptureMealInput(chip)}
                              style={{
                                padding: '6px 13px',
                                borderRadius: 999,
                                background: selected ? '#ab2f0d' : 'var(--surface)',
                                color: selected ? '#ffffff' : 'var(--text)',
                                border: `1px solid ${selected ? '#ab2f0d' : 'var(--border)'}`,
                                fontSize: '0.84rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              {chip}
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* Bottom 2-Col Decision: Need a Structured Recipe vs. No Recipe Needed (Just Tips & Photo) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 16,
                      flex: 1,
                      minHeight: 0,
                      paddingTop: 12,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    {/* Option 1: Need a Structured Step-by-Step Recipe */}
                    <div
                      style={{
                        borderRadius: 16,
                        padding: 22,
                        background: 'var(--warm-card-bg)',
                        border: '2px solid var(--warm-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 14,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              background: 'var(--warm-badge-bg)',
                              color: 'var(--clay)',
                              display: 'grid',
                              placeItems: 'center',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                              menu_book
                            </span>
                          </div>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: '4px 10px',
                              borderRadius: 999,
                              background: 'var(--warm-badge-bg)',
                              color: 'var(--warm-badge-text)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            FULL COOKING GUIDE
                          </span>
                        </div>

                        <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text)', marginTop: 14 }}>
                          Need a Recipe (Step-by-Step)
                        </h2>
                        <p style={{ fontSize: '0.94rem', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
                          Builds an interactive 5-step cooking canvas with step timers, read-aloud voice assist, key
                          ingredient prep, and station notes.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => confirmCapturedDinner(activeCaptureChef, true)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '15px 20px',
                          borderRadius: 12,
                          background: '#ab2f0d',
                          color: '#ffffff',
                          fontSize: '1.05rem',
                          fontWeight: 800,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                          skillet
                        </span>
                        <span>
                          Open Step-by-Step Recipe
                          {captureMealInput.trim() ? ` for “${captureMealInput.trim()}”` : ''}
                        </span>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          arrow_forward
                        </span>
                      </button>
                    </div>

                    {/* Option 2: No Structured Recipe Needed — Gemini Assembly Tips & Representative Photo */}
                    <div
                      style={{
                        borderRadius: 16,
                        padding: 22,
                        background: 'var(--cobalt-card-bg)',
                        border: '2px solid var(--cobalt-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 14,
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <div
                            style={{
                              width: 44,
                              height: 44,
                              borderRadius: 12,
                              background: 'var(--cobalt-surface)',
                              color: 'var(--cobalt)',
                              display: 'grid',
                              placeItems: 'center',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                              tips_and_updates
                            </span>
                          </div>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: 11,
                              fontWeight: 800,
                              padding: '4px 10px',
                              borderRadius: 999,
                              background: 'var(--cobalt-surface)',
                              color: 'var(--cobalt)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.05em',
                            }}
                          >
                            GEMINI TIPS &amp; PHOTO
                          </span>
                        </div>

                        <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: 'var(--text)', marginTop: 14 }}>
                          No Recipe Needed (Tips &amp; Photo)
                        </h2>
                        <p style={{ fontSize: '0.94rem', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 }}>
                          Ideal for boards, assemblies, or dishes you know by heart. Displays a representative photo
                          alongside 5 Gemini staging &amp; kid-friendly tips.
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => confirmCapturedDinner(activeCaptureChef, false)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '15px 20px',
                          borderRadius: 12,
                          background: '#2b59ff',
                          color: '#ffffff',
                          fontSize: '1.05rem',
                          fontWeight: 800,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                          auto_awesome
                        </span>
                        <span>
                          Show Gemini Tips &amp; Photo
                          {captureMealInput.trim() ? ` for “${captureMealInput.trim()}”` : ''}
                        </span>
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          arrow_forward
                        </span>
                      </button>
                    </div>
                  </div>
                </>
              ) : d.status !== 'unclaimed' && isStructuredRecipeView ? (
                /* ── STATE A: PLANNED DINNER HAPPY PATH (Structured Cooking & Recipe Focus) ── */
                <>
                  {/* Top Recipe Header */}
                  <div
                    style={{
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      borderBottom: '1px solid var(--border-subtle)',
                      paddingBottom: 14,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className="font-mono"
                          style={{
                            padding: '2px 10px',
                            borderRadius: 6,
                            background: 'var(--warm-badge-bg)',
                            color: 'var(--warm-badge-text)',
                            fontSize: 11,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                          }}
                        >
                          TONIGHT&apos;S DINNER • 6:30 PM
                        </span>
                        <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          • {liveStructuredRecipe?.servings || '4 Servings'}
                        </span>
                        <span className="font-mono" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          • Owner: {isParent(d.chef) ? NAMES[d.chef] : d.chef === 'takeout' ? 'Takeout' : 'Daniela'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setDinnerRecipeMode('tips');
                            showToast('Switched to Gemini Assembly Tips & Photo view');
                          }}
                          className="font-mono"
                          style={{
                            padding: '4px 10px',
                            borderRadius: 8,
                            background: 'var(--warm-surface)',
                            border: '1px solid var(--warm-border)',
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--clay)',
                            cursor: 'pointer',
                          }}
                        >
                          Tips &amp; Photo View
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCaptureMealInput(d.recipe_name || '');
                            setPendingChef(isParent(d.chef) ? d.chef : 'daniela');
                          }}
                          className="font-mono"
                          style={{
                            padding: '4px 10px',
                            borderRadius: 8,
                            background: 'var(--surface-well)',
                            border: '1px solid var(--border)',
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--text-secondary)',
                            cursor: 'pointer',
                          }}
                        >
                          Edit Dish
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingChef(null);
                            setDinnerRecipeMode('auto');
                            act({ type: 'unclaim_dinner' });
                            showToast('Dinner reset to undecided');
                          }}
                          className="font-mono"
                          style={{
                            padding: '4px 10px',
                            borderRadius: 8,
                            background: 'var(--surface-well)',
                            border: '1px solid var(--border)',
                            fontSize: 11,
                            fontWeight: 700,
                            color: 'var(--muted)',
                            cursor: 'pointer',
                          }}
                        >
                          Reset
                        </button>
                      </div>
                    </div>

                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: 12,
                        paddingTop: 2,
                      }}
                    >
                      <h1
                        style={{
                          fontSize: 'clamp(1.5rem, 2vw, 1.875rem)',
                          fontWeight: 800,
                          color: 'var(--text)',
                          letterSpacing: '-0.025em',
                        }}
                      >
                        {d.recipe_name || 'Crispy Miso Salmon Rice Bowls'}
                      </h1>

                      <div
                        className="font-mono"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'var(--surface-well)',
                            padding: '4px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--terracotta)' }}>
                            timer
                          </span>
                          Prep: <strong>{liveStructuredRecipe?.prepTime || '20 min'}</strong>
                        </span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'var(--surface-well)',
                            padding: '4px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--clay)' }}>
                            skillet
                          </span>
                          Cook: <strong>{liveStructuredRecipe?.cookTime || '18 min'}</strong>
                        </span>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            background: 'var(--surface-well)',
                            padding: '4px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--amber)' }}>
                            local_fire_department
                          </span>
                          {liveStructuredRecipe?.method || 'Stovetop + Broiler'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Active Cooking Step Hero Box */}
                  <div
                    style={{
                      borderRadius: 16,
                      padding: '20px 24px',
                      background: 'var(--warm-surface)',
                      border: '2px solid var(--warm-border)',
                      boxShadow: '0 1px 2px rgba(40, 25, 15, 0.03)',
                      margin: '12px 0',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      flexShrink: 0,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        paddingBottom: 8,
                        borderBottom: '1px solid var(--warm-divider)',
                      }}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: 'var(--terracotta)',
                            boxShadow: '0 0 0 4px rgba(232, 90, 54, 0.2)',
                          }}
                        />
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 12,
                            fontWeight: 900,
                            textTransform: 'uppercase',
                            color: 'var(--clay)',
                            letterSpacing: '0.06em',
                          }}
                        >
                          STEP {(recipeStepIdx % activeRecipeSteps.length) + 1} OF {activeRecipeSteps.length} —{' '}
                          {currentStep.stage}
                        </span>
                      </div>
                      <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                        Next: {currentStep.nextPreview}
                      </span>
                    </div>

                    <p
                      style={{
                        fontSize: 'clamp(1.25rem, 1.55vw, 1.5rem)',
                        fontWeight: 700,
                        color: 'var(--text)',
                        lineHeight: 1.55,
                        padding: '12px 0',
                      }}
                    >
                      {currentStep.instruction}
                    </p>

                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        paddingTop: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          type="button"
                          onClick={toggleReadStepAloud}
                          className="font-mono"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 16px',
                            borderRadius: 12,
                            background: 'var(--surface)',
                            color: 'var(--text)',
                            fontSize: 12,
                            fontWeight: 700,
                            border: '1px solid var(--warm-border)',
                            boxShadow: '0 1px 2px rgba(40,25,15,0.03)',
                            cursor: 'pointer',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--terracotta)' }}>
                            {ttsSpeaking ? 'graphic_eq' : 'volume_up'}
                          </span>
                          <span>
                            {ttsSpeaking
                              ? `Speaking Step ${(recipeStepIdx % activeRecipeSteps.length) + 1}...`
                              : 'Read Step Aloud 🔊'}
                          </span>
                        </button>

                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '6px 14px',
                            borderRadius: 12,
                            background: 'var(--warm-pill-bg)',
                            border: '1px solid var(--warm-border)',
                            color: 'var(--clay)',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--terracotta)' }}>
                            local_fire_department
                          </span>
                          <span
                            className="font-mono"
                            style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em' }}
                          >
                            {fmtBroilTime(broilSeconds)}
                          </span>
                          <button
                            type="button"
                            onClick={() => adjustBroilTimer(60)}
                            className="font-mono"
                            style={{
                              padding: '2px 8px',
                              borderRadius: 8,
                              background: 'var(--surface)',
                              color: 'var(--clay)',
                              fontSize: 12,
                              fontWeight: 700,
                              border: '1px solid var(--warm-border)',
                              cursor: 'pointer',
                            }}
                          >
                            +1m
                          </button>
                          <button
                            type="button"
                            onClick={toggleBroilTimer}
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 8,
                              background: '#e85a36',
                              color: '#ffffff',
                              border: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              cursor: 'pointer',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              {broilRunning ? 'pause' : 'play_arrow'}
                            </span>
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={prevRecipeStep}
                          className="font-mono"
                          style={{
                            padding: '10px 14px',
                            borderRadius: 12,
                            background: 'var(--surface)',
                            color: 'var(--muted)',
                            fontSize: 12,
                            fontWeight: 700,
                            border: '1px solid var(--border)',
                            cursor: 'pointer',
                          }}
                        >
                          ← Prev Step
                        </button>
                        <button
                          type="button"
                          onClick={advanceRecipeStep}
                          className="font-mono"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '10px 20px',
                            borderRadius: 12,
                            background: '#ab2f0d',
                            color: '#ffffff',
                            fontSize: 12,
                            fontWeight: 700,
                            letterSpacing: '0.06em',
                            textTransform: 'uppercase',
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <span>Next Step ({((recipeStepIdx + 1) % activeRecipeSteps.length) + 1})</span>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                            arrow_forward
                          </span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bottom 2-Column Grid: Key Ingredients & Prep + Station Notes & Equipment */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 16,
                      flex: 1,
                      minHeight: 0,
                      paddingTop: 4,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    {/* Left: KEY INGREDIENTS & PREP */}
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 12,
                        background: 'var(--surface-tint)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        overflowY: 'auto',
                        minHeight: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: 8,
                          borderBottom: '1px solid var(--border)',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: 'var(--text-secondary)',
                            letterSpacing: '0.06em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--clay)' }}>
                            grocery
                          </span>
                          KEY INGREDIENTS &amp; PREP
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                        {(
                          liveStructuredRecipe?.ingredients || [
                            {
                              name: 'Wild Salmon Fillets',
                              amount: '4 × 6 oz',
                              prep: 'Skin-on, patted dry, flesh scored lightly at 1-inch intervals',
                            },
                            {
                              name: 'Sweet Miso Glaze',
                              amount: 'Whisked & Ready',
                              prep: '2 tbsp white miso + 1 tbsp mirin + 1 tsp soy sauce + 1/2 tsp grated ginger',
                            },
                            {
                              name: 'Steamed Jasmine Rice',
                              amount: '3 cups cooked',
                              prep: 'Zojirushi keep-warm mode • Fluffed with paddle and vented',
                            },
                          ]
                        ).map((ing) => (
                          <div
                            key={ing.name}
                            style={{
                              padding: 10,
                              borderRadius: 8,
                              background: 'var(--surface)',
                              border: '1px solid var(--border)',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 4,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 700, color: 'var(--text)', fontSize: 14 }}>{ing.name}</span>
                              <span
                                className="font-mono"
                                style={{
                                  fontWeight: 700,
                                  color: 'var(--clay)',
                                  background: 'var(--warm-surface)',
                                  border: '1px solid var(--warm-border)',
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  fontSize: 11,
                                }}
                              >
                                {ing.amount}
                              </span>
                            </div>
                            <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                              {ing.prep}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Right: STATION NOTES & EQUIPMENT */}
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 12,
                        background: 'var(--surface-tint)',
                        border: '1px solid var(--border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        overflowY: 'auto',
                        minHeight: 0,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: 8,
                          borderBottom: '1px solid var(--border)',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: 'var(--text-secondary)',
                            letterSpacing: '0.06em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--cobalt)' }}>
                            countertops
                          </span>
                          STATION NOTES &amp; EQUIPMENT
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                        {(
                          liveStructuredRecipe?.stationNotes || [
                            {
                              icon: 'oven_gen',
                              title: 'Broiler Rack Position',
                              detail: 'Set to top position (4 inches from heat element)',
                            },
                            {
                              icon: 'skillet',
                              title: 'Cast Iron Sizzling Pan',
                              detail: 'Preheated with light sesame oil',
                            },
                            {
                              icon: 'lunch_dining',
                              title: 'Garnish Station Staged',
                              detail: 'Toasted white sesame seeds & sliced scallions',
                            },
                          ]
                        ).map((note, idx) => {
                          const iconColors = ['var(--cobalt)', 'var(--terracotta)', 'var(--emerald)'];
                          const detailColors = ['var(--text-secondary)', 'var(--terracotta)', 'var(--emerald)'];
                          return (
                            <div
                              key={note.title}
                              style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 10,
                                padding: '8px 10px',
                                borderRadius: 8,
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                              }}
                            >
                              <span
                                className="material-symbols-outlined"
                                style={{ fontSize: 18, color: iconColors[idx % iconColors.length] }}
                              >
                                {note.icon || 'countertops'}
                              </span>
                              <div style={{ minWidth: 0 }}>
                                <p style={{ fontWeight: 700, color: 'var(--text)' }}>{note.title}</p>
                                <p
                                  className="font-mono"
                                  style={{ fontSize: 11, color: detailColors[idx % detailColors.length] }}
                                >
                                  {note.detail}
                                </p>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </>
              ) : d.status !== 'unclaimed' ? (
                /* ── STATE B: CLAIMED DINNER — NO STRUCTURED RECIPE (Photo + Gemini Assembly Tips & Recommendations) ── */
                <>
                  {/* Top Decision Claimed Banner */}
                  <div
                    style={{
                      borderRadius: 16,
                      padding: '20px 24px',
                      background: 'var(--warm-banner-bg)',
                      border: '2px solid var(--warm-border)',
                      boxShadow: '0 1px 2px rgba(40, 25, 15, 0.03)',
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 16,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div
                          style={{
                            width: 48,
                            height: 48,
                            borderRadius: 16,
                            background: 'var(--warm-badge-bg)',
                            border: '1px solid var(--warm-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 24,
                            flexShrink: 0,
                          }}
                        >
                          <span>{claimedChefEmoji}</span>
                        </div>
                        <div>
                          <h1
                            style={{
                              fontSize: 'clamp(1.6rem, 2.1vw, 1.875rem)',
                              fontWeight: 800,
                              color: 'var(--text)',
                              letterSpacing: '-0.025em',
                            }}
                          >
                            {claimedChefName} is making {unstructuredDetails.mealTitle}
                          </h1>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setDinnerRecipeMode('structured');
                            showToast('Switched to Step-by-Step Cooking Guide');
                          }}
                          className="font-mono"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '10px 14px',
                            borderRadius: 12,
                            background: 'var(--warm-surface)',
                            color: 'var(--clay)',
                            border: '1px solid var(--warm-border)',
                            fontSize: 12,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                            menu_book
                          </span>
                          <span>Step-by-Step Guide</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setCaptureMealInput(d.recipe_name || '');
                            setPendingChef(isParent(d.chef) ? d.chef : 'daniela');
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '10px 14px',
                            borderRadius: 12,
                            background: 'var(--surface-well)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                            fontSize: 13,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--muted)' }}>
                            edit
                          </span>
                          <span>Edit Dish</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setPendingChef(null);
                            setDinnerRecipeMode('auto');
                            act({ type: 'unclaim_dinner' });
                            showToast('Reopening claim dinner options...');
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '10px 14px',
                            borderRadius: 12,
                            background: 'var(--surface)',
                            color: 'var(--text-secondary)',
                            border: '1px solid var(--border)',
                            boxShadow: '0 1px 2px rgba(40, 25, 15, 0.03)',
                            fontSize: 14,
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--muted)' }}>
                            sync_alt
                          </span>
                          <span>Change Cook / Plan</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Main Content Split: Left 7 Cols (Representative Photo) + Right 5 Cols (Gemini Assembly Tips & Recommendations) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '7fr 5fr',
                      gap: 16,
                      flex: 1,
                      minHeight: 0,
                      paddingTop: 12,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    {/* Left 7 Cols: Rich Photo Presentation */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        minHeight: 0,
                        height: '100%',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          position: 'relative',
                          flex: 1,
                          borderRadius: 16,
                          overflow: 'hidden',
                          border: '1px solid var(--warm-border)',
                          background: 'var(--surface-tint)',
                          minHeight: 220,
                        }}
                      >
                        <img
                          src={unstructuredDetails.imageUrl}
                          alt={unstructuredDetails.imageAlt}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: 16,
                            display: 'block',
                          }}
                        />
                      </div>
                    </div>

                    {/* Right 5 Cols: Assembly Tips & Recommendations */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        overflow: 'hidden',
                        minHeight: 0,
                        height: '100%',
                      }}
                    >
                      <div
                        className="ceramic-card"
                        style={{
                          borderRadius: 16,
                          padding: 16,
                          border: '1px solid var(--border)',
                          background: 'var(--surface-tint)',
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          minHeight: 0,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingBottom: 10,
                            borderBottom: '1px solid var(--border)',
                            flexShrink: 0,
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--terracotta)' }}>
                              tips_and_updates
                            </span>
                            <h3
                              className="font-mono"
                              style={{
                                fontSize: 12,
                                fontWeight: 800,
                                color: 'var(--text)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.06em',
                              }}
                            >
                              {unstructuredDetails.sectionHeading}
                            </h3>
                          </div>
                        </div>

                        {/* 5 Gemini Recommendation Cards */}
                        <div
                          style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-around',
                            gap: 8,
                            paddingTop: 10,
                            overflow: 'hidden',
                          }}
                        >
                          {unstructuredDetails.tips.map((tip) => (
                            <div
                              key={tip.title}
                              style={{
                                padding: 10,
                                borderRadius: 12,
                                background: tip.isKidPick ? 'var(--warm-surface-alt)' : 'var(--surface)',
                                border: `1px solid ${tip.isKidPick ? 'var(--warm-border)' : 'var(--border)'}`,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 10,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                                <span
                                  className="material-symbols-outlined"
                                  style={{ fontSize: 18, color: tip.isKidPick ? 'var(--clay)' : 'var(--terracotta)' }}
                                >
                                  {tip.icon}
                                </span>
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontSize: 12,
                                      fontWeight: 700,
                                      color: 'var(--text)',
                                      whiteSpace: 'nowrap',
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                    }}
                                  >
                                    {tip.title}
                                  </div>
                                  <div
                                    className="font-mono"
                                    style={{
                                      fontSize: 10,
                                      color: tip.isKidPick ? 'var(--clay)' : 'var(--text-secondary)',
                                      fontWeight: tip.isKidPick ? 600 : 400,
                                    }}
                                  >
                                    {tip.detail}
                                  </div>
                                </div>
                              </div>
                              <span
                                className="font-mono"
                                style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  color: tip.isKidPick ? 'var(--warm-badge-text)' : 'var(--muted)',
                                  background: tip.isKidPick ? 'var(--warm-badge-bg)' : 'var(--surface-well)',
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  flexShrink: 0,
                                }}
                              >
                                {tip.tag}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                /* ── STATE C: UNDECIDED DINNER ("Nobody has claimed dinner tonight") ── */
                <>
                  {/* Top Decision Alert Banner */}
                  <div
                    style={{
                      borderRadius: 16,
                      padding: 22,
                      background: 'var(--warm-banner-bg)',
                      border: '2px solid var(--warm-border)',
                      boxShadow: '0 1px 2px rgba(40, 25, 15, 0.03)',
                      flexShrink: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 18,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    <div>
                      <h1
                        style={{
                          fontSize: 'clamp(1.6rem, 2.1vw, 1.875rem)',
                          fontWeight: 800,
                          color: 'var(--text)',
                          letterSpacing: '-0.025em',
                        }}
                      >
                        Nobody has claimed dinner tonight
                      </h1>
                      <p style={{ fontSize: '0.96rem', fontWeight: 500, color: 'var(--text-secondary)', paddingTop: 4 }}>
                        Select an option below to set the plan, or choose from ready-to-cook pantry ideas.
                      </p>
                    </div>

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 12,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setCaptureMealInput('');
                          setPendingChef('daniela');
                          showToast('Daniela is cooking — enter what is on the menu!');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '14px 16px',
                          borderRadius: 12,
                          background: 'var(--surface)',
                          color: 'var(--text)',
                          fontSize: '1.05rem',
                          fontWeight: 700,
                          border: '1px solid var(--warm-border-soft)',
                          boxShadow: '0 1px 2px rgba(40,25,15,0.03)',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 22 }}>🙋‍♀️</span>
                        <span>Daniela&apos;s cooking</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCaptureMealInput('');
                          setPendingChef('warren');
                          showToast('Warren is cooking — enter what is on the menu!');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '14px 16px',
                          borderRadius: 12,
                          background: 'var(--surface)',
                          color: 'var(--text)',
                          fontSize: '1.05rem',
                          fontWeight: 700,
                          border: '1px solid var(--warm-border-soft)',
                          boxShadow: '0 1px 2px rgba(40,25,15,0.03)',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 22 }}>👨‍🍳</span>
                        <span>Warren&apos;s cooking</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          showToast('Opening Takeout order options...');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '14px 16px',
                          borderRadius: 12,
                          background: 'var(--cobalt-surface)',
                          color: 'var(--cobalt)',
                          fontSize: '1.05rem',
                          fontWeight: 700,
                          border: '1px solid var(--cobalt-border)',
                          boxShadow: '0 1px 2px rgba(40,25,15,0.03)',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 22 }}>🥡</span>
                        <span>Takeout / Delivery</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          showToast('Night set to Leftovers & Fend for yourself');
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 10,
                          padding: '14px 16px',
                          borderRadius: 12,
                          background: 'var(--surface-well)',
                          color: 'var(--text-secondary)',
                          fontSize: '1.05rem',
                          fontWeight: 700,
                          border: '1px solid var(--border)',
                          boxShadow: '0 1px 2px rgba(40,25,15,0.03)',
                          cursor: 'pointer',
                        }}
                      >
                        <span style={{ fontSize: 22 }}>🥣</span>
                        <span>Leftovers / Fend</span>
                      </button>
                    </div>
                  </div>

                  {/* Main Content Split: Left 7 Cols (Fast Recipes) + Right 5 Cols (Gemini Voice & Delivery Re-Order) */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '7fr 5fr',
                      gap: 16,
                      flex: 1,
                      minHeight: 0,
                      paddingTop: 12,
                      position: 'relative',
                      zIndex: 1,
                    }}
                  >
                    {/* Left 7 Cols: Fast Recipes from Pantry & Fridge */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 10,
                        overflow: 'hidden',
                        minHeight: 0,
                        background: 'var(--surface-tint)',
                        padding: 18,
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingBottom: 8,
                          borderBottom: '1px solid var(--border)',
                          flexShrink: 0,
                        }}
                      >
                        <span
                          className="font-mono"
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            color: 'var(--text-secondary)',
                            letterSpacing: '0.06em',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--clay)' }}>
                            kitchen
                          </span>
                          FAST RECIPES FROM PANTRY &amp; FRIDGE
                        </span>
                      </div>

                      <div
                        style={{
                          flex: 1,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 10,
                          minHeight: 0,
                        }}
                      >
                        {/* Recipe Card 1 */}
                        <div
                          style={{
                            flex: 1,
                            padding: '14px 18px',
                            borderRadius: 12,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 16,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: '2px 10px',
                                  borderRadius: 999,
                                  color: 'var(--clay)',
                                  background: 'var(--warm-surface)',
                                  border: '1px solid var(--warm-border)',
                                }}
                              >
                                15 min
                              </span>
                            </div>
                            <h3 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 }}>
                              {state.backlog[0]?.recipe_or_item_name || 'Crispy Black Bean Tacos'}
                            </h3>
                            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                              {state.backlog[0]?.key_perishables.length
                                ? `Pantry ready • ${state.backlog[0].key_perishables.join(' & ')}`
                                : 'Pantry ready • Fresh cilantro & lime in crisper drawer'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              selectFastRecipe(
                                state.backlog[0]?.recipe_or_item_name || 'Crispy Black Bean Tacos',
                                state.backlog[0]?.id,
                              )
                            }
                            style={{
                              flexShrink: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '12px 18px',
                              borderRadius: 10,
                              background: '#ab2f0d',
                              color: '#ffffff',
                              fontSize: '0.95rem',
                              fontWeight: 700,
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <span>Cook Tonight</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                              arrow_forward
                            </span>
                          </button>
                        </div>

                        {/* Recipe Card 2 */}
                        <div
                          style={{
                            flex: 1,
                            padding: '14px 18px',
                            borderRadius: 12,
                            background: 'var(--warm-surface-alt)',
                            border: '1px solid var(--warm-border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 16,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: '2px 10px',
                                  borderRadius: 999,
                                  color: 'var(--emerald)',
                                  background: 'var(--emerald-surface)',
                                  border: '1px solid var(--emerald-border)',
                                }}
                              >
                                20 min
                              </span>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: '2px 10px',
                                  borderRadius: 999,
                                  color: 'var(--amber)',
                                  background: 'var(--warm-pill-bg)',
                                }}
                              >
                                Expires Soon
                              </span>
                            </div>
                            <h3 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 }}>
                              {state.backlog[1]?.recipe_or_item_name || 'Lemon Ricotta Orecchiette'}
                            </h3>
                            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                              {state.backlog[1]?.key_perishables.length
                                ? `Shift from Wed? ${state.backlog[1].key_perishables.join(' • ')}`
                                : 'Shift from Wed? Fresh ricotta expires tomorrow'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              selectFastRecipe(
                                state.backlog[1]?.recipe_or_item_name || 'Lemon Ricotta Orecchiette',
                                state.backlog[1]?.id,
                              )
                            }
                            style={{
                              flexShrink: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '12px 18px',
                              borderRadius: 10,
                              background: '#ab2f0d',
                              color: '#ffffff',
                              fontSize: '0.95rem',
                              fontWeight: 700,
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <span>Cook Tonight</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                              arrow_forward
                            </span>
                          </button>
                        </div>

                        {/* Recipe Card 3 */}
                        <div
                          style={{
                            flex: 1,
                            padding: '14px 18px',
                            borderRadius: 12,
                            background: 'var(--surface)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 16,
                          }}
                        >
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingBottom: 4 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 700,
                                  padding: '2px 10px',
                                  borderRadius: 999,
                                  color: 'var(--clay)',
                                  background: 'var(--warm-surface)',
                                  border: '1px solid var(--warm-border)',
                                }}
                              >
                                25 min
                              </span>
                            </div>
                            <h3 style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--text)', lineHeight: 1.25 }}>
                              {state.backlog[2]?.recipe_or_item_name || 'Sheet-Pan Harissa Chicken'}
                            </h3>
                            <p style={{ fontSize: '0.92rem', color: 'var(--text-secondary)', marginTop: 3 }}>
                              {state.backlog[2]?.key_perishables.length
                                ? state.backlog[2].key_perishables.join(' • ')
                                : 'Thawed chicken thighs • Bell peppers • Greek yogurt dip'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              selectFastRecipe(
                                state.backlog[2]?.recipe_or_item_name || 'Sheet-Pan Harissa Chicken',
                                state.backlog[2]?.id,
                              )
                            }
                            style={{
                              flexShrink: 0,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              padding: '12px 18px',
                              borderRadius: 10,
                              background: '#ab2f0d',
                              color: '#ffffff',
                              fontSize: '0.95rem',
                              fontWeight: 700,
                              border: 'none',
                              cursor: 'pointer',
                            }}
                          >
                            <span>Cook Tonight</span>
                            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                              arrow_forward
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Right 5 Cols: Ask Gemini Voice + Delivery Re-Order */}
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        gap: 12,
                        minHeight: 0,
                      }}
                    >
                      {/* Ask Gemini Voice Card */}
                      <div
                        style={{
                          padding: 16,
                          borderRadius: 12,
                          background: 'var(--cobalt-voice-bg)',
                          border: '1px solid var(--cobalt-border)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 12,
                          flexShrink: 0,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--cobalt)' }}>
                            auto_awesome
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              color: 'var(--cobalt)',
                              letterSpacing: '0.06em',
                            }}
                          >
                            Ask Gemini Voice
                          </span>
                        </div>

                        <p
                          style={{
                            fontSize: '1.05rem',
                            fontWeight: 500,
                            lineHeight: 1.5,
                            color: 'var(--text)',
                            background: 'var(--cobalt-quote-bg)',
                            padding: '14px 16px',
                            borderRadius: 8,
                            border: '1px solid var(--cobalt-border)',
                          }}
                        >
                          &ldquo;Suggest a 20-min dinner using wild salmon and jasmine rice&rdquo;
                        </p>

                        <button
                          type="button"
                          onClick={() => {
                            setGeminiCustomQuery('Suggest a 20-min dinner using wild salmon and jasmine rice');
                            openGeminiOverlay();
                            showToast('Gemini listening... Ask your dinner question!');
                          }}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 8,
                            padding: '12px 16px',
                            borderRadius: 8,
                            background: '#2b59ff',
                            color: '#ffffff',
                            fontSize: '1.05rem',
                            fontWeight: 700,
                            border: 'none',
                            cursor: 'pointer',
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                            graphic_eq
                          </span>
                          <span>Tap to Ask Gemini</span>
                        </button>
                      </div>

                      {/* Delivery Re-Order Card */}
                      <div
                        style={{
                          padding: 16,
                          borderRadius: 12,
                          background: 'var(--surface-tint)',
                          border: '1px solid var(--border)',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          gap: 10,
                          flex: 1,
                          minHeight: 0,
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            paddingBottom: 8,
                            borderBottom: '1px solid var(--border)',
                            flexShrink: 0,
                          }}
                        >
                          <span
                            className="font-mono"
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              color: 'var(--text-secondary)',
                              letterSpacing: '0.06em',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--cobalt)' }}>
                              local_mall
                            </span>
                            DELIVERY RE-ORDER
                          </span>
                        </div>

                        <div
                          style={{
                            flex: 1,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            gap: 8,
                            minHeight: 0,
                          }}
                        >
                          {[
                            { name: 'Sweetgreen', sub: 'Harvest Bowls', eta: '22 min' },
                            { name: 'Thai Basil', sub: 'Pad See Ew & Curry', eta: '28 min' },
                            { name: 'Pizzeria Delfina', sub: 'Margherita & Kale', eta: '35 min' },
                          ].map((spot) => (
                            <button
                              key={spot.name}
                              type="button"
                              onClick={() => {
                                showToast(`Ordering ${spot.name} (${spot.sub})...`);
                              }}
                              style={{
                                flex: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                padding: '10px 16px',
                                borderRadius: 8,
                                background: 'var(--surface)',
                                border: '1px solid var(--border)',
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text)' }}>
                                  {spot.name}
                                </span>
                                <span style={{ fontSize: '0.92rem', fontWeight: 500, color: 'var(--muted)', marginTop: 2 }}>
                                  {spot.sub}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: '0.92rem',
                                  fontWeight: 700,
                                  padding: '6px 12px',
                                  borderRadius: 8,
                                  background: 'var(--cobalt-eta-bg)',
                                  color: 'var(--cobalt-eta-text)',
                                  flexShrink: 0,
                                }}
                              >
                                {spot.eta}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </section>

            {/* RIGHT RAIL (~21% width, w-56): Compressed Bento Navigation Rail */}
            <aside
              id="ultraSlimRightRail"
              style={{
                width: 224,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                minHeight: 0,
              }}
            >
              {/* Bento Card 1: UPCOMING */}
              <button
                type="button"
                onClick={() => showToast('Opening Upcoming Dinners schedule')}
                className="ceramic-card"
                style={{
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  flex: 1,
                  border: '1px solid var(--warm-border-soft)',
                  background: 'var(--warm-bento-bg)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'var(--warm-badge-bg)',
                        border: '1px solid var(--warm-border)',
                        color: 'var(--clay)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        calendar_month
                      </span>
                    </div>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: 'var(--warm-badge-text)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Upcoming
                    </span>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--clay)' }}>
                    arrow_forward
                  </span>
                </div>

                <div style={{ padding: '8px 0', minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: 800,
                      color: 'var(--text)',
                      letterSpacing: '-0.02em',
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    Wed: Warren Cooking
                  </div>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      paddingTop: 4,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {state.backlog[0]?.recipe_or_item_name || 'Lemon Ricotta Orecchiette'}
                  </div>
                </div>

                <div
                  className="font-mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    borderTop: '1px solid var(--warm-divider)',
                    width: '100%',
                    fontSize: 10,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: 'var(--warm-badge-text)',
                      background: 'var(--warm-badge-bg)',
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    3 SCHEDULED
                  </span>
                  <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Oct 25–27</span>
                </div>
              </button>

              {/* Bento Card 2: TAKEOUT */}
              <button
                type="button"
                onClick={() => showToast('Opening Takeout & Backups drawer')}
                className="ceramic-card"
                style={{
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  flex: 1,
                  border: '1px solid var(--cobalt-border)',
                  background: 'var(--cobalt-bento-bg)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'var(--cobalt-surface)',
                        border: '1px solid var(--cobalt-border)',
                        color: 'var(--cobalt)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        takeout_dining
                      </span>
                    </div>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: 'var(--cobalt)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Takeout
                    </span>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--cobalt)' }}>
                    arrow_forward
                  </span>
                </div>

                <div style={{ padding: '8px 0', minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: 800,
                      color: 'var(--text)',
                      letterSpacing: '-0.02em',
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    3 Go-To Spots
                  </div>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      color: 'var(--text-secondary)',
                      paddingTop: 4,
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    18–30m avg delivery
                  </div>
                </div>

                <div
                  className="font-mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    borderTop: '1px solid var(--cobalt-border)',
                    width: '100%',
                    fontSize: 10,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: 'var(--cobalt)',
                      background: 'var(--cobalt-surface)',
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    FAVORITES READY
                  </span>
                  <span style={{ color: 'var(--muted)', fontWeight: 600 }}>~18–30m</span>
                </div>
              </button>

              {/* Bento Card 3: MEAL PLAN */}
              <button
                type="button"
                onClick={() => showToast('Opening Meal Planner & Assignment')}
                className="ceramic-card"
                style={{
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  flex: 1,
                  border: '1px solid var(--emerald-border)',
                  background: 'var(--emerald-bento-bg)',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: 'var(--emerald-surface)',
                        border: '1px solid var(--emerald-border)',
                        color: 'var(--emerald)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                        edit_calendar
                      </span>
                    </div>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 14,
                        fontWeight: 800,
                        color: 'var(--emerald)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Meal Plan
                    </span>
                  </div>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--emerald)' }}>
                    arrow_forward
                  </span>
                </div>

                <div style={{ padding: '8px 0', minWidth: 0 }}>
                  {d.status !== 'unclaimed' ? (
                    <>
                      <div
                        className="font-mono"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          borderRadius: 8,
                          background: 'var(--emerald-surface)',
                          border: '1px solid var(--emerald-border)',
                          color: 'var(--emerald)',
                          fontSize: 13,
                          fontWeight: 800,
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--emerald)' }}>
                          check_circle
                        </span>
                        Tonight Claimed
                      </div>
                      <div
                        className="font-mono"
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          paddingTop: 6,
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {claimedChefName}:{' '}
                        {d.recipe_name || (isStructuredRecipeView ? 'Crispy Miso Salmon Rice Bowls' : 'Charcuterie Board')}
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        className="font-mono"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '4px 10px',
                          borderRadius: 8,
                          background: 'var(--danger-surface)',
                          border: '1px solid var(--danger-border)',
                          color: 'var(--clay)',
                          fontSize: 13,
                          fontWeight: 800,
                        }}
                      >
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: 'var(--clay)',
                          }}
                        />
                        1 Night Unclaimed
                      </div>
                      <div
                        className="font-mono"
                        style={{
                          fontSize: 12,
                          color: 'var(--text-secondary)',
                          paddingTop: 6,
                          fontWeight: 500,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        6 of 7 days planned
                      </div>
                    </>
                  )}
                </div>

                <div
                  className="font-mono"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 8,
                    borderTop: '1px solid var(--emerald-border)',
                    width: '100%',
                    fontSize: 10,
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      color: 'var(--emerald)',
                      background: 'var(--emerald-surface)',
                      padding: '2px 8px',
                      borderRadius: 999,
                    }}
                  >
                    {d.status !== 'unclaimed' ? '7/7 DAYS' : '6/7 DAYS'}
                  </span>
                  <span
                    style={{
                      fontWeight: 700,
                      color: d.status !== 'unclaimed' ? 'var(--emerald)' : 'var(--warm-badge-text)',
                      background: d.status !== 'unclaimed' ? 'var(--emerald-surface)' : 'var(--warm-badge-bg)',
                      padding: '2px 8px',
                      borderRadius: 999,
                      textTransform: 'uppercase',
                    }}
                  >
                    {d.status !== 'unclaimed' ? 'ALL SET' : '1 NEEDED'}
                  </span>
                </div>
              </button>
            </aside>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            VIEW 3: BENTO OVERVIEW & EXPANDED TIMELINE (Stitch Screens 3 & 4)
            ════════════════════════════════════════════════════════════════════ */}
        {(mode === 'bento' || mode === 'timeline') && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: mode === 'timeline' ? '78fr 22fr' : '7fr 5fr',
              gap: 18,
              overflow: 'hidden',
              transition: 'grid-template-columns 0.3s ease',
            }}
          >
            {/* LEFT COLUMN: Schedule/Logistics + Tonight's Hearth Dinner + Fridge Backlog */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, overflow: 'hidden' }}>
              {/* Card 1: Master Family Timeline / Today's Logistics */}
              <section
                className="ceramic-card"
                style={{
                  padding: '18px 22px',
                  flex: 1,
                  minHeight: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingBottom: 11,
                    borderBottom: '1px solid var(--border-subtle)',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h2 style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
                      Schedule • {fmtDay(eventDate)}
                    </h2>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        padding: '3px 10px',
                        borderRadius: 999,
                        background: state.conflicts.length ? 'var(--warn-surface)' : 'var(--emerald-surface)',
                        border: `1px solid ${state.conflicts.length ? 'var(--warn-border)' : 'var(--emerald-border)'}`,
                        color: state.conflicts.length ? 'var(--warn-text)' : 'var(--emerald)',
                      }}
                    >
                      ● {state.conflicts.length ? `${state.conflicts.length} Needs Owner` : 'On Track'}
                    </span>
                  </div>

                  {/* Member & School Logistics Filter Pills (All / School / Daniela / Warren / Wesley / Lachlan) */}
                  <div
                    className="ceramic-well font-mono"
                    style={{ display: 'flex', gap: 4, padding: 4, borderRadius: 12, fontSize: '0.86rem', flexWrap: 'wrap' }}
                  >
                    {(
                      [
                        ['all', 'All'],
                        ['school', '🎒 School'],
                        ['daniela', 'Daniela'],
                        ['warren', 'Warren'],
                        ['wesley', 'Wesley'],
                        ['lachlan', 'Lachlan'],
                      ] as [MemberFilter, string][]
                    ).map(([f, label]) => (
                      <button
                        key={f}
                        onClick={() => setMemberFilter(f)}
                        style={{
                          padding: '8px 14px',
                          borderRadius: 10,
                          border: 'none',
                          cursor: 'pointer',
                          background: memberFilter === f ? 'var(--surface)' : 'transparent',
                          color: memberFilter === f ? 'var(--text)' : 'var(--muted)',
                          fontWeight: memberFilter === f ? 700 : 500,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Event Rows */}
                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    overflowY: 'auto',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    padding: '12px 0 4px',
                  }}
                >
                  {filteredEvents.length === 0 && (
                    <div
                      className="ceramic-well"
                      style={{
                        padding: '18px 20px',
                        color: 'var(--muted)',
                        fontSize: '0.96rem',
                        textAlign: 'center',
                        margin: 'auto 0',
                      }}
                    >
                      No calendar events match this filter.
                    </div>
                  )}
                  {filteredEvents.map((ev) => {
                    const claimable = isClaimableLogistics(ev);
                    const needsOwner = claimable && ev.assigned_parent === 'unassigned';
                    const isLate = ev.logistics_type === 'late_office';
                    const timeStr = isAllDay(ev.start_time, ev.end_time) ? 'ALL DAY' : fmtEventTime(ev.start_time, eventDate);
                    return (
                      <div
                        key={ev.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 16,
                          padding: '13px 16px',
                          borderRadius: 16,
                          background: needsOwner ? 'var(--warm-surface)' : isLate ? 'var(--danger-surface)' : 'var(--surface-tint)',
                          border: `1.5px solid ${needsOwner ? 'var(--warm-border)' : isLate ? 'var(--terracotta)' : 'var(--border)'}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                          <div style={{ width: 112, flexShrink: 0 }}>
                            <div
                              className="font-mono"
                              style={{
                                fontSize: '0.98rem',
                                fontWeight: 800,
                                color: needsOwner ? 'var(--warn-text)' : isLate ? 'var(--clay)' : 'var(--text)',
                              }}
                            >
                              {timeStr}
                            </div>
                          </div>

                          <div
                            style={{
                              width: 3,
                              height: 30,
                              borderRadius: 99,
                              background: needsOwner ? 'var(--amber)' : isLate ? 'var(--terracotta)' : 'var(--sage)',
                              flexShrink: 0,
                            }}
                          />

                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '1.08rem', fontWeight: 700, lineHeight: 1.25 }}>{ev.title}</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                              {SOURCE_LABEL[ev.source_calendar]}
                            </div>
                          </div>
                        </div>

                        {/* Claim / Assign Pickup Buttons — reserved ONLY for Family Calendar items (like school dropoffs/pickups) */}
                        {claimable && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            {PARENTS.map((p) => (
                              <button
                                key={p}
                                className={`hw-btn ${ev.assigned_parent === p ? 'terracotta' : ''}`}
                                style={{ padding: '9px 15px', fontSize: '0.85rem' }}
                                onClick={() => {
                                  const nextParent = ev.assigned_parent === p ? 'unassigned' : p;
                                  act({
                                    type: 'assign_logistics',
                                    id: ev.id,
                                    parent: nextParent,
                                  });
                                  showToast(
                                    nextParent === 'unassigned'
                                      ? `Unclaimed ${ev.title} — updated Family Calendar description`
                                      : `${NAMES[nextParent]} claimed ${ev.title} — added to Family Calendar event description`,
                                  );
                                }}
                              >
                                {ev.assigned_parent === p ? `✓ ${NAMES[p]}` : NAMES[p]}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Card 2: Tonight's Hearth Dinner + Fridge Backlog Bar (In Bento Mode) */}
              {mode === 'bento' && (
                <section
                  className="ceramic-card"
                  style={{
                    padding: '16px 20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 11,
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          background: 'var(--warm-surface)',
                          border: '1px solid var(--warm-border-soft)',
                          color: 'var(--terracotta)',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <span className="material-symbols-outlined">soup_kitchen</span>
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            className="font-mono"
                            style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--clay)', letterSpacing: '0.06em' }}
                          >
                            TONIGHT&apos;S DINNER
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: d.status === 'unclaimed' ? 'var(--warn-surface)' : 'var(--emerald-surface)',
                              color: d.status === 'unclaimed' ? 'var(--warn-text)' : 'var(--emerald)',
                            }}
                          >
                            {d.status === 'unclaimed'
                              ? 'UNCLAIMED'
                              : d.chef === 'takeout'
                                ? 'TAKEOUT'
                                : isParent(d.chef)
                                  ? `${NAMES[d.chef].toUpperCase()} COOKING`
                                  : 'PLANNED'}
                          </span>
                        </div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, marginTop: 2 }}>
                          {d.recipe_name || (d.status === 'unclaimed' ? 'Who is cooking tonight?' : `${isParent(d.chef) ? NAMES[d.chef] : 'Dinner'} tonight`)}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        className={`hw-btn ${d.chef === 'daniela' ? 'terracotta' : ''}`}
                        onClick={() => act({ type: 'claim_dinner', chef: 'daniela' })}
                      >
                        Daniela
                      </button>
                      <button
                        className={`hw-btn ${d.chef === 'warren' ? 'terracotta' : ''}`}
                        onClick={() => act({ type: 'claim_dinner', chef: 'warren' })}
                      >
                        Warren
                      </button>
                      <button
                        className={`hw-btn ${d.chef === 'takeout' ? 'terracotta' : ''}`}
                        onClick={() => act({ type: 'claim_dinner', chef: 'takeout' })}
                      >
                        Takeout
                      </button>
                      {d.status === 'planned' && (
                        <button className="hw-btn emerald" onClick={() => act({ type: 'dinner_cooked' })}>
                          ✓ Cooked
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Fridge Backlog Pills + Saturday Order Gate */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      paddingTop: 9,
                      borderTop: '1px solid var(--border-subtle)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--muted)' }}>
                        FRIDGE BACKLOG ({state.backlog.length}):
                      </span>
                      {state.backlog.map((b) => {
                        const age = daysBetween(b.delivery_date, state.date);
                        return (
                          <div
                            key={b.id}
                            className="ceramic-well"
                            style={{
                              padding: '4px 10px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 8,
                              fontSize: '0.76rem',
                            }}
                          >
                            <span style={{ fontWeight: 700 }}>{b.recipe_or_item_name}</span>
                            <span className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>
                              {age <= 0 ? 'today' : `${age}d`}
                            </span>
                            <button
                              onClick={() => act({ type: 'cook_from_backlog', backlogId: b.id })}
                              style={{
                                border: 'none',
                                background: 'var(--terracotta)',
                                color: '#fff',
                                borderRadius: 6,
                                padding: '2px 7px',
                                fontSize: '0.64rem',
                                fontWeight: 700,
                                cursor: 'pointer',
                              }}
                            >
                              Cook
                            </button>
                            <button
                              onClick={() => act({ type: 'backlog_status', id: b.id, status: 'cooked' })}
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: 'var(--emerald)',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                cursor: 'pointer',
                              }}
                              title="Mark cooked"
                            >
                              ✓
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {pendingOrders[0] && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--clay)' }}>
                          SAT CART ({pendingOrders[0].kept_recipes.length} meals):
                        </span>
                        <button
                          className="hw-btn emerald"
                          style={{ padding: '4px 10px', fontSize: '0.68rem' }}
                          onClick={() => decideOrder(pendingOrders[0].id, true)}
                        >
                          👍 Approve
                        </button>
                        <button
                          className="hw-btn"
                          style={{ padding: '4px 10px', fontSize: '0.68rem' }}
                          onClick={() => decideOrder(pendingOrders[0].id, false)}
                        >
                          ✋ Hold
                        </button>
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>

            {/* RIGHT COLUMN: Full Wesley's Chores + Pantry Staging (or Slim Right Rail when Timeline is Expanded) */}
            {mode === 'bento' ? (
              <div
                className="ceramic-card"
                style={{
                  padding: '18px 22px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: 0,
                  overflow: 'hidden',
                }}
              >
                <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  {/* Wesley's Chores Header */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingBottom: 12,
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        className="ceramic-well"
                        style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', color: 'var(--cobalt)' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                          task_alt
                        </span>
                      </div>
                      <h2 style={{ fontSize: '1.22rem', fontWeight: 800 }}>Wesley&apos;s Chores</h2>
                    </div>
                    <button
                      type="button"
                      className="ceramic-well font-mono"
                      onClick={() => launchGreenlightOnCozyla()}
                      title="Open Greenlight App"
                      style={{
                        padding: '6px 14px',
                        borderRadius: 999,
                        fontSize: '0.8rem',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        cursor: 'pointer',
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--cobalt)' }}>
                        credit_card
                      </span>
                      Greenlight
                    </button>
                  </div>

                  {/* Kid-Friendly Chore Progress Bar */}
                  <div
                    className="ceramic-well"
                    style={{ margin: '12px 0', padding: '14px 16px', borderRadius: 18 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: '1.08rem', fontWeight: 800 }}>
                        {doneChores} of {state.chores.length} Done
                      </span>
                      <span className="font-mono" style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--emerald)' }}>
                        +${allowanceEarned}
                      </span>
                    </div>

                    <div
                      style={{
                        width: '100%',
                        height: 14,
                        borderRadius: 999,
                        background: 'var(--border)',
                        overflow: 'hidden',
                        marginTop: 10,
                      }}
                    >
                      <div
                        style={{
                          width: `${chorePct}%`,
                          height: '100%',
                          borderRadius: 999,
                          background: 'linear-gradient(90deg, var(--amber), var(--sage))',
                          transition: 'width 0.35s ease',
                        }}
                      />
                    </div>
                  </div>

                  {/* Chore Checklist Rows */}
                  <div
                    style={{
                      flex: 1,
                      minHeight: 0,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-evenly',
                      gap: 10,
                    }}
                  >
                    {state.chores.length === 0 && (
                      <div
                        className="ceramic-well"
                        style={{
                          padding: '18px 20px',
                          color: 'var(--muted)',
                          fontSize: '0.96rem',
                          textAlign: 'center',
                          margin: 'auto 0',
                        }}
                      >
                        No chores scheduled yet.
                      </div>
                    )}
                    {state.chores.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => act({ type: 'toggle_chore', id: c.id, completed: !c.completed })}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '16px 18px',
                          borderRadius: 18,
                          background: c.completed ? 'var(--surface-tint)' : 'var(--surface)',
                          border: `1.5px solid ${c.completed ? 'var(--border)' : 'var(--cobalt-border)'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <div
                            style={{
                              width: 42,
                              height: 42,
                              borderRadius: 12,
                              background: c.completed ? 'var(--emerald-surface)' : 'var(--cobalt-surface-soft)',
                              border: `1.5px solid ${c.completed ? 'var(--emerald-border)' : 'var(--cobalt-border)'}`,
                              color: c.completed ? 'var(--emerald)' : 'var(--cobalt)',
                              display: 'grid',
                              placeItems: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>
                              {c.completed ? 'check' : 'check_box_outline_blank'}
                            </span>
                          </div>
                          <div
                            style={{
                              fontSize: '1.12rem',
                              fontWeight: 700,
                              textDecoration: c.completed ? 'line-through' : 'none',
                              color: c.completed ? 'var(--text-secondary)' : 'var(--text)',
                            }}
                          >
                            {c.emoji ? `${c.emoji} ` : ''}
                            {c.chore_title}
                          </div>
                        </div>

                        {(c.reward_cents ?? 0) > 0 && (
                          <span
                            className="font-mono"
                            style={{
                              padding: '4px 10px',
                              borderRadius: 8,
                              background: 'var(--emerald-surface)',
                              color: 'var(--emerald)',
                              fontSize: '0.88rem',
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            +${((c.reward_cents ?? 0) / 100).toFixed(2)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pantry & Grocery Cart Staging Footer */}
                <div style={{ paddingTop: 12, marginTop: 12, borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--muted)' }}>
                        local_shipping
                      </span>
                      Pantry Cart Staging ({state.groceries.length})
                    </span>
                  </div>

                  <form
                    style={{ display: 'flex', gap: 8 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newGrocery.trim()) return;
                      act({ type: 'add_grocery', name: newGrocery });
                      setNewGrocery('');
                    }}
                  >
                    <input
                      className="ceramic-well"
                      style={{ flex: 1, padding: '11px 16px', fontSize: '0.94rem' }}
                      placeholder={
                        state.groceries.length
                          ? `In cart: ${state.groceries.map((g) => g.name).join(', ')} — add more…`
                          : 'Add item to Saturday grocery cart…'
                      }
                      value={newGrocery}
                      onChange={(e) => setNewGrocery(e.target.value)}
                    />
                    <button className="hw-btn" type="submit" style={{ padding: '11px 18px', fontSize: '0.86rem' }}>
                      + ADD
                    </button>
                  </form>
                </div>
              </div>
            ) : (
              /* SLIM GLANCEABLE RIGHT RAIL (Stitch Screen 3 — when Timeline is Expanded) */
              <aside style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0 }}>
                {/* Bento 1: Tonight's Dinner */}
                <div
                  className="ceramic-card"
                  style={{
                    padding: 14,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    background: 'var(--warm-bento-bg)',
                    borderColor: 'var(--warm-border-soft)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--clay)' }}>
                      🍲 TONIGHT&apos;S DINNER
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.64rem',
                        fontWeight: 700,
                        background: 'var(--warn-surface)',
                        border: '1px solid var(--warn-border)',
                        color: 'var(--amber)',
                        padding: '2px 6px',
                        borderRadius: 6,
                      }}
                    >
                      6:30 PM
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text)' }}>
                      {d.recipe_name || (d.status === 'unclaimed' ? 'Unclaimed' : `${isParent(d.chef) ? NAMES[d.chef] : 'Planned'} Cooking`)}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {state.backlog.length} kits in fridge backlog
                    </div>
                  </div>
                  <button className="hw-btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setMode('dinner')}>
                    <span>EXPAND DINNER</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      chevron_left
                    </span>
                  </button>
                </div>

                {/* Bento 2: Wesley's Chores */}
                <div
                  className="ceramic-card"
                  style={{
                    padding: 14,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--cobalt)' }}>
                      ✓ WESLEY&apos;S CHORES
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.64rem', fontWeight: 700, background: 'var(--emerald-surface)', color: 'var(--emerald)', padding: '2px 6px', borderRadius: 6 }}
                    >
                      {chorePct}% Done
                    </span>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <span className="font-mono" style={{ fontSize: '0.64rem', color: 'var(--muted)' }}>
                        EARNED / ALLOWANCE
                      </span>
                      <span className="font-mono" style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                        ${allowanceEarned}
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 99, background: 'var(--border)', overflow: 'hidden', margin: '6px 0' }}>
                      <div style={{ width: `${chorePct}%`, height: '100%', background: 'var(--cobalt)' }} />
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--emerald)', fontWeight: 700 }}>
                      {doneChores} of {state.chores.length} Completed
                    </div>
                  </div>
                  <button className="hw-btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setMode('bento')}>
                    <span>EXPAND CHORES</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      chevron_left
                    </span>
                  </button>
                </div>

                {/* Bento 3: Pantry & Groceries */}
                <div
                  className="ceramic-card"
                  style={{
                    padding: 14,
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--emerald)' }}>
                      🛍️ PANTRY &amp; GROCERIES
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.62rem', fontWeight: 700, background: 'var(--danger-surface)', color: 'var(--danger-text)', padding: '2px 6px', borderRadius: 6 }}
                    >
                      SAT GATE
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.88rem', fontWeight: 800 }}>
                      {state.groceries.length} household items + {state.backlog.length} kits
                    </div>
                    <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--clay)', marginTop: 3 }}>
                      {pendingOrders.length ? 'Saturday proposal awaiting approval' : 'Fridge backlog synced'}
                    </div>
                  </div>
                  <button className="hw-btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setMode('bento')}>
                    <span>EXPAND PANTRY</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 15 }}>
                      chevron_left
                    </span>
                  </button>
                </div>
              </aside>
            )}
          </div>
        )}

        {/* ── Bottom Hardware Navigation Dock (Stationary tabs across all modes + 48px utility controls) ── */}
        <footer
          className="hearth-dock"
          style={
            mode === 'ambient'
              ? {
                  borderTop: '1px solid var(--border-subtle)',
                  paddingTop: 18,
                  marginTop: 18,
                }
              : undefined
          }
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {betaUrl && (
              <a className="dock-tab" href={betaUrl} referrerPolicy="no-referrer" rel="noreferrer" style={{ minHeight: 56 }}>
                <span className="material-symbols-outlined" aria-hidden="true">science</span>
                <span>Beta</span>
              </a>
            )}
            <button
              className={`dock-tab ${mode === 'ambient' ? 'active' : ''}`}
              onClick={() => setMode('ambient')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: mode === 'ambient' ? '#fff' : 'var(--terracotta)' }}>
                home
              </span>
              <span>Ambient</span>
            </button>

            <button
              className={`dock-tab ${mode === 'dinner' ? 'active' : ''}`}
              onClick={() => setMode('dinner')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: mode === 'dinner' ? '#fff' : 'var(--terracotta)' }}>
                restaurant
              </span>
              <span>Dinner Hub</span>
            </button>

            <button
              className={`dock-tab ${mode === 'bento' || mode === 'timeline' ? 'active' : ''}`}
              onClick={() => setMode('bento')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: mode === 'bento' || mode === 'timeline' ? '#fff' : 'var(--cobalt)' }}>
                checklist
              </span>
              <span>Chores &amp; Schedule ({doneChores}/{state.chores.length})</span>
            </button>

            <button
              className="dock-tab"
              onClick={() => openGeminiOverlay()}
              title="Engage Gemini Voice"
            >
              <GeminiSparkIcon size={18} />
              <span>Gemini</span>
            </button>

            <button
              className="dock-tab"
              onClick={nprPlaying ? stopNpr : playNpr}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--terracotta)' }}>
                radio
              </span>
              <span>{nprPlaying ? 'Stop NPR' : 'NPR Live'}</span>
            </button>

            <button
              className="dock-tab"
              onClick={() => actSpotify(spotify.playing ? 'pause' : 'play')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20, color: 'var(--cobalt)' }}>
                graphic_eq
              </span>
              <span>
                {spotify.playing ? `Spotify: ${spotify.track?.slice(0, 16) || 'Playing'}` : 'Spotify'}
              </span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle defaultTheme="light" />
            <a
              href="/guide"
              className="hw-btn"
              title="Kitchen Guide & Manual"
              aria-label="Kitchen Guide & Manual"
              style={{
                width: 48,
                height: 48,
                padding: 0,
                borderRadius: 14,
                color: 'var(--text-secondary)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                help
              </span>
            </a>
            <button
              type="button"
              className="hw-btn"
              title="Sleep Display"
              aria-label="Sleep Display"
              onClick={() => {
                try {
                  window.fully?.turnScreenOff?.(true);
                } catch {}
              }}
              style={{
                width: 48,
                height: 48,
                padding: 0,
                borderRadius: 14,
                color: 'var(--text-secondary)',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                power_settings_new
              </span>
            </button>
          </div>
        </footer>

        {/* ════════════════════════════════════════════════════════════════════
            STITCH "GEMINI VOICE" OVERLAY WHEN ENGAGED
            ════════════════════════════════════════════════════════════════════ */}
        {geminiOpen && (
          <div className="gemini-voice-overlay-backdrop" onClick={() => setGeminiOpen(false)}>
            <div className="gemini-voice-card" onClick={(e) => e.stopPropagation()}>
              {/* Top Row: Rounded-Square Gradient Spark Badge + "Gemini Voice" + 7-Bar Equalizer Pill */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div className="gemini-badge-square">
                    <GeminiSparkIcon size={24} white />
                  </div>
                  <span style={{ fontSize: '1.42rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
                    Gemini Voice
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <GeminiEqualizerPill active={geminiListening} />
                  <button
                    className="hw-btn pill"
                    onClick={() => setGeminiOpen(false)}
                    style={{ padding: '7px 12px' }}
                    title="Close overlay"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      close
                    </span>
                  </button>
                </div>
              </div>

              {/* Card 1: Cooktop Utterance Well */}
              <div className="gemini-utterance-well">
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#1549d6',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: '0.95rem',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  D
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="font-mono"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                    }}
                  >
                    <span style={{ color: 'var(--cobalt)' }}>AT COOKTOP</span>
                    {geminiStampedAt && (
                      <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{geminiStampedAt}</span>
                    )}
                  </div>

                  <div style={{ fontSize: '1.16rem', lineHeight: 1.5, marginTop: 5, fontWeight: 500 }}>
                    {geminiCustomQuery ? (
                      <>&ldquo;{geminiCustomQuery}&rdquo;</>
                    ) : (
                      <span style={{ color: 'var(--muted)' }}>
                        Tap <strong>Ask by Voice</strong> or type below to speak with Gemini at the cooktop…
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Card 2: GEMINI RESPONSE Well (Live Kitchen Context Summary) */}
              <div className="gemini-utterance-well" style={{ padding: '20px 22px' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: '#c23d1b',
                    color: '#ffffff',
                    display: 'grid',
                    placeItems: 'center',
                    flexShrink: 0,
                    marginTop: 2,
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 19 }}>
                    reviews
                  </span>
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="font-mono"
                    style={{
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      letterSpacing: '0.06em',
                      color: 'var(--clay)',
                    }}
                  >
                    GEMINI RESPONSE
                  </div>

                  <div style={{ fontSize: '1.14rem', lineHeight: 1.62, marginTop: 6 }}>
                    {geminiCustomQuery ? (
                      <>
                        Ready to send <span className="gemini-hl-terracotta">{geminiCustomQuery}</span> with live
                        kitchen context ({' '}
                        <span className="gemini-hl-cobalt">
                          {d.recipe_name || `${state.backlog.length} backlog items`}
                        </span>
                        ). Tap <strong>Open Gemini App</strong> to continue in Gemini Live.
                      </>
                    ) : (
                      <>
                        Connected to live kitchen state:{' '}
                        <span className="gemini-hl-terracotta">
                          {d.recipe_name
                            ? `Tonight: ${d.recipe_name}`
                            : `${state.backlog.length} meals in fridge backlog`}
                        </span>{' '}
                        and{' '}
                        <span className="gemini-hl-cobalt">
                          {activeTimer
                            ? `${timerMM}:${timerSS} remaining on ${activeTimer.label}`
                            : `${state.events.length} schedule items today`}
                        </span>
                        .
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Prompt Input + Voice & Native Gemini Launch Controls */}
              <form
                style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
                onSubmit={(e) => {
                  e.preventDefault();
                  if (geminiCustomQuery && applyVoiceCommandIfTimer(geminiCustomQuery)) {
                    setGeminiOpen(false);
                    return;
                  }
                  launchGeminiOnCozyla(geminiCustomQuery || undefined);
                }}
              >
                <input
                  className="ceramic-well"
                  style={{ flex: 1, minWidth: 220, padding: '9px 14px', fontSize: '0.88rem' }}
                  placeholder="Type or dictate a question for Gemini…"
                  value={geminiCustomQuery}
                  onChange={(e) => setGeminiCustomQuery(e.target.value)}
                />
                <button type="button" className="hw-btn" onClick={startGeminiDictation}>
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--cobalt)' }}>
                    mic
                  </span>
                  <span>{geminiListening ? 'LISTENING…' : 'ASK BY VOICE'}</span>
                </button>
                <button type="submit" className="hw-btn terracotta">
                  <GeminiSparkIcon size={15} white />
                  <span>OPEN GEMINI APP</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Notification Banner Toast */}
        {toastMsg && (
          <div
            id="toast"
            className="font-mono"
            style={{
              position: 'fixed',
              bottom: 96,
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '10px 20px',
              borderRadius: 9999,
              background: '#1b1c1a',
              border: '1px solid var(--border)',
              color: '#ffffff',
              fontSize: 12,
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.35)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              pointerEvents: 'none',
              zIndex: 50,
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17, color: '#8ef7c2' }}>
              check_circle
            </span>
            <span>{toastMsg}</span>
          </div>
        )}
      </main>
    </div>
  );
}
