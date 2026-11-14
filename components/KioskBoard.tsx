'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { browserSupabase } from '@/lib/supabase/browser';
import { NAMES, PARENTS, SOURCE_LABEL, isParent } from '@/lib/family';
import { daysBetween, fmtDay, fmtShortDate, fmtTime, isAllDay } from '@/lib/time';
import { isFullyKiosk, speakOnCozyla, useCozylaKiosk, wakeCozylaScreen } from '@/lib/cozyla';
import type { BacklogLocation, KioskAction, KitchenState } from '@/lib/types';
import type { Weather } from '@/lib/weather';
import { VoiceOrb } from './VoiceOrb';

interface Timer {
  id: string;
  label: string;
  endsAt: number;
}

const NPR_URL = process.env.NEXT_PUBLIC_NPR_STREAM_URL || 'https://npr-ice.streamguys1.com/live.mp3';

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

export function KioskBoard({ initial, initialWeather }: { initial: KitchenState; initialWeather: Weather | null }) {
  const [state, setState] = useState<KitchenState>(initial);
  const [weather, setWeather] = useState<Weather | null>(initialWeather);
  const [now, setNow] = useState<Date>(() => new Date());
  const [timers, setTimers] = useState<Timer[]>([]);
  const [nprPlaying, setNprPlaying] = useState(false);
  const [newBacklog, setNewBacklog] = useState('');
  const [newBacklogLoc, setNewBacklogLoc] = useState<BacklogLocation>('fridge');
  const [newGrocery, setNewGrocery] = useState('');
  const nprRef = useRef<HTMLAudioElement | null>(null);
  const firedTimers = useRef<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/kiosk', { cache: 'no-store' });
      if (r.ok) setState(await r.json());
    } catch {}
  }, []);

  // Cozyla 24" + Fully Kiosk Browser integration (wake lock, camera motion wake, night dimming)
  useCozylaKiosk(refresh);

  const act = useCallback(async (action: KioskAction) => {
    const r = await fetch('/api/kiosk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (r.ok) setState(await r.json());
  }, []);

  const decideOrder = useCallback(async (id: string, approve: boolean) => {
    const r = await fetch('/api/kiosk/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, approve }),
    });
    if (r.ok) setState(await r.json());
  }, []);

  // Clock + timer chime loop (1 Hz)
  useEffect(() => {
    const id = setInterval(() => {
      const t = new Date();
      setNow(t);
      setTimers((cur) => {
        for (const tm of cur) {
          if (tm.endsAt <= t.getTime() && !firedTimers.current.has(tm.id)) {
            firedTimers.current.add(tm.id);
            wakeCozylaScreen();
            chime();
            if (isFullyKiosk()) speakOnCozyla(`${tm.label} timer is done`);
          }
        }
        return cur;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Supabase Realtime broadcast subscription + 45s fallback poll + weather refresh
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

  // NPR controls
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

  const startTimer = useCallback((seconds: number, label = 'Timer') => {
    setTimers((cur) => [...cur, { id: `${Date.now()}-${Math.random()}`, label, endsAt: Date.now() + seconds * 1000 }]);
  }, []);

  const d = state.dinner;
  const doneChores = state.chores.filter((c) => c.completed).length;
  const pendingOrders = state.orders.filter((o) => o.status === 'pending');

  const dinnerHeadline =
    d.chef === 'takeout'
      ? '🥡 Takeout / fend for yourselves'
      : d.status === 'unclaimed'
        ? '❓ Nobody has claimed dinner yet'
        : `${d.status === 'cooked' ? '✅' : '👩‍🍳'} ${ isParent(d.chef) ? NAMES[d.chef] : 'Planned'}${
            d.recipe_name ? ` — ${d.recipe_name}` : ' is cooking tonight'
          }`;

  return (
    <main className="kiosk">
      {/* ── Top Bar: Clock · Weather · Timers · NPR · Voice ── */}
      <header className="topbar">
        <div className="clock-wrap">
          <div className="clock">
            {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </div>
          <div className="date-sub">{fmtDay(state.date)}</div>
        </div>

        {weather && (
          <div className="weather-pill">
            <span className="weather-now">
              {weather.current.emoji} {weather.current.temp}°
            </span>
            <div className="weather-meta">
              <div>
                {weather.current.label} · H {weather.today.hi}° / L {weather.today.lo}°
                {weather.today.precip ? ` · ${weather.today.precip}% rain` : ''}
              </div>
              <div>
                Tomorrow: {weather.tomorrow.emoji} {weather.tomorrow.hi}°/{weather.tomorrow.lo}° {weather.tomorrow.label}
              </div>
            </div>
          </div>
        )}

        <div className="media-cluster">
          {timers.map((tm) => {
            const rem = Math.max(0, Math.ceil((tm.endsAt - now.getTime()) / 1000));
            const mm = String(Math.floor(rem / 60)).padStart(2, '0');
            const ss = String(rem % 60).padStart(2, '0');
            return (
              <button
                key={tm.id}
                className={`btn sm ${rem === 0 ? 'red' : 'active'}`}
                onClick={() => setTimers((cur) => cur.filter((x) => x.id !== tm.id))}
                title="Tap to dismiss"
              >
                ⏱️ {tm.label}: {rem === 0 ? 'DONE!' : `${mm}:${ss}`} ✕
              </button>
            );
          })}
          <button className="btn sm" onClick={() => startTimer(5 * 60, '5m')}>+5m</button>
          <button className="btn sm" onClick={() => startTimer(10 * 60, '10m')}>+10m</button>
          <button className="btn sm" onClick={() => startTimer(15 * 60, '15m')}>+15m</button>

          <button className={`btn ${nprPlaying ? 'active' : ''}`} onClick={nprPlaying ? stopNpr : playNpr}>
            📻 {nprPlaying ? 'Stop NPR' : 'Play NPR'}
          </button>

          <VoiceOrb
            onStartTimer={startTimer}
            onCancelTimers={() => setTimers([])}
            onPlayNpr={playNpr}
            onStopNpr={stopNpr}
            onServerToolDone={refresh}
          />
        </div>
      </header>

      {/* ── Alert Strip: Conflicts · Working Late · Pending Saturday Cart ── */}
      {(state.conflicts.length > 0 || state.lateTonight.length > 0 || pendingOrders.length > 0) && (
        <section className="alert-strip">
          {state.conflicts.map((c, i) => (
            <span key={i} className="alert-chip">⚠️ {c.message}</span>
          ))}
          {state.lateTonight.map((l, i) => (
            <span key={`l-${i}`} className="alert-chip late">
              🏢 {l.parent ? `${NAMES[l.parent]}: ` : ''}{l.title} until {fmtTime(l.until)}
            </span>
          ))}
          {pendingOrders.map((o) => (
            <span key={o.id} className="alert-chip order">
              🛒 Saturday order waiting for approval ({o.kept_recipes.length} recipes, {o.items.length} items)
            </span>
          ))}
        </section>
      )}

      {/* ── Main 3-Column Board ── */}
      <section className="board">
        {/* ═══ Column 1: Tonight's Dinner + Fridge/Pantry Backlog + Saturday Cart Gate ═══ */}
        <div className="col">
          <div className="card">
            <div className="card-head">
              <span className="card-title">🍽️ Tonight&apos;s Dinner</span>
              {d.claimed_via && <span className="badge">via {d.claimed_via}</span>}
            </div>

            <div className={`dinner-hero ${d.status}`}>
              <div>
                <div className="dinner-who">{dinnerHeadline}</div>
                {d.unavailable.length > 0 && (
                  <div className="dinner-sub">
                    🙅 Not cooking tonight: {d.unavailable.map((p) => NAMES[p]).join(', ')}
                  </div>
                )}
              </div>
              {d.status === 'planned' && (
                <button className="btn green" onClick={() => act({ type: 'dinner_cooked' })}>
                  ✅ Cooked
                </button>
              )}
              {d.status !== 'unclaimed' && (
                <button className="btn sm ghost" onClick={() => act({ type: 'unclaim_dinner' })}>
                  Reset
                </button>
              )}
            </div>

            <div className="btn-row">
              <button
                className={`btn ${d.chef === 'daniela' ? 'active' : ''}`}
                onClick={() => act({ type: 'claim_dinner', chef: 'daniela' })}
              >
                🙋‍♀️ Daniela&apos;s cooking
              </button>
              <button
                className={`btn ${d.chef === 'warren' ? 'active' : ''}`}
                onClick={() => act({ type: 'claim_dinner', chef: 'warren' })}
              >
                🧑‍🍳 Warren&apos;s cooking
              </button>
              <button
                className={`btn ${d.chef === 'takeout' ? 'active' : ''}`}
                onClick={() => act({ type: 'claim_dinner', chef: 'takeout' })}
              >
                🥡 Takeout / Fend
              </button>
              {PARENTS.map((p) => {
                const off = d.unavailable.includes(p);
                return (
                  <button
                    key={p}
                    className={`btn sm ${off ? 'red' : 'ghost'}`}
                    onClick={() => act({ type: 'not_tonight', parent: p, unavailable: !off })}
                  >
                    🙅 {NAMES[p]}: {off ? 'out tonight' : 'not tonight'}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Fridge & Pantry Backlog */}
          <div className="card grow">
            <div className="card-head">
              <span className="card-title">🧊 Fridge &amp; Pantry Backlog</span>
              <span className={`badge ${state.backlog.length >= 3 ? 'warn' : ''}`}>
                {state.backlog.length} waiting
              </span>
            </div>

            <div className="scroll">
              {state.backlog.length === 0 && (
                <div className="row-meta">All caught up — nothing backed up in the fridge.</div>
              )}
              {state.backlog.map((b) => {
                const age = daysBetween(b.delivery_date, state.date);
                const ageText =
                  age < 0 ? `Arrives ${fmtShortDate(b.delivery_date)}` : age === 0 ? 'Arrived today' : `${age}d in ${b.location}`;
                const linked = d.linked_backlog_id === b.id;
                return (
                  <div key={b.id} className={`row ${age >= 6 ? 'old' : age >= 4 ? 'aging' : ''}`}>
                    <div className="row-main">
                      <div className="row-title">
                        {b.recipe_or_item_name} {linked ? '· 🎯 tonight' : ''}
                      </div>
                      <div className="row-meta">
                        {ageText}
                        {b.key_perishables.length ? ` · ${b.key_perishables.join(', ')}` : ''}
                        {b.added_by ? ` · ${b.added_by}` : ''}
                      </div>
                    </div>
                    <div className="btn-row">
                      {!linked && d.status !== 'cooked' && (
                        <button
                          className="btn sm primary"
                          onClick={() => act({ type: 'cook_from_backlog', backlogId: b.id })}
                        >
                          Cook tonight
                        </button>
                      )}
                      <button
                        className="btn sm green"
                        onClick={() => act({ type: 'backlog_status', id: b.id, status: 'cooked' })}
                      >
                        ✅ Cooked
                      </button>
                      <button
                        className="btn sm ghost"
                        onClick={() => act({ type: 'backlog_status', id: b.id, status: 'discarded' })}
                      >
                        🗑️ Toss
                      </button>
                    </div>
                  </div>
                );
              })}

              {/* Pending Saturday Cart Proposal from Warren's Agent */}
              {pendingOrders.map((p) => (
                <div key={p.id} className="row aging">
                  <div className="row-main">
                    <div className="row-title">
                      🛒 Warren&apos;s Saturday order ({fmtShortDate(p.delivery_date)})
                    </div>
                    <div className="row-meta">
                      {p.kept_recipes.map((r) => r.name).join(', ') || 'Household items only'} · {p.items.length} items
                      {p.dropped_recipes.length ? ` (scaled back ${p.dropped_recipes.length} bc of backlog)` : ''}
                    </div>
                  </div>
                  <div className="btn-row">
                    <button className="btn sm green" onClick={() => decideOrder(p.id, true)}>
                      👍 Approve
                    </button>
                    <button className="btn sm red" onClick={() => decideOrder(p.id, false)}>
                      ✋ Hold
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <form
              className="add-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newBacklog.trim()) return;
                act({ type: 'add_backlog', name: newBacklog, location: newBacklogLoc });
                setNewBacklog('');
              }}
            >
              <input
                className="input"
                placeholder="Add meal kit, leftovers, or pantry item…"
                value={newBacklog}
                onChange={(e) => setNewBacklog(e.target.value)}
              />
              <select
                className="input"
                style={{ flex: '0 0 110px' }}
                value={newBacklogLoc}
                onChange={(e) => setNewBacklogLoc(e.target.value as BacklogLocation)}
              >
                <option value="fridge">Fridge</option>
                <option value="pantry">Pantry</option>
                <option value="freezer">Freezer</option>
              </select>
              <button className="btn sm" type="submit">+ Add</button>
            </form>
          </div>
        </div>

        {/* ═══ Column 2: Today's Unified Schedule & Pickup Ownership ═══ */}
        <div className="col">
          <div className="card grow">
            <div className="card-head">
              <span className="card-title">🚗 Today&apos;s Logistics &amp; Calendars</span>
              <span className="badge">{state.events.length} events</span>
            </div>

            <div className="scroll">
              {state.events.length === 0 && (
                <div className="row-meta">
                  Nothing on Warren&apos;s Outlook or Daniela&apos;s Google Calendar today.
                </div>
              )}
              {state.events.map((ev) => {
                const needsOwner =
                  (ev.logistics_type === 'pickup' || ev.logistics_type === 'appointment') &&
                  ev.assigned_parent === 'unassigned';
                const timeStr = isAllDay(ev.start_time, ev.end_time)
                  ? 'All day'
                  : `${fmtTime(ev.start_time)}–${fmtTime(ev.end_time)}`;
                return (
                  <div key={ev.id} className={`row ${needsOwner ? 'aging' : ''}`}>
                    <div className="row-main">
                      <div className="row-title">
                        {ev.logistics_type === 'pickup' && '🚗 '}
                        {ev.logistics_type === 'appointment' && '🩺 '}
                        {ev.logistics_type === 'late_office' && '🏢 '}
                        {ev.title}
                      </div>
                      <div className="row-meta" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{timeStr}</span>
                        <span className={`cal-tag ${ev.source_calendar}`}>{SOURCE_LABEL[ev.source_calendar]}</span>
                      </div>
                    </div>

                    <div className="btn-row">
                      {PARENTS.map((p) => (
                        <button
                          key={p}
                          className={`btn sm ${ev.assigned_parent === p ? 'active' : ''}`}
                          onClick={() =>
                            act({
                              type: 'assign_logistics',
                              id: ev.id,
                              parent: ev.assigned_parent === p ? 'unassigned' : p,
                            })
                          }
                        >
                          {NAMES[p]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ═══ Column 3: Wesley's Greenlight Chores + Household Shopping List ═══ */}
        <div className="col">
          <div className="card grow">
            <div className="card-head">
              <span className="card-title">⭐ Wesley&apos;s Chores</span>
              <span className={`badge ${doneChores === state.chores.length && state.chores.length > 0 ? 'ok' : ''}`}>
                {doneChores}/{state.chores.length} done
              </span>
            </div>

            <div className="scroll">
              {state.chores.map((c) => (
                <button
                  key={c.id}
                  className={`chore-tile ${c.completed ? 'done' : ''}`}
                  onClick={() => act({ type: 'toggle_chore', id: c.id, completed: !c.completed })}
                >
                  <span className="chore-check">{c.completed ? '✓' : ''}</span>
                  <span>
                    {c.emoji ? `${c.emoji} ` : ''}
                    {c.chore_title}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <span className="card-title">🧻 Next Grocery Order</span>
              <span className="badge">{state.groceries.length}</span>
            </div>

            <div className="scroll" style={{ maxHeight: 165 }}>
              {state.groceries.length === 0 && (
                <div className="row-meta">Say &ldquo;add paper towels to the cart&rdquo; or type below.</div>
              )}
              {state.groceries.map((g) => (
                <div key={g.id} className="row">
                  <div className="row-main">
                    <div className="row-title">
                      {g.name}
                      {g.quantity ? ` (${g.quantity})` : ''}
                    </div>
                  </div>
                  <button
                    className="btn sm ghost"
                    onClick={() => act({ type: 'grocery_status', id: g.id, status: 'got' })}
                  >
                    ✓ Got it
                  </button>
                </div>
              ))}
            </div>

            <form
              className="add-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newGrocery.trim()) return;
                act({ type: 'add_grocery', name: newGrocery });
                setNewGrocery('');
              }}
            >
              <input
                className="input"
                placeholder="Add to shopping list…"
                value={newGrocery}
                onChange={(e) => setNewGrocery(e.target.value)}
              />
              <button className="btn sm" type="submit">+ Add</button>
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
