'use client';
import { useState } from 'react';

type Tab = 'overview' | 'dinner' | 'recipes' | 'calendars' | 'chores' | 'cozyla';

interface RecipeSim {
  name: string;
  perishables: string[];
  usesFridge: string[];
}

const SAMPLE_PROPOSED_RECIPES: RecipeSim[] = [
  { name: 'Ginger Scallion Noodles with Bok Choy', perishables: ['bok choy', 'scallions', 'fresh ginger'], usesFridge: ['baby bok choy', 'scallions'] },
  { name: 'Spinach & Ricotta Stuffed Shells', perishables: ['ricotta', 'fresh basil', 'spinach'], usesFridge: ['ricotta', 'fresh basil'] },
  { name: 'Sheet-Pan Harissa Chicken Thighs', perishables: ['chicken thighs', 'cauliflower'], usesFridge: [] },
  { name: 'Crispy Black Bean & Avocado Tacos', perishables: ['avocados', 'cilantro', 'limes'], usesFridge: [] },
];

export default function InteractiveGuidePage() {
  const [tab, setTab] = useState<Tab>('overview');

  // Interactive simulator 1: 9 AM / 2 PM Slack Standup & Dinner Claim
  const [simChef, setSimChef] = useState<'unclaimed' | 'daniela' | 'warren' | 'takeout'>('unclaimed');
  const [simRecipe, setSimRecipe] = useState<string | null>(null);
  const [simNotTonight, setSimNotTonight] = useState<string[]>([]);
  const [simPickupOwner, setSimPickupOwner] = useState<'unassigned' | 'daniela' | 'warren'>('unassigned');

  // Interactive simulator 2: Warren's Saturday Recipe Agent Gate
  const [simBacklogCount, setSimBacklogCount] = useState<number>(2);
  const [simTargetMeals, setSimTargetMeals] = useState<number>(4);
  const [simOrderState, setSimOrderState] = useState<'pending' | 'approved' | 'rejected'>('pending');

  // Interactive simulator 3: Wesley's Greenlight Audit
  const [simReconciled, setSimReconciled] = useState(false);

  const keptCount = Math.max(0, simTargetMeals - simBacklogCount);
  const keptRecipes = SAMPLE_PROPOSED_RECIPES.slice(0, keptCount);
  const droppedRecipes = SAMPLE_PROPOSED_RECIPES.slice(keptCount);

  const toggleNotTonight = (who: string) => {
    setSimNotTonight((cur) => (cur.includes(who) ? cur.filter((x) => x !== who) : [...cur, who]));
  };

  return (
    <div style={{ height: '100vh', overflowY: 'auto', padding: '24px 32px 60px', background: 'var(--bg)' }}>
      {/* Header */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          padding: '16px 22px',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 18,
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: '1.6rem', fontWeight: 800 }}>
            📖 Home Console — Interactive Family Manual &amp; Simulator
          </h1>
          <p style={{ color: 'var(--muted)', fontSize: '0.96rem', marginTop: 4 }}>
            How Daniela, Warren &amp; Wesley use the 24&quot; Cozyla Wall Console + Slackbot every day
          </p>
        </div>
        <div className="btn-row">
          <a href="/" className="btn primary">
            🖥️ Open Live 24&quot; Kiosk Board
          </a>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="btn-row" style={{ marginBottom: 20 }}>
        {(
          [
            ['overview', '🗺️ System Map & Daily Rhythm'],
            ['dinner', '🍽️ 1. Dinner & Slack Simulator'],
            ['recipes', "🛒 2. Warren's Recipe Gate Simulator"],
            ['calendars', '🚗 3. Split Calendars & Pickups'],
            ['chores', "⭐ 4. Wesley's Greenlight Audit"],
            ['cozyla', '📺 5. Cozyla 24" Full Kiosk Setup'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button key={id} className={`btn ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>

      {/* TAB 0: OVERVIEW */}
      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: 18 }}>
          <div className="card">
            <div className="card-title">⏰ Your Automated Weekly &amp; Daily Rhythm</div>
            <div className=" row" style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">☀️ Every Morning at 9:00 AM — Daily Standup in #logistics</div>
                <div className="row-meta">
                  Posts today&apos;s merged Outlook + Google Calendar logistics, flags any unowned pickups or meeting
                  clashes, lists what&apos;s aging in the fridge backlog, and asks who&apos;s cooking tonight.
                </div>
              </div>
              <span className="badge">/api/cron/daily-standup</span>
            </div>

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">⏰ Every Afternoon at 2:00 PM — Unclaimed Dinner Nudge in #food</div>
                <div className="row-meta">
                  Only fires if nobody has claimed dinner by 2:00 PM. Pings both @Daniela and @Warren so Daniela never
                  has to default to taking over at 6:00 PM.
                </div>
              </div>
              <span className="badge warn">/api/cron/dinner-nudge</span>
            </div>

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">🛒 Thursday Evening — Warren&apos;s Saturday Recipe Agent Gate in #food</div>
                <div className="row-meta">
                  Warren&apos;s agent checks the fridge backlog first, scales down new meals if prior meals are still
                  uncooked, drops duplicate perishables, adds household requests (&ldquo;paper towels&rdquo;), and
                  waits for a 👍 Approve click before ordering.
                </div>
              </div>
              <span className="badge">/api/recipes/propose-cart</span>
            </div>

            <div className="row" style={{ alignItems: 'flex-start' }}>
              <div className="row-main">
                <div className="row-title">💰 Friday at 6:00 PM — Wesley&apos;s Greenlight Chore Audit</div>
                <div className="row-meta">
                  Summarizes every chore Wesley tapped off on the kitchen wall screen all week so you can reconcile in
                  the Greenlight app before allowance payout.
                </div>
              </div>
              <span className="badge ok">/api/cron/greenlight-audit</span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">🎙️ Voice Commands You Can Shout from 5–8 ft Away</div>
            <p className="row-meta">
              Tap <strong>🎙️ Ask Kitchen</strong> on the Cozyla top bar and speak naturally. The assistant automatically
              disconnects when you say &ldquo;thanks&rdquo; or after 90 seconds of silence.
            </p>
            {[
              ['“What’s the weather today and tomorrow?”', 'Reads live Open-Meteo temp + rain forecast'],
              ['“Play NPR” / “Stop NPR”', 'Starts/stops your live NPR station stream on the 5W speakers'],
              ['“Set a 12 minute pasta timer”', 'Adds a live countdown timer that chimes & speaks when done'],
              ['“Warren is cooking the salmon tonight”', 'Claims dinner for Warren + links the salmon backlog kit + updates Slack'],
              ['“I can’t cook tonight”', 'Marks you as “Not tonight” on both the wall board and Slack'],
              ['“Add paper towels to the shopping cart”', 'Adds to Next Grocery Order (auto-merged into Saturday cart)'],
              ['“We cooked the lemon pasta”', 'Clears it from fridge_backlog so Saturday’s agent knows'],
              ['“Daniela has the soccer pickup”', 'Assigns the pickup and clears the ⚠️ conflict banner'],
              ['“Check off make bed for Wesley”', 'Marks Wesley’s chore complete for today'],
            ].map(([cmd, desc]) => (
              <div key={cmd} className="row">
                <div className="row-main">
                  <div className="row-title" style={{ color: '#bae6fd' }}>{cmd}</div>
                  <div className="row-meta">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 1: DINNER & SLACK SIMULATOR */}
      {tab === 'dinner' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title">💬 Simulated Slack Message (#logistics / #food)</span>
              <span className="badge">Interactive Preview</span>
            </div>
            <p className="row-meta">
              Click any button below to see how the Slack Block Kit card and the Kitchen Wall Screen stay in sync in
              real time:
            </p>

            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 12 }}>
              <div style={{ fontWeight: 700, fontSize: '1.08rem' }}>☀️ Good morning — Saturday, Nov 14</div>
              <div>
                <div style={{ fontWeight: 700 }}>🍽️ Tonight&apos;s dinner</div>
                <div style={{ marginTop: 4 }}>
                  {simChef === 'unclaimed' && '❓ Nobody has claimed dinner yet.'}
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

              <hr style={{ borderColor: 'var(--line)' }} />

              <div>
                <div style={{ fontWeight: 700 }}>🚗 Today&apos;s logistics</div>
                <div className="row-meta" style={{ marginTop: 4 }}>
                  🚗 <strong>5:15 PM</strong> Pick up Wesley from soccer practice —{' '}
                  {simPickupOwner === 'unassigned' ? '❓ needs an owner' : `👤 ${simPickupOwner === 'daniela' ? 'Daniela' : 'Warren'}`}
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
            <div className="card-title">🔄 What Happens Behind the Scenes</div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">1. Sub-300ms Slack Ack (No Timeout Errors)</div>
                <div className="row-meta">
                  <code>/api/slack/interactions</code> verifies Slack&apos;s HMAC signature, writes to Supabase
                  immediately, and uses Next.js <code>after()</code> to re-render the Slack message in the background so
                  Slack never hits its 3,000ms timeout.
                </div>
              </div>
            </div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">2. Instant Push to the 24&quot; Cozyla Wall Screen</div>
                <div className="row-meta">
                  A Postgres trigger on <code>dinner_schedule</code> and <code>family_logistics</code> broadcasts a
                  change ping on the <code>kitchen</code> Realtime channel, updating the wall console in milliseconds.
                </div>
              </div>
            </div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">3. Late-Office Clash Detection</div>
                <div className="row-meta">
                  Notice in the simulator: if you pick <strong>Warren&apos;s cooking</strong> while Warren has a{' '}
                  <code>late_office</code> event until 7:30 PM on his Outlook calendar, the board automatically raises a
                  ⚠️ warning banner: <em>&ldquo;Warren is on dinner but has Late office until 7:30 PM&rdquo;</em>.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: WARREN'S RECIPE AGENT GATE SIMULATOR */}
      {tab === 'recipes' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 0.95fr', gap: 18 }}>
          <div className="card">
            <div className="card-head">
              <span className="card-title">🧪 Interactive Smart Cart Gate Simulator</span>
              <span className="badge">Try Adjusting Sliders</span>
            </div>

            <div className="row">
              <div className="row-main">
                <div className="row-title">
                  🧊 Uncooked Meals Still in Fridge Backlog: <strong>{simBacklogCount}</strong>
                </div>
                <div className="row-meta">
                  Simulate how many meals from last Saturday are still sitting in <code>fridge_backlog</code>:
                </div>
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
                <div className="row-title">
                  🎯 Target Weekly Meals from Warren&apos;s Agent: <strong>{simTargetMeals}</strong>
                </div>
                <div className="row-meta">
                  Formula: <code>kept_recipes = max(0, target_meal_count - in_fridge_count)</code> ={' '}
                  <strong>{keptCount} new recipes allowed</strong>
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
                    {n} meals
                  </button>
                ))}
              </div>
            </div>

            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ fontWeight: 700 }}>
                ✅ Kept Recipes ({keptRecipes.length}) — Ranked by Fridge Perishable Overlap First
              </div>
              {keptRecipes.length === 0 && (
                <div className="row-meta">
                  Fridge is full! 0 new recipes kept — only household essentials (e.g. paper towels) will be ordered.
                </div>
              )}
              {keptRecipes.map((r) => (
                <div key={r.name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.95rem' }}>
                  <span>• <strong>{r.name}</strong></span>
                  {r.usesFridge.length > 0 && (
                    <span className="badge ok">Uses fridge: {r.usesFridge.join(', ')}</span>
                  )}
                </div>
              ))}

              {droppedRecipes.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, marginTop: 6, color: 'var(--muted)' }}>
                    ⏸️ Automatically Deferred to Next Week ({droppedRecipes.length})
                  </div>
                  <div className="row-meta">{droppedRecipes.map((r) => r.name).join(' · ')}</div>
                </>
              )}

              <div className="btn-row" style={{ marginTop: 8 }}>
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
                  ✋ Hold Off This Week
                </button>
              </div>
              {simOrderState !== 'pending' && (
                <div className="row-meta">
                  {simOrderState === 'approved'
                    ? '✅ Approved! Kept recipes are added to fridge_backlog for Saturday and the agent is unlocked to checkout.'
                    : '✋ Held! The agent receives status="rejected" and will not place the grocery order.'}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">🔌 Drop-In Snippet for Warren&apos;s Recipe Agent</div>
            <p className="row-meta">
              Warren can wire his existing recipe script to the console with two HTTP calls:
            </p>
            <pre
              style={{
                background: 'var(--bg)',
                padding: 14,
                borderRadius: 12,
                border: '1px solid var(--line)',
                fontSize: '0.84rem',
                overflowX: 'auto',
                lineHeight: 1.45,
              }}
            >{`# 1. Before picking recipes: inspect fridge backlog + household list
curl -H "Authorization: Bearer $RECIPE_AGENT_API_KEY" \\
  https://YOUR-APP.vercel.app/api/recipes/context

# 2. Propose Saturday cart (scales & posts to #food for approval)
curl -X POST https://YOUR-APP.vercel.app/api/recipes/propose-cart \\
  -H "Authorization: Bearer $RECIPE_AGENT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "target_meal_count": 4,
    "recipes": [
      {
        "name": "Miso Glazed Salmon",
        "perishables": ["salmon", "bok choy", "scallions"],
        "ingredients": [
          { "name": "salmon fillets", "quantity": "1.5 lb" },
          { "name": "bok choy", "quantity": "2 heads" }
        ]
      }
    ]
  }'`}</pre>
          </div>
        </div>
      )}

      {/* TAB 3: SPLIT CALENDARS */}
      {tab === 'calendars' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div className="card">
            <div className="card-title">🔄 Bridging Warren&apos;s Outlook + Daniela&apos;s Google Calendar</div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">Auto-Classification Rules (/api/logistics/sync)</div>
                <div className="row-meta">
                  Every event pushed from n8n/Make is automatically tagged:
                  <br />• <strong>🚗 pickup:</strong> contains <em>pick up, drop off, carpool, bus, aftercare, camp, school run, Wesley from/to</em> → defaults to <code>unassigned</code> until claimed
                  <br />• <strong>🩺 appointment:</strong> contains <em>dentist, doctor, orthodont, pediatric, checkup, appointment, therapy, haircut</em>
                  <br />• <strong>🏢 late_office:</strong> contains <em>late office, working late, work dinner, client dinner, offsite, flight</em> (or office event ending after 6:00 PM)
                </div>
              </div>
            </div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">Assignments Stick Across Calendar Re-Syncs</div>
                <div className="row-meta">
                  Once Daniela or Warren claims a pickup in Slack or on the wall screen, subsequent 10-minute n8n
                  calendar syncs update times/titles without ever overwriting <code>assigned_parent</code>.
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">📡 Sample n8n Webhook Payload</div>
            <pre
              style={{
                background: 'var(--bg)',
                padding: 14,
                borderRadius: 12,
                border: '1px solid var(--line)',
                fontSize: '0.84rem',
                overflowX: 'auto',
                lineHeight: 1.45,
              }}
            >{`POST /api/logistics/sync
Authorization: Bearer $SYNC_API_KEY

{
  "events": [
    {
      "external_event_id": "outlook:AAMkAD...",
      "source_calendar": "warren_outlook",
      "title": "Pick up Wesley from soccer practice",
      "start_time": "2026-11-14T17:15:00-05:00",
      "end_time": "2026-11-14T17:45:00-05:00"
    },
    {
      "external_event_id": "gcal:98234abc",
      "source_calendar": "daniela_google",
      "title": "Wesley Pediatric Dentist Checkup",
      "start_time": "2026-11-14T15:30:00-05:00",
      "end_time": "2026-11-14T16:30:00-05:00"
    }
  ]
}`}</pre>
          </div>
        </div>
      )}

      {/* TAB 4: WESLEY'S GREENLIGHT CHORES */}
      {tab === 'chores' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div className="card">
            <div className="card-title">💰 Simulated Friday 6:00 PM Greenlight Audit Card</div>
            <div className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: '1.08rem' }}>
                💰 Wesley&apos;s chores — Sat 11/8 to Fri 11/14
              </div>
              <div>
                <strong>18/21</strong> chores checked off on the kitchen board this week.
              </div>
              <div className="row-meta" style={{ lineHeight: 1.7 }}>
                <strong>Mon 11/9</strong> ✅ Make bed · ✅ Clear plate · ✅ Pack backpack
                <br />
                <strong>Tue 11/10</strong> ✅ Make bed · ✅ Clear plate · ⬜ Take out recycling
                <br />
                <strong>Wed 11/11</strong> ✅ Make bed · ✅ Clear plate · ✅ Pack backpack
                <br />
                <strong>Thu 11/12</strong> ✅ Make bed · ⬜ Clear plate · ✅ Pack backpack
                <br />
                <strong>Fri 11/13</strong> ✅ Make bed · ✅ Clear plate · ✅ Pack backpack
              </div>
              <div>
                {simReconciled ? (
                  <span className="badge ok">✅ Reconciled in Greenlight — week locked</span>
                ) : (
                  <button className="btn sm primary" onClick={() => setSimReconciled(true)}>
                    ✅ Reconciled in Greenlight
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">🧹 Customizing Wesley&apos;s Chores</div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">Edit in Supabase Table Editor (Spreadsheet View)</div>
                <div className="row-meta">
                  Open the <code>wesley_chore_templates</code> table in Supabase to add/edit chores or change{' '}
                  <code>days_of_week</code> (<code>0</code> = Sun … <code>6</code> = Sat). Each morning, the board
                  automatically generates that day&apos;s tiles for Wesley.
                </div>
              </div>
            </div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">Tamper-Safe After Payout Reconciliation</div>
                <div className="row-meta">
                  Once you tap <strong>✅ Reconciled in Greenlight</strong> in Slack, those rows are marked{' '}
                  <code>verified_in_greenlight = true</code> so past days can&apos;t be accidentally untoggled.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: COZYLA 24" SETUP */}
      {tab === 'cozyla' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div className="card">
            <div className="card-title">📺 Cozyla Calendar+ 24&quot; — Full Kiosk Takeover Checklist</div>
            {[
              ['1. Install Fully Kiosk Browser', 'Install from Google Play on the Cozyla Calendar+ 24".'],
              ['2. Set Start URL', 'https://YOUR-VERCEL-DOMAIN.vercel.app/?key=YOUR_KIOSK_ACCESS_TOKEN (sets a 1-year cookie & strips ?key).'],
              ['3. Enable Kiosk Mode + Launch on Boot', 'Locks the 24" touchscreen to your app 24/7 and boots straight into it after power outages.'],
              ['4. Enable Autoplay + Microphone + JS Interface', 'Powers WebRTC far-field voice ("Ask Kitchen"), NPR streaming, spoken timer alerts, and auto night-dimming (10 PM–6 AM).'],
              ['5. Enable Front-Camera Motion Detection', 'Turns the 24" screen on and calls window.onFullyMotion() to refresh data as soon as you walk within 5–8 ft.'],
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
            <div className="card-title">🔌 Non-Recessed Wall Outlet Options</div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">Option A: $15 1-Gang Recessed Outlet Box (Flush Mount)</div>
                <div className="row-meta">
                  Swap the existing receptacle behind the Echo Show with an Arlington DVFR1W-1 recessed box so the
                  Cozyla power brick tucks completely inside the wall cavity and the 24&quot; frame sits dead-flush.
                </div>
              </div>
            </div>
            <div className="row">
              <div className="row-main">
                <div className="row-title">Option B: Thin DC Cord Channel</div>
                <div className="row-meta">
                  Keep the existing outlet and route the thin low-voltage DC cable down to the counter/adjacent outlet
                  inside a paintable cord cover.
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
