'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';
import { NAMES, PARENTS, SOURCE_LABEL, isParent } from '@/lib/family';
import { daysBetween, fmtDay, fmtShortDate, fmtTime, isAllDay } from '@/lib/time';
import {
  isFullyKiosk,
  launchGeminiOnCozyla,
  speakOnCozyla,
  useCozylaKiosk,
  wakeCozylaScreen,
  wakeSpotifyOnCozyla,
} from '@/lib/cozyla';
import type { BacklogLocation, KioskAction, KitchenState } from '@/lib/types';
import type { Weather } from '@/lib/weather';
import type { SpotifyNowPlaying } from '@/lib/spotify';
import { ThemeToggle } from './ThemeToggle';

interface Timer {
  id: string;
  label: string;
  initialSecs: number;
  endsAt: number;
  pausedRemaining?: number;
}

type ViewMode = 'ambient' | 'bento' | 'timeline';
type MemberFilter = 'all' | 'daniela' | 'warren' | 'wesley';

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
            a.chef === 'takeout'
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
        events: cur.events.map((e) => (e.id === a.id ? { ...e, assigned_parent: a.parent } : e)),
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

export function KioskBoard({ initial, initialWeather }: { initial: KitchenState; initialWeather: Weather | null }) {
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
  const nprRef = useRef<HTMLAudioElement | null>(null);
  const firedTimers = useRef<Set<string>>(new Set());

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

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/kiosk', { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } catch {}
    try {
      const sr = await fetch('/api/spotify', { cache: 'no-store' });
      if (sr.ok) setSpotify(await sr.json());
    } catch {}
  }, []);

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

  // 1 Hz Clock + Rotary Timer tick
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
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Supabase Realtime broadcast subscription + fallback poll
  useEffect(() => {
    const sb = browserSupabase();
    const channel = sb
      ?.channel('kitchen')
      .on('broadcast', { event: 'db_change' }, () => refresh())
      .subscribe();
    const poll = setInterval(refresh, 45_000);
    const wx = setInterval(async () => {
      const r = await fetch('/api/weather');
      if (r.ok) setWeather(await r.json());
    }, 600_000);
    return () => {
      if (channel && sb) sb.removeChannel(channel);
      clearInterval(poll);
      clearInterval(wx);
    };
  }, [refresh]);

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

  // Time formatting
  const rawTime = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const [clockDigits, clockAmPm] = rawTime.split(' ');
  const d = state.dinner;
  const doneChores = state.chores.filter((c) => c.completed).length;
  const chorePct = state.chores.length > 0 ? Math.round((doneChores / state.chores.length) * 100) : 0;
  const allowanceEarned = (doneChores * 5).toFixed(2);
  const allowanceTotal = (state.chores.length * 5).toFixed(2);
  const pendingOrders = state.orders.filter((o) => o.status === 'pending');
  const nextUnassigned = state.events.find(
    (e) => (e.logistics_type === 'pickup' || e.logistics_type === 'appointment') && e.assigned_parent === 'unassigned',
  );
  const filteredEvents = state.events.filter((ev) => {
    if (memberFilter === 'all') return true;
    if (memberFilter === 'wesley') return ev.logistics_type === 'pickup' || ev.logistics_type === 'appointment' || ev.title.toLowerCase().includes('wesley');
    return ev.assigned_parent === memberFilter || ev.source_calendar.startsWith(memberFilter);
  });

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
        {/* ── 1. Top Navigation & Family Presence Bar (Shown in Bento & Timeline Modes; slim in Ambient) ── */}
        <header className="hearth-topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              className={`hw-btn ${mode === 'ambient' ? 'terracotta' : ''}`}
              onClick={() => setMode(mode === 'ambient' ? 'bento' : 'ambient')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>
                {mode === 'ambient' ? 'grid_view' : 'arrow_back'}
              </span>
              <span>{mode === 'ambient' ? 'OPEN COMMAND BENTO' : 'RETURN TO AMBIENT'}</span>
            </button>

            <div style={{ width: 1, height: 22, background: 'var(--border)' }} />

            <button
              className="hw-btn"
              onClick={() => setMode(mode === 'timeline' ? 'bento' : 'timeline')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17, color: 'var(--emerald)' }}>
                {mode === 'timeline' ? 'close_fullscreen' : 'grid_view'}
              </span>
              <span>{mode === 'timeline' ? 'TIMELINE EXPANDED' : 'BENTO OVERVIEW'}</span>
            </button>
          </div>

          {/* Center Glance Clock + Weather */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: '2.55rem', fontWeight: 800, letterSpacing: '-0.03em', lineHeight: 1 }}>
                {clockDigits}
              </span>
              <span className="font-mono" style={{ fontSize: '0.84rem', fontWeight: 700, color: 'var(--muted)' }}>
                {clockAmPm}
              </span>
            </div>
            <div style={{ textAlign: 'right', lineHeight: 1.25 }}>
              <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>{fmtDay(state.date)}</div>
              <div className="font-mono" style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.05em' }}>
                {weather
                  ? `OUTDOOR ${weather.current.temp}°F (${weather.current.label.toUpperCase()}) • H ${weather.today.hi}° L ${weather.today.lo}°`
                  : 'KITCHEN HEARTH • ONLINE'}
              </div>
            </div>
          </div>

          {/* Right Family Presence Pods + Voice */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <div className="presence-pod">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--terracotta)' }} />
              <span>
                <strong style={{ color: 'var(--text)' }}>Daniela:</strong>{' '}
                {d.chef === 'daniela' ? 'Chef Tonight' : d.unavailable.includes('daniela') ? 'Out Tonight' : 'Home'}
              </span>
            </div>
            <div className="presence-pod">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cobalt)' }} />
              <span>
                <strong style={{ color: 'var(--text)' }}>Wesley:</strong> {doneChores}/{state.chores.length} Done
              </span>
            </div>
            <div className="presence-pod">
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: state.lateTonight.length ? 'var(--amber)' : 'var(--sage)',
                }}
              />
              <span>
                <strong style={{ color: 'var(--text)' }}>Warren:</strong>{' '}
                {d.chef === 'warren'
                  ? 'Chef Tonight'
                  : state.lateTonight[0]
                    ? `Late until ${fmtTime(state.lateTonight[0].until)}`
                    : 'Home'}
              </span>
            </div>

            <button
              className="gemini-spark-btn"
              onClick={() => openGeminiOverlay()}
              title="Engage Gemini Voice Overlay"
            >
              <span className="gemini-badge-square" style={{ width: 26, height: 26, borderRadius: 8 }}>
                <GeminiSparkIcon size={15} white />
              </span>
              <span>Gemini Voice</span>
            </button>
          </div>
        </header>

        {/* ════════════════════════════════════════════════════════════════════
            VIEW 1: 10-FOOT AMBIENT STANDBY HEARTH VIEW (Stitch Screen 1 & 2)
            ════════════════════════════════════════════════════════════════════ */}
        {mode === 'ambient' && (
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: '7fr 5fr',
              gap: 20,
              overflow: 'hidden',
            }}
          >
            {/* Left Primary Glanceable Column: Giant 116px Hero Clock + Next Logistics Callout + Presence */}
            <div
              className="ceramic-card"
              style={{
                padding: '26px 32px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <div
                className="font-mono"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.75rem',
                  color: 'var(--muted)',
                  paddingBottom: 12,
                  borderBottom: '1px solid var(--border-subtle)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--terracotta)' }} />
                  HEARTH // COZYLA 24&quot; AMBIENT DISPLAY
                </span>
                <span>SLACK + SUPABASE REALTIME SYNC</span>
              </div>

              {/* Giant 10-Foot Glanceable Clock */}
              <div style={{ margin: 'auto 0', padding: '12px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                  <span
                    style={{
                      fontSize: 'clamp(76px, 7.6vw, 118px)',
                      fontWeight: 800,
                      letterSpacing: '-0.04em',
                      lineHeight: 0.95,
                    }}
                  >
                    {clockDigits}
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--terracotta)', letterSpacing: '0.06em' }}
                    >
                      {clockAmPm}
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--muted)', letterSpacing: '0.1em' }}
                    >
                      LOCAL • HOME
                    </span>
                  </div>
                </div>

                {/* Date & Weather Glances */}
                <div
                  style={{
                    marginTop: 18,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 14,
                    fontSize: '1.2rem',
                    fontWeight: 600,
                  }}
                >
                  <span>{fmtDay(state.date)}</span>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)' }} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span className="material-symbols-outlined" style={{ color: 'var(--amber)', fontSize: 22 }}>
                      sunny
                    </span>
                    {weather ? `Outdoor ${weather.current.temp}°F (${weather.current.label})` : 'Weather Ready'}
                  </span>
                  {weather && (
                    <>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot)' }} />
                      <span style={{ color: 'var(--text-secondary)', fontSize: '1.02rem' }}>
                        Tomorrow {weather.tomorrow.hi}°/{weather.tomorrow.lo}° {weather.tomorrow.label}
                      </span>
                    </>
                  )}
                </div>

                {/* Clickable Next Schedule / Pickup Banner */}
                <div
                  onClick={() => setMode('timeline')}
                  className="ceramic-well"
                  style={{
                    marginTop: 22,
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 12,
                        background: 'rgba(43, 89, 255, 0.1)',
                        border: '1px solid rgba(43, 89, 255, 0.25)',
                        color: 'var(--cobalt)',
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      <span className="material-symbols-outlined">calendar_clock</span>
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          className="font-mono"
                          style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--cobalt)', letterSpacing: '0.06em' }}
                        >
                          SCHEDULE &amp; LOGISTICS
                        </span>
                        {nextUnassigned && (
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: '#fef3c7',
                              color: '#b45309',
                            }}
                          >
                            DRIVER NEEDED
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.94rem', fontWeight: 700, marginTop: 2 }}>
                        {nextUnassigned
                          ? `${fmtTime(nextUnassigned.start_time)} • ${nextUnassigned.title}`
                          : state.events[0]
                            ? `${fmtTime(state.events[0].start_time)} • ${state.events[0].title}`
                            : 'No events scheduled today'}
                      </div>
                    </div>
                  </div>
                  <div
                    className="font-mono"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.76rem', fontWeight: 700, color: 'var(--cobalt)' }}
                  >
                    <span>View Family Schedule</span>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      arrow_forward
                    </span>
                  </div>
                </div>

                {/* Stitch "Gemini Voice" Ambient Spark Bar — Opens the Stitch Gemini Voice Overlay */}
                <div
                  onClick={() => openGeminiOverlay()}
                  className="ceramic-well"
                  style={{
                    marginTop: 14,
                    padding: '13px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                    cursor: 'pointer',
                    background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-well) 100%)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 13, minWidth: 0 }}>
                    <div className="gemini-badge-square" style={{ width: 40, height: 40, borderRadius: 12 }}>
                      <GeminiSparkIcon size={21} white />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: '1.02rem', fontWeight: 800, letterSpacing: '-0.01em' }}>
                          Gemini Voice
                        </span>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            color: 'var(--terracotta)',
                            letterSpacing: '0.06em',
                          }}
                        >
                          ON-BOARD ASSISTANT
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: '0.84rem',
                          color: 'var(--text-secondary)',
                          marginTop: 2,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {geminiCustomQuery
                          ? `“${geminiCustomQuery}”`
                          : 'Tap to ask Gemini by voice or launch the on-board Gemini app'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <GeminiEqualizerPill active={geminiListening} />
                  </div>
                </div>
              </div>

              {/* Lower Presence & Audio Status Shelf */}
              <div
                style={{
                  paddingTop: 14,
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span className="font-mono" style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
                    At Hearth:
                  </span>
                  <span className="presence-pod">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--sage)' }} />
                    <strong style={{ color: 'var(--text)' }}>Daniela</strong>
                    <span>{d.chef === 'daniela' ? 'Chef' : 'Home'}</span>
                  </span>
                  <span className="presence-pod">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--cobalt)' }} />
                    <strong style={{ color: 'var(--text)' }}>Wesley</strong>
                    <span style={{ color: 'var(--cobalt)' }}>Chores {doneChores}/{state.chores.length}</span>
                  </span>
                  <span className="presence-pod">
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--amber)' }} />
                    <strong style={{ color: 'var(--text)' }}>Warren</strong>
                    <span>{d.chef === 'warren' ? 'Chef' : 'Synced'}</span>
                  </span>
                </div>

                <button
                  className="hw-btn pill"
                  onClick={nprPlaying ? stopNpr : playNpr}
                  style={{ fontSize: '0.72rem' }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--terracotta)' }}>
                    graphic_eq
                  </span>
                  <span>{audioStatusLabel}</span>
                </button>
              </div>
            </div>

            {/* Right Bento Stack: Tonight's Dinner Decision Card + Physical Rotary Timer Widget */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
              {/* Card 1: Tonight's Dinner Decision Hub (Matches Stitch Screen 1 & 2) */}
              <div
                className="ceramic-card"
                style={{
                  padding: '22px 24px',
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: 0,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        className="font-mono"
                        style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--terracotta)', letterSpacing: '0.06em' }}
                      >
                        {d.status === 'unclaimed' ? '[ DINNER // ACTION NEEDED ]' : '[ MENU // TONIGHT ]'}
                      </span>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '2px 10px',
                          borderRadius: 999,
                          background: d.status === 'unclaimed' ? '#fef3c7' : '#fdeee9',
                          color: d.status === 'unclaimed' ? '#b45309' : 'var(--terracotta)',
                        }}
                      >
                        {d.status === 'unclaimed'
                          ? 'NEEDS COOK CLAIM'
                          : d.chef === 'takeout'
                            ? 'TAKEOUT / FEND'
                            : isParent(d.chef)
                              ? `${NAMES[d.chef].toUpperCase()} LEAD`
                              : 'PLANNED'}
                      </span>
                    </div>
                    {d.status !== 'unclaimed' && (
                      <button className="hw-btn" style={{ padding: '4px 10px', fontSize: '0.68rem' }} onClick={() => act({ type: 'unclaim_dinner' })}>
                        RESET
                      </button>
                    )}
                  </div>

                  <h2 style={{ fontSize: '1.45rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                    {d.status === 'unclaimed'
                      ? "Tonight's Dinner Decision"
                      : d.recipe_name || `${isParent(d.chef) ? NAMES[d.chef] : 'Family'} is cooking tonight`}
                  </h2>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                    {d.status === 'unclaimed'
                      ? `No cook selected yet. ${state.backlog.length} fridge backlog kits ready to cook.`
                      : d.unavailable.length
                        ? `Not cooking tonight: ${d.unavailable.map((p) => NAMES[p]).join(', ')}`
                        : 'Synced with Slack #food and the kitchen board.'}
                  </p>

                  {/* Quick Meal Kit Options from Fridge Backlog */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginTop: 12 }}>
                    {state.backlog.slice(0, 2).map((b) => (
                      <div
                        key={b.id}
                        className="ceramic-well"
                        style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--sage)' }}>
                            eco
                          </span>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {b.recipe_or_item_name}
                            </div>
                            <div className="font-mono" style={{ fontSize: '0.66rem', color: 'var(--muted)' }}>
                              {b.key_perishables.join(' • ') || 'In fridge backlog'}
                            </div>
                          </div>
                        </div>
                        <button
                          className="hw-btn emerald"
                          style={{ padding: '5px 10px', fontSize: '0.68rem' }}
                          onClick={() => act({ type: 'cook_from_backlog', backlogId: b.id })}
                        >
                          SELECT
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2x2 Chef Assignment Hardware Buttons */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                  <button
                    className={`hw-btn ${d.chef === 'daniela' ? 'terracotta' : ''}`}
                    onClick={() => act({ type: 'claim_dinner', chef: 'daniela' })}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      skillet
                    </span>
                    <span>Daniela cooks</span>
                  </button>
                  <button
                    className={`hw-btn ${d.chef === 'warren' ? 'terracotta' : ''}`}
                    onClick={() => act({ type: 'claim_dinner', chef: 'warren' })}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      soup_kitchen
                    </span>
                    <span>Warren cooks</span>
                  </button>
                  <button
                    className={`hw-btn ${d.chef === 'takeout' ? 'terracotta' : ''}`}
                    onClick={() => act({ type: 'claim_dinner', chef: 'takeout' })}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      takeout_dining
                    </span>
                    <span>Takeout / Order In</span>
                  </button>
                  <button
                    className="hw-btn"
                    onClick={() =>
                      d.status === 'planned'
                        ? act({ type: 'dinner_cooked' })
                        : act({ type: 'not_tonight', parent: 'daniela', unavailable: !d.unavailable.includes('daniela') })
                    }
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {d.status === 'planned' ? 'check_circle' : 'block'}
                    </span>
                    <span>{d.status === 'planned' ? 'Mark Cooked ✓' : 'Daniela: Not Tonight'}</span>
                  </button>
                </div>
              </div>

              {/* Card 2: Physical Rotary Kitchen Timer Widget (Conditional on an active voice-triggered timer) */}
              {activeTimer && (
                <div
                  className="ceramic-card"
                  style={{
                    padding: '20px 24px',
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
                        style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--terracotta)', letterSpacing: '0.06em' }}
                      >
                        TIMER 01 // {timerRunning ? 'ACTIVE' : 'PAUSED'}
                      </span>
                    </div>
                    <div style={{ margin: '6px 0 12px' }}>
                      <div style={{ fontSize: '1.18rem', fontWeight: 800 }}>
                        {activeTimer.label}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)' }}>
                        Triggered by voice • Tap PAUSE / +1 MIN or CLEAR
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
                      <button className="hw-btn" onClick={() => setTimers([])}>
                        CLEAR
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
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════════════════════════
            VIEW 2: BENTO OVERVIEW & EXPANDED TIMELINE (Stitch Screens 3 & 4)
            ════════════════════════════════════════════════════════════════════ */}
        {mode !== 'ambient' && (
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--clay)', letterSpacing: '0.06em' }}
                    >
                      [ 01 // MASTER FAMILY TIMELINE — {filteredEvents.length} SCHEDULED ITEMS ]
                    </span>
                    <span
                      className="font-mono"
                      style={{
                        fontSize: '0.68rem',
                        fontWeight: 700,
                        padding: '2px 10px',
                        borderRadius: 999,
                        background: state.conflicts.length ? '#fef3c7' : '#edf7f2',
                        border: `1px solid ${state.conflicts.length ? '#fde68a' : '#bbf7d0'}`,
                        color: state.conflicts.length ? '#b45309' : 'var(--emerald)',
                      }}
                    >
                      ● {state.conflicts.length ? `${state.conflicts.length} Needs Owner` : 'On Track'}
                    </span>
                  </div>

                  {/* Member Filter Pills (All / Daniela / Warren / Wesley) */}
                  <div
                    className="ceramic-well font-mono"
                    style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 12, fontSize: '0.72rem' }}
                  >
                    {(['all', 'daniela', 'warren', 'wesley'] as MemberFilter[]).map((f) => (
                      <button
                        key={f}
                        onClick={() => setMemberFilter(f)}
                        style={{
                          padding: '4px 11px',
                          borderRadius: 9,
                          border: 'none',
                          cursor: 'pointer',
                          background: memberFilter === f ? 'var(--surface)' : 'transparent',
                          color: memberFilter === f ? 'var(--text)' : 'var(--muted)',
                          fontWeight: memberFilter === f ? 700 : 500,
                        }}
                      >
                        {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
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
                    gap: 8,
                    padding: '10px 0',
                  }}
                >
                  {filteredEvents.length === 0 && (
                    <div
                      className="ceramic-well"
                      style={{
                        padding: '18px 20px',
                        color: 'var(--muted)',
                        fontSize: '0.86rem',
                        textAlign: 'center',
                        margin: 'auto 0',
                      }}
                    >
                      No calendar events synced for today yet.
                    </div>
                  )}
                  {filteredEvents.map((ev) => {
                    const needsOwner =
                      (ev.logistics_type === 'pickup' || ev.logistics_type === 'appointment') &&
                      ev.assigned_parent === 'unassigned';
                    const isLate = ev.logistics_type === 'late_office';
                    const timeStr = isAllDay(ev.start_time, ev.end_time) ? 'ALL DAY' : fmtTime(ev.start_time);
                    return (
                      <div
                        key={ev.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 14,
                          padding: '11px 14px',
                          borderRadius: 16,
                          background: needsOwner ? '#fffaf5' : isLate ? '#fff5f2' : 'var(--surface-tint)',
                          border: `1.5px solid ${needsOwner ? '#fed7aa' : isLate ? 'var(--terracotta)' : 'var(--border)'}`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
                          <div style={{ width: 82, flexShrink: 0 }}>
                            <div
                              className="font-mono"
                              style={{
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                color: needsOwner ? '#b45309' : isLate ? 'var(--clay)' : 'var(--text)',
                              }}
                            >
                              {timeStr}
                            </div>
                            <div
                              className="font-mono"
                              style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}
                            >
                              {ev.logistics_type.replace('_', ' ')}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '0.92rem', fontWeight: 700 }}>{ev.title}</span>
                              {needsOwner ? (
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    background: '#fef3c7',
                                    border: '1px solid #fde68a',
                                    color: '#b45309',
                                  }}
                                >
                                  DRIVER UNASSIGNED
                                </span>
                              ) : (
                                <span
                                  className="font-mono"
                                  style={{
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    padding: '2px 8px',
                                    borderRadius: 999,
                                    background: '#edf7f2',
                                    border: '1px solid #bbf7d0',
                                    color: 'var(--emerald)',
                                  }}
                                >
                                  {ev.assigned_parent !== 'unassigned' ? `✓ ${NAMES[ev.assigned_parent]}` : 'SCHEDULED'}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                              {SOURCE_LABEL[ev.source_calendar]} • {fmtTime(ev.start_time)}–{fmtTime(ev.end_time)}
                            </div>
                          </div>
                        </div>

                        {/* Claim / Assign Pickup Buttons */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                          {PARENTS.map((p) => (
                            <button
                              key={p}
                              className={`hw-btn ${ev.assigned_parent === p ? 'terracotta' : ''}`}
                              style={{ padding: '6px 11px', fontSize: '0.7rem' }}
                              onClick={() =>
                                act({
                                  type: 'assign_logistics',
                                  id: ev.id,
                                  parent: ev.assigned_parent === p ? 'unassigned' : p,
                                })
                              }
                            >
                              {ev.assigned_parent === p ? `✓ ${NAMES[p]}` : `Claim: ${NAMES[p]}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Expand / Collapse Timeline Footer */}
                <div
                  style={{
                    paddingTop: 10,
                    borderTop: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    flexShrink: 0,
                  }}
                >
                  <button
                    className="hw-btn"
                    onClick={() => setMode(mode === 'timeline' ? 'bento' : 'timeline')}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                      {mode === 'timeline' ? 'expand_less' : 'schedule'}
                    </span>
                    <span>
                      {mode === 'timeline' ? 'COLLAPSE TO BENTO OVERVIEW' : `EXPAND FULL TIMELINE (${state.events.length} EVENTS)`}
                    </span>
                  </button>

                  <div
                    className="font-mono"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.7rem', color: 'var(--muted)' }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--emerald)' }} />
                    <span>Outlook + Google Calendar Synced</span>
                  </div>
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
                          background: '#faf7f2',
                          border: '1px solid #edd5c3',
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
                            style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--clay)', letterSpacing: '0.06em' }}
                          >
                            [ TONIGHT&apos;S HEARTH DINNER ]
                          </span>
                          <span
                            className="font-mono"
                            style={{
                              fontSize: '0.66rem',
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: d.status === 'unclaimed' ? '#fef3c7' : '#edf7f2',
                              color: d.status === 'unclaimed' ? '#b45309' : 'var(--emerald)',
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
                      paddingBottom: 10,
                      borderBottom: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div
                        className="ceramic-well"
                        style={{ width: 34, height: 34, display: 'grid', placeItems: 'center', color: 'var(--cobalt)' }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                          task_alt
                        </span>
                      </div>
                      <div>
                        <h2 style={{ fontSize: '1.08rem', fontWeight: 800 }}>Wesley&apos;s Chores</h2>
                        <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                          Daily Contributions &amp; Greenlight Audit
                        </span>
                      </div>
                    </div>
                    <span
                      className="ceramic-well font-mono"
                      style={{
                        padding: '4px 11px',
                        borderRadius: 999,
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 15, color: 'var(--cobalt)' }}>
                        credit_card
                      </span>
                      Greenlight
                    </span>
                  </div>

                  {/* Weekly Allowance Progress Card */}
                  <div
                    className="ceramic-well"
                    style={{ margin: '10px 0', padding: '12px 14px', borderRadius: 18 }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <div>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.64rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.07em',
                            color: 'var(--muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 5,
                          }}
                        >
                          <span className="material-symbols-outlined" style={{ fontSize: 14, color: 'var(--amber)' }}>
                            account_balance_wallet
                          </span>
                          Today&apos;s Allowance Progress
                        </span>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 2 }}>
                          <span style={{ fontSize: '1.75rem', fontWeight: 800 }}>${allowanceEarned}</span>
                          <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--muted)' }}>
                            of ${allowanceTotal} Today
                          </span>
                        </div>
                      </div>
                      <span
                        className="font-mono"
                        style={{
                          padding: '4px 10px',
                          borderRadius: 8,
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                        }}
                      >
                        {chorePct}% COMPLETE
                      </span>
                    </div>

                    <div
                      style={{
                        width: '100%',
                        height: 9,
                        borderRadius: 999,
                        background: 'var(--border)',
                        overflow: 'hidden',
                        marginTop: 8,
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
                      gap: 7,
                    }}
                  >
                    {state.chores.length === 0 && (
                      <div
                        className="ceramic-well"
                        style={{
                          padding: '16px 18px',
                          color: 'var(--muted)',
                          fontSize: '0.82rem',
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
                          padding: '10px 12px',
                          borderRadius: 16,
                          background: c.completed ? 'var(--surface-tint)' : 'var(--surface)',
                          border: `1.5px solid ${c.completed ? 'var(--border)' : '#d2dbe8'}`,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: 10,
                              background: c.completed ? '#edf7f2' : '#f4f7ff',
                              border: `1px solid ${c.completed ? '#bbf7d0' : 'rgba(43,89,255,0.35)'}`,
                              color: c.completed ? 'var(--emerald)' : 'var(--cobalt)',
                              display: 'grid',
                              placeItems: 'center',
                            }}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                              {c.completed ? 'check' : 'check_box_outline_blank'}
                            </span>
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: '0.86rem',
                                fontWeight: 700,
                                textDecoration: c.completed ? 'line-through' : 'none',
                                color: c.completed ? 'var(--text-secondary)' : 'var(--text)',
                              }}
                            >
                              {c.emoji ? `${c.emoji} ` : ''}
                              {c.chore_title}
                            </div>
                            <div className="font-mono" style={{ fontSize: '0.64rem', color: 'var(--muted)' }}>
                              {c.completed ? 'Completed on Kitchen Board' : 'Tap to complete'}
                            </div>
                          </div>
                        </div>

                        <span
                          className="font-mono"
                          style={{
                            padding: '2px 8px',
                            borderRadius: 6,
                            background: c.completed ? '#edf7f2' : '#f4f7ff',
                            color: c.completed ? 'var(--emerald)' : 'var(--cobalt)',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                          }}
                        >
                          +$5.00
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pantry & Grocery Cart Staging Footer */}
                <div style={{ paddingTop: 10, marginTop: 10, borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--muted)' }}>
                        local_shipping
                      </span>
                      Pantry Cart Staging ({state.groceries.length})
                    </span>
                  </div>

                  <form
                    style={{ display: 'flex', gap: 6 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newGrocery.trim()) return;
                      act({ type: 'add_grocery', name: newGrocery });
                      setNewGrocery('');
                    }}
                  >
                    <input
                      className="ceramic-well"
                      style={{ flex: 1, padding: '7px 12px', fontSize: '0.8rem' }}
                      placeholder={
                        state.groceries.length
                          ? `In cart: ${state.groceries.map((g) => g.name).join(', ')} — add more…`
                          : 'Add item to Saturday grocery cart…'
                      }
                      value={newGrocery}
                      onChange={(e) => setNewGrocery(e.target.value)}
                    />
                    <button className="hw-btn" type="submit">
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
                    background: '#fffcf5',
                    borderColor: '#edd5c3',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="font-mono" style={{ fontSize: '0.68rem', fontWeight: 700, color: '#9a3412' }}>
                      🍲 TONIGHT&apos;S DINNER
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: '0.64rem', fontWeight: 700, background: '#fef3c7', color: '#d97706', padding: '2px 6px', borderRadius: 6 }}
                    >
                      6:30 PM
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800 }}>
                      {d.recipe_name || (d.status === 'unclaimed' ? 'Unclaimed' : `${isParent(d.chef) ? NAMES[d.chef] : 'Planned'} Cooking`)}
                    </div>
                    <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', marginTop: 2 }}>
                      {state.backlog.length} kits in fridge backlog
                    </div>
                  </div>
                  <button className="hw-btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={() => setMode('ambient')}>
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
                      style={{ fontSize: '0.64rem', fontWeight: 700, background: '#edf7f2', color: 'var(--emerald)', padding: '2px 6px', borderRadius: 6 }}
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
                    <div style={{ height: 6, borderRadius: 99, background: '#e2e8f0', overflow: 'hidden', margin: '6px 0' }}>
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
                      style={{ fontSize: '0.62rem', fontWeight: 700, background: '#fdf2f2', color: '#b91c1c', padding: '2px 6px', borderRadius: 6 }}
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

        {/* ── Bottom Hardware Navigation Dock (Matches Stitch Screens 1–4) ── */}
        <footer className="hearth-dock">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              className={`dock-tab ${mode === 'ambient' ? 'active' : ''}`}
              onClick={() => setMode('ambient')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: mode === 'ambient' ? '#fff' : 'var(--terracotta)' }}>
                restaurant
              </span>
              <span>Dinner &amp; Timer Hub</span>
            </button>

            <button
              className={`dock-tab ${mode === 'bento' ? 'active' : ''}`}
              onClick={() => setMode('bento')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: mode === 'bento' ? '#fff' : 'var(--cobalt)' }}>
                checklist
              </span>
              <span>Chores &amp; Schedule ({doneChores}/{state.chores.length})</span>
            </button>

            <button
              className={`dock-tab ${mode === 'timeline' ? 'active' : ''}`}
              onClick={() => setMode('timeline')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: mode === 'timeline' ? '#fff' : 'var(--emerald)' }}>
                calendar_month
              </span>
              <span>Master Timeline ({state.events.length})</span>
            </button>

            <button
              className="dock-tab"
              onClick={nprPlaying ? stopNpr : playNpr}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--terracotta)' }}>
                radio
              </span>
              <span>{nprPlaying ? 'Stop NPR Live' : 'NPR Live Radio'}</span>
            </button>

            <button
              className="dock-tab"
              onClick={() => actSpotify(spotify.playing ? 'pause' : 'play')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'var(--cobalt)' }}>
                graphic_eq
              </span>
              <span>
                {spotify.playing ? `Spotify: ${spotify.track?.slice(0, 16) || 'Playing'}` : 'Spotify Connect'}
              </span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ThemeToggle defaultTheme="light" />
            <a href="/guide" className="hw-btn">
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: 'var(--terracotta)' }}>
                menu_book
              </span>
              <span>MANUAL</span>
            </a>
            <button
              className="hw-btn"
              onClick={() => setMode(mode === 'ambient' ? 'bento' : 'ambient')}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                power_settings_new
              </span>
              <span>{mode === 'ambient' ? 'WAKE' : 'STANDBY'}</span>
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
                    <span style={{ color: '#1549d6' }}>AT COOKTOP</span>
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
                      color: '#b5381a',
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
      </main>
    </div>
  );
}
