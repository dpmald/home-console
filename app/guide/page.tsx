'use client';
import { useState } from 'react';
import { ThemeToggle } from '@/components/ThemeToggle';

type Tab = 'overview' | 'dinner' | 'recipes' | 'calendars' | 'chores' | 'cozyla';

interface RecipeSim {
  name: string;
  usesFridge: string[];
}

const SAMPLE_PROPOSED_RECIPES: RecipeSim[] = [
  { name: 'Ginger Scallion Noodles with Bok Choy', usesFridge: ['baby bok choy', 'scallions'] },
  { name: 'Spinach & Ricotta Stuffed Shells', usesFridge: ['ricotta', 'fresh basil'] },
  { name: 'Sheet-Pan Harissa Chicken Thighs', usesFridge: [] },
  { name: 'Crispy Black Bean & Avocado Tacos', usesFridge: [] },
];

export default function InteractiveGuidePage() {
  const [tab, setTab] = useState<Tab>('overview');

  // Simulator 1: Dinner & Slack
  const [simChef, setSimChef] = useState<'unclaimed' | 'daniela' | 'warren' | 'takeout'>('unclaimed');
  const [simRecipe, setSimRecipe] = useState<string | null>(null);
  const [simNotTonight, setSimNotTonight] = useState<string[]>([]);
  const [simPickupOwner, setSimPickupOwner] = useState<'unassigned' | 'daniela' | 'warren'>('unassigned');

  // Simulator 2: Warren's Saturday Recipe Agent Gate
  const [simBacklogCount, setSimBacklogCount] = useState<number>(2);
  const [simTargetMeals, setSimTargetMeals] = useState<number>(4);
  const [simOrderState, setSimOrderState] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // Simulator 3: Wesley's Greenlight Audit
  const [simReconciled, setSimReconciled] = useState(false);

  const keptCount = Math.max(0, simTargetMeals - simBacklogCount);
  const keptRecipes = SAMPLE_PROPOSED_RECIPES.slice(0, keptCount);
  const droppedRecipes = SAMPLE_PROPOSED_RECIPES.slice(keptCount);

  const toggleNotTonight = (who: string) => {
    setSimNotTonight((cur) => (cur.includes(who) ? cur.filter((x) => x !== who) : [...cur, who]));
  };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto', padding: '28px 28px 72px' }}>
        {/* Header */}
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 16,
            paddingBottom: 20,
            borderBottom: '1px solid var(--line)',
            marginBottom: 22,
          }}
        >
          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>
              Kitchen Command Center · User Guide
            </div>
            <h1 style={{ fontSize: '1.75rem', fontWeight: 800, marginTop: 4, letterSpacing: '-0.02em' }}>
              How Our Home Console Works
            </h1>
          </div>
          <div className="btn-row">
            <ThemeToggle defaultTheme="light" />
            <a href="/" className="btn primary" style={{ textDecoration: 'none' }}>
              ← Back to 24&quot; Kiosk Board
            </a>
          </div>
        </header>

        {/* Navigation Tabs */}
        <nav className="btn-row" style={{ marginBottom: 24 }}>
          {(
            [
              ['overview', 'Daily Rhythm & Voice'],
              ['dinner', '1. Dinner & Slack Sync'],
              ['recipes', "2. Warren's Saturday Cart Gate"],
              ['calendars', '3. Outlook + Google Calendars'],
              ['chores', "4. Wesley's Greenlight Chores"],
              ['cozyla', '5. Cozyla 24" Kiosk Setup'],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button key={id} className={`btn sm ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </nav>

        {/* TAB 0: OVERVIEW */}
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 20 }}>
            <div className="card">
              <div className="card-title">Daily &amp; Weekly Automation Schedule</div>
              {[
                [
                  '9:00 AM Daily',
                  'Morning Standup in #logistics',
                  'Posts merged Outlook + Google Calendar events, flags unowned pickups or meeting clashes, lists what is waiting in the fridge backlog, and prompts to claim tonight’s dinner.',
                ],
                [
                  '2:00 PM Daily',
                  'Unclaimed Dinner Nudge in #food',
                  'Only fires if dinner is still unclaimed at 2:00 PM. Pings both @Daniela and @Warren so dinner isn’t a 6:00 PM surprise.',
                ],
                [
                  'Thursday Evening',
                  'Warren’s Saturday Recipe Agent Gate in #food',
                  'Checks fridge_backlog first, scales down new meals by uncooked meals still in the fridge, removes duplicate perishables, adds household requests, and waits for a 👍 Approve click.',
                ],
                [
                  'Friday 6:00 PM',
                  'Wesley’s Greenlight Chore Audit',
                  'Sends a 7-day checklist summary of every chore Wesley tapped off on the kitchen board so you can reconcile in Greenlight before payout.',
                ],
              ].map(([when, title, desc]) => (
                <div key={title} className="row" style={{ alignItems: 'flex-start' }}>
                  <div className="row-main">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <div className="row-title">{title}</div>
                      <span className="badge">{when}</span>
                    </div>
                    <div className="row-meta" style={{ marginTop: 4, lineHeight: 1.45 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">Kitchen voice</div>
              <p className="row-meta" style={{ lineHeight: 1.45 }}>
                Open <strong>Kitchen voice</strong> in the bottom bar, or under <strong>More</strong> on a phone.
                You can talk by tapping the microphone or turn on <strong>Hey Kitchen</strong> for this device.
                With the family board open, say “Hey Kitchen”, wait for it to listen, then ask your question.
                You can ask follow-ups in the same conversation. Say “that’s all” to finish.
              </p>
              {[
                ['“What’s the weather today and tomorrow?”', 'Reads current temp + today/tomorrow forecast'],
                ['“Play NPR” / “Stop NPR”', 'Starts or stops live NPR audio on the console'],
                ['“Set a 12 minute pasta timer”', 'Starts a countdown that chimes and speaks when done'],
                ['“How much time is left?”', 'Checks the timers running on this console'],
                ['“Show me the school schedule”', 'Opens the family timeline with its school filter'],
                ['“What’s the next recipe step?”', 'Moves the dinner guide forward and reads the instruction'],
                ['“Warren is cooking the salmon tonight”', 'Claims dinner + links the salmon backlog item'],
                ['“I can’t cook tonight”', 'Marks you as “Not tonight” in Slack and on the wall'],
                ['“We cooked the lemon pasta”', 'Clears it from the fridge backlog'],
                ['“Daniela has the soccer pickup”', 'Assigns the pickup and clears the conflict banner'],
                ['“Check off make bed for Wesley”', 'Marks Wesley’s chore complete for today'],
              ].map(([cmd, desc]) => (
                <div key={cmd} className="row">
                  <div className="row-main">
                    <div className="row-title">{cmd}</div>
                    <div className="row-meta">{desc}</div>
                  </div>
                </div>
              ))}
              <p className="row-meta" style={{ marginTop: 12 }}>
                Ask to add items to the shared grocery list, then check <strong>Dinner Hub → Shared grocery list</strong> for the cart receipt. Warren handles checkout and delivery.
              </p>
            </div>
          </div>
        )}

        {/* TAB 1: DINNER & SLACK SIMULATOR */}
        {tab === 'dinner' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 20 }}>
            <div className="card">
              <div className="card-head">
                <span className="card-title">Interactive Slack Standup Preview</span>
                <span className="badge">Try clicking below</span>
              </div>

              <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
                <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>☀️ Good morning — Saturday, Nov 14</div>
                <div>
                  <div style={{ fontWeight: 700 }}>🍽️ Tonight&apos;s dinner</div>
                  <div style={{ marginTop: 4 }}>
                    {simChef === 'unclaimed' && 'Nobody has claimed dinner yet.'}
                    {simChef === 'daniela' && `👩‍🍳 Daniela is cooking ${simRecipe ?? 'tonight'}.`}
                    {simChef === 'warren' && `🧑‍🍳 Warren is cooking ${simRecipe ?? 'tonight'}.`}
                    {simChef === 'takeout' && '🥡 Takeout / fend for yourselves tonight.'}
                  </div>
                  {simNotTonight.length > 0 && (
                    <div className="row-meta" style={{ marginTop: 4 }}>
                      🙅 Not tonight: {simNotTonight.join(', ')}
                    </div>
                  )}
                </div>

                <div className="btn-row">
                  <button
                    className={`btn sm ${simChef === 'daniela' ? 'active' : ''}`}
                    onClick={() => setSimChef('daniela')}
                  >
                    🙋‍♀️ Daniela&apos;s cooking
                  </button>
                  <button
                    className={`btn sm ${simChef === 'warren' ? 'active' : ''}`}
                    onClick={() => setSimChef('warren')}
                  >
                    🧑‍🍳 Warren&apos;s cooking
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => {
                      if (simChef === 'unclaimed' || simChef === 'takeout') setSimChef('warren');
                      setSimRecipe('Miso Glazed Salmon (from fridge backlog)');
                    }}
                  >
                    🧊 Cook Salmon from Backlog
                  </button>
                  <button
                    className={`btn sm ${simChef === 'takeout' ? 'active' : ''}`}
                    onClick={() => {
                      setSimChef('takeout');
                      setSimRecipe(null);
                    }}
                  >
                    🥡 Takeout / fend
                  </button>
                </div>

                <div className="btn-row">
                  {['Daniela', 'Warren'].map((who) => (
                    <button
                      key={who}
                      className={`btn sm ${simNotTonight.includes(who) ? 'red' : 'ghost'}`}
                      onClick={() => toggleNotTonight(who)}
                    >
                      🙅 {who}: {simNotTonight.includes(who) ? 'can cook after all' : 'not tonight'}
                    </button>
                  ))}
                </div>

                <hr style={{ border: 'none', borderTop: '1px solid var(--line)' }} />

                <div>
                  <div style={{ fontWeight: 700 }}>🚗 Today&apos;s logistics</div>
                  <div className="row-meta" style={{ marginTop: 4 }}>
                    🚗 <strong>5:15 PM</strong> Pick up Wesley from soccer practice —{' '}
                    {simPickupOwner === 'unassigned'
                      ? '❓ needs an owner'
                      : `👤 ${simPickupOwner === 'daniela' ? 'Daniela' : 'Warren'}`}
                  </div>
                  <div className="btn-row" style={{ marginTop: 8 }}>
                    <button
                      className={`btn sm ${simPickupOwner === 'daniela' ? 'active' : ''}`}
                      onClick={() => setSimPickupOwner('daniela')}
                    >
                      Assign Daniela
                    </button>
                    <button
                      className={`btn sm ${simPickupOwner === 'warren' ? 'active' : ''}`}
                      onClick={() => setSimPickupOwner('warren')}
                    >
                      Assign Warren
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">How Slack &amp; the Wall Screen Stay in Sync</div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Two-Way Updates</div>
                  <div className="row-meta" style={{ lineHeight: 1.45 }}>
                    Clicking a button in Slack updates the 24&quot; wall screen via Supabase Realtime. Tapping a button
                    on the wall screen (or using voice) calls <code>chat.update</code> to refresh today&apos;s Slack
                    message so the buttons in Slack are never out of date.
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Working-Late Dinner Warnings</div>
                  <div className="row-meta" style={{ lineHeight: 1.45 }}>
                    If the person assigned to cook has a <code>late_office</code> calendar event past 6:00 PM, both
                    Slack and the wall screen highlight the conflict immediately.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: WARREN'S RECIPE AGENT GATE SIMULATOR */}
        {tab === 'recipes' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 20 }}>
            <div className="card">
              <div className="card-head">
                <span className="card-title">Saturday Cart Gate Simulator</span>
                <span className="badge">Interactive</span>
              </div>

              <div className="row">
                <div className="row-main">
                  <div className="row-title">Uncooked Meals Still in Fridge: {simBacklogCount}</div>
                  <div className="row-meta">Meals from last Saturday still sitting in fridge_backlog</div>
                </div>
                <div className="btn-row">
                  {[0, 1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      className={`btn sm ${simBacklogCount === n ? 'active' : ''}`}
                      onClick={() => {
                        setSimBacklogCount(n);
                        setSimOrderState('pending');
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row">
                <div className="row-main">
                  <div className="row-title">Target Weekly Meals: {simTargetMeals}</div>
                  <div className="row-meta">
                    New recipes allowed = {simTargetMeals} − {simBacklogCount} = <strong>{keptCount}</strong>
                  </div>
                </div>
                <div className="btn-row">
                  {[3, 4, 5].map((n) => (
                    <button
                      key={n}
                      className={`btn sm ${simTargetMeals === n ? 'active' : ''}`}
                      onClick={() => {
                        setSimTargetMeals(n);
                        setSimOrderState('pending');
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>Kept Recipes ({keptRecipes.length})</div>
                {keptRecipes.length === 0 && (
                  <div className="row-meta">
                    Fridge backlog is full — 0 new recipes kept (only household requests like paper towels are ordered).
                  </div>
                )}
                {keptRecipes.map((r) => (
                  <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: '0.95rem' }}>
                    <span>• <strong>{r.name}</strong></span>
                    {r.usesFridge.length > 0 && (
                      <span className="badge ok">Uses: {r.usesFridge.join(', ')}</span>
                    )}
                  </div>
                ))}

                {droppedRecipes.length > 0 && (
                  <div className="row-meta" style={{ marginTop: 4 }}>
                    Deferred to a later week: {droppedRecipes.map((r) => r.name).join(' · ')}
                  </div>
                )}

                <div className="btn-row" style={{ marginTop: 6 }}>
                  <button
                    className={`btn sm ${simOrderState === 'approved' ? 'green' : 'primary'}`}
                    onClick={() => setSimOrderState('approved')}
                  >
                    👍 Approve Saturday Order
                  </button>
                  <button
                    className={`btn sm ${simOrderState === 'rejected' ? 'red' : 'ghost'}`}
                    onClick={() => setSimOrderState('rejected')}
                  >
                    ✋ Hold Off
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">API Endpoints for Warren&apos;s Recipe Agent</div>
              <pre
                style={{
                  background: 'var(--card-2)',
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                  fontSize: '0.83rem',
                  overflowX: 'auto',
                  lineHeight: 1.5,
                }}
              >{`# 1. Read current fridge backlog + household list
GET /api/recipes/context
Authorization: Bearer $RECIPE_AGENT_API_KEY

# 2. Submit proposed Saturday cart (posts to #food)
POST /api/recipes/propose-cart
Authorization: Bearer $RECIPE_AGENT_API_KEY

# 3. Poll approval status before ordering
GET /api/recipes/proposals/:id`}</pre>
            </div>
          </div>
        )}

        {/* TAB 3: SPLIT CALENDARS */}
        {tab === 'calendars' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="card">
              <div className="card-title">Outlook + Google Calendar Rules</div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Automatic Event Tagging</div>
                  <div className="row-meta" style={{ lineHeight: 1.5 }}>
                    • <strong>🚗 pickup:</strong> pick up, drop off, carpool, bus, aftercare, camp, school run
                    <br />• <strong>🩺 appointment:</strong> dentist, doctor, pediatric, checkup, appointment, haircut
                    <br />• <strong>🏢 late_office:</strong> late office, working late, work dinner, client dinner, flight
                  </div>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Manual Assignments Never Get Overwritten</div>
                  <div className="row-meta" style={{ lineHeight: 1.5 }}>
                    When n8n re-syncs every 10 minutes, any parent assignment already set in Slack or on the wall
                    screen is preserved.
                  </div>
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">n8n Webhook Format</div>
              <pre
                style={{
                  background: 'var(--card-2)',
                  padding: 14,
                  borderRadius: 12,
                  border: '1px solid var(--line)',
                  fontSize: '0.83rem',
                  overflowX: 'auto',
                  lineHeight: 1.5,
                }}
              >{`POST /api/logistics/sync
Authorization: Bearer $SYNC_API_KEY

{
  "events": [
    {
      "external_event_id": "outlook:123",
      "source_calendar": "warren_outlook",
      "title": "Pick up Wesley from soccer",
      "start_time": "2026-11-14T17:15:00-05:00",
      "end_time": "2026-11-14T17:45:00-05:00"
    }
  ]
}`}</pre>
            </div>
          </div>
        )}

        {/* TAB 4: WESLEY'S GREENLIGHT CHORES */}
        {tab === 'chores' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="card">
              <div className="card-title">Friday 6:00 PM Greenlight Audit Preview</div>
              <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
                <div style={{ fontWeight: 700 }}>💰 Wesley&apos;s chores — Sat 11/8 to Fri 11/14 (18/21 done)</div>
                <div className="row-meta" style={{ lineHeight: 1.7 }}>
                  <strong>Mon 11/9:</strong> ✅ Make bed · ✅ Clear plate · ✅ Pack backpack
                  <br />
                  <strong>Tue 11/10:</strong> ✅ Make bed · ✅ Clear plate · ⬜ Take out recycling
                  <br />
                  <strong>Wed 11/11:</strong> ✅ Make bed · ✅ Clear plate · ✅ Pack backpack
                </div>
                <div>
                  {simReconciled ? (
                    <span className="badge ok">✅ Reconciled in Greenlight</span>
                  ) : (
                    <button className="btn sm primary" onClick={() => setSimReconciled(true)}>
                      ✅ Reconciled in Greenlight
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="card">
              <div className="card-title">Editing Wesley&apos;s Chore Templates</div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">wesley_chore_templates Table in Supabase</div>
                  <div className="row-meta" style={{ lineHeight: 1.5 }}>
                    Add or edit chores in Supabase&apos;s table editor and set <code>days_of_week</code> (0=Sun … 6=Sat).
                    The board automatically populates Wesley&apos;s daily tiles each morning.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: COZYLA 24" SETUP */}
        {tab === 'cozyla' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div className="card">
              <div className="card-title">Fully Kiosk Browser Setup on the Cozyla 24&quot;</div>
              {[
                ['1. Start URL', 'https://YOUR-VERCEL-DOMAIN.vercel.app/?key=YOUR_KIOSK_ACCESS_TOKEN'],
                ['2. Kiosk Mode + Launch on Boot', 'Locks the 24" screen to your web app 24/7.'],
                ['3. Web Autoplay + Microphone + JS Interface', 'Enables voice, NPR streaming, spoken timer alerts, and night dimming.'],
                ['4. Front-Camera Motion Wake', 'Wakes the screen when someone walks within 5–8 ft.'],
              ].map(([title, desc]) => (
                <div key={title} className="row">
                  <div className="row-main">
                    <div className="row-title">{title}</div>
                    <div className="row-meta">{desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="card">
              <div className="card-title">Wall Power Options (Non-Recessed Outlet)</div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Option A: $15 1-Gang Recessed Outlet Box</div>
                  <div className="row-meta">Tucks the Cozyla power brick inside the wall so the 24&quot; frame mounts flush.</div>
                </div>
              </div>
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Option B: Paintable DC Cord Channel</div>
                  <div className="row-meta">Routes the thin low-voltage DC lead cleanly to an adjacent outlet.</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
