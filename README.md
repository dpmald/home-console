# Home Console — Kitchen Command Center

Unified **24" Cozyla wall console** + **Slack-first home organization** for **Daniela, Warren, and Wesley**.

On iPhone, open the family kitchen in Safari and use **Share → Add to Home Screen**. Enable **Open as Web App** if offered. The phone uses the same site and household data as the wall display. Use **Today**, **Dinner**, and **Family** in the bottom bar. **More** opens the other kitchen controls.

The [Beta kitchen](docs/BETA-DEVELOPMENT.md) runs the shared board and experimental grocery list against its own database. The family display links to Beta.

See [testing and PR checks](docs/TESTING.md) for unit, database and browser coverage. For the grocery connector, see the [implementation plan](docs/GROCERY-FLOW-PLAN.md) and [local development guide](docs/LOCAL-DEVELOPMENT.md).

---

## Architecture Overview

| Layer | File(s) | What it does |
|---|---|---|
| **Database + Realtime** | [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), [`supabase/seed.sql`](supabase/seed.sql) | Postgres tables (`dinner_schedule`, `fridge_backlog`, `wesley_chores`, `wesley_chore_templates`, `family_logistics`, `grocery_items`, `cart_proposals`, `bot_runs`) with RLS locked down and a Postgres trigger that broadcasts instant change pings to the wall screen. |
| **Shared Domain Logic** | [`lib/domain.ts`](lib/domain.ts), [`lib/cart.ts`](lib/cart.ts), [`lib/time.ts`](lib/time.ts) | Single source of truth used by Slack, the Cozyla touchscreen, voice, and crons so every surface stays in sync. |
| **Slack Block Kit + Sync** | [`lib/slack/blocks.ts`](lib/slack/blocks.ts), [`lib/slack/sync.ts`](lib/slack/sync.ts), [`app/api/slack/interactions/route.ts`](app/api/slack/interactions/route.ts) | Signature-verified webhook (`<300 ms` ack via Next.js `after()`), two-way message refresh whenever the wall screen or voice updates dinner/logistics. |
| **Automated Workflows (Crons)** | [`app/api/cron/daily-standup/route.ts`](app/api/cron/daily-standup/route.ts), [`app/api/cron/dinner-nudge/route.ts`](app/api/cron/dinner-nudge/route.ts), [`app/api/cron/greenlight-audit/route.ts`](app/api/cron/greenlight-audit/route.ts), [`vercel.json`](vercel.json) | 9 AM daily standup, 2 PM unclaimed-dinner nudge, and Friday 6 PM Greenlight chore audit (DST-safe + idempotent via `bot_runs`). |
| **Pickup Nudge (#calendar)** | [`app/api/cron/pickup-nudge/route.ts`](app/api/cron/pickup-nudge/route.ts), [`lib/pickups.ts`](lib/pickups.ts) | 2 PM: if any of today's school pickups is unclaimed, @-mentions Daniela + Warren in `#calendar` with claim buttons. Polled every 10 min by n8n (2–7 PM) to read thread replies ("I've got it", "I'll get Wesley", "Warren has both") and claim them; one follow-up ping at 4 PM if anything is still open. |
| **Warren's Recipe Agent Gate** | [`app/api/recipes/context/route.ts`](app/api/recipes/context/route.ts), [`app/api/recipes/propose-cart/route.ts`](app/api/recipes/propose-cart/route.ts), [`app/api/recipes/proposals/[id]/route.ts`](app/api/recipes/proposals/[id]/route.ts) | Reads `fridge_backlog`, prioritizes recipes that use existing perishables, scales recipe count down by uncooked meals, deduplicates ingredients, folds in household requests, and gates ordering behind a Slack **Approve / Hold** button. |
| **Outlook + Google Calendar Sync** | [`app/api/logistics/sync/route.ts`](app/api/logistics/sync/route.ts) | Webhook for n8n/Make that merges Warren's Outlook + Daniela's Google Calendar, auto-classifies `pickup` / `appointment` / `late_office`, and preserves manual parent assignments. |
| **24" Cozyla Touchscreen UI + Voice + NPR** | [`app/page.tsx`](app/page.tsx), [`components/KioskBoard.tsx`](components/KioskBoard.tsx), [`components/VoiceOrb.tsx`](components/VoiceOrb.tsx), [`app/api/voice/session/route.ts`](app/api/voice/session/route.ts), [`app/api/voice/tool/route.ts`](app/api/voice/tool/route.ts) | Landscape 1080p/QHD dark board with one-tap dinner claim, `"not tonight"` toggles, aging fridge backlog badges, pickup assignment buttons, Wesley's chore tiles, multi-timer chime, NPR live stream, and WebRTC OpenAI Realtime voice assistant. |

---

## Quick Setup

### 1. Supabase
1. Create a new Supabase project and open the **SQL Editor**.
2. Paste and run [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql), then [`supabase/seed.sql`](supabase/seed.sql).
3. Copy the **Project URL**, **anon public** key, and **service_role** key into `.env.local` (from [`.env.example`](.env.example)).

### 2. Slack App
1. Go to `https://api.slack.com/apps` → **Create New App** → **From an app manifest** and paste [`slack-app-manifest.yaml`](slack-app-manifest.yaml) (replace `YOUR-VERCEL-DOMAIN`).
2. Install to your workspace and copy **Bot User OAuth Token** (`SLACK_BOT_TOKEN`) and **Signing Secret** (`SLACK_SIGNING_SECRET`).
3. Invite `@antigravity` to `#logistics`, `#food`, and `#calendar`.
4. Copy Daniela's and Warren's Slack Member IDs into `SLACK_USER_DANIELA` and `SLACK_USER_WARREN`.

### Shared household grocery requests

Open **Dinner Hub → Shared grocery list** on the family display, or **Groceries** on Beta. Unlock the browser once, then enter an item and quantity. The worker checks every two minutes while Legion is awake, signed in and online. **Pending** means the list accepted the request. **In cart** shows the product and package count Instacart confirmed at the selected store. Recipe preferences apply to meals Claude picks. Warren checks out in Instacart. See [Beta device access and configuration](docs/BETA-DEVELOPMENT.md) and [worker setup](scripts/grocery-cart-poller/README.md).

### Talk to the kitchen

Open **Kitchen voice** on the family board (under **More** on a phone). Tap **Talk** for one conversation, or enable **Hands-free wake** on that device. Allow microphone access, keep the board in the foreground, and say **“Hey Kitchen.”** Wait for the listening tone or the **Listening** indicator before asking. You can interrupt, ask follow-up questions, or type in the same conversation. Say **“That’s all”** or tap **End conversation** to return to standby. To switch off standby listening, turn off **Hands-free wake**.

Try “What’s on our calendar tomorrow?”, “Who can cook tonight?”, or “Set a ten-minute pasta timer.” Then ask “How much time is left?” The assistant can use the screen you’re looking at, current household records and the console’s connected controls. Grocery requests use the shared list and its existing cart workflow. Warren handles checkout.

To leave a development note, wake Kitchen, wait for the tone, then say **“Log a bug for Gemini. The Dinner button disappears when I rotate the screen.”** You can also say **“Feature request for Codex. Let me give each timer its own chime.”** Kitchen reads the note back and asks before posting. The Home Console bot adds one searchable message to the Slack backlog in **#home-console**, labeled **Bug** or **Feature request** and **Gemini (Daniela)** or **Codex (Warren)**. A successful reply confirms that Slack accepted the post for later triage.

The Cozyla uses its existing kitchen login. The family server posts with `SLACK_BOT_TOKEN`. To use a different backlog channel, set `SLACK_CHANNEL_BACKLOG` to its Slack channel ID and give the Home Console bot access there.

The wake detector runs locally while this board is visible. The first enable downloads its acoustic model and browser runtime from the console. Hiding the page releases the microphone. Only the hands-free preference is saved by the voice UI. Starting a conversation sends the conversation and the household information needed for requested tools to OpenAI. The authenticated family deployment needs a server-side `OPENAI_API_KEY` with Realtime access. `OPENAI_REALTIME_MODEL` and `OPENAI_REALTIME_VOICE` select the model and voice. Voice grocery forwarding also needs the shared grocery configuration documented in [.env.example](.env.example). The isolated Beta site keeps its existing integration restrictions.

### 3. Warren's Saturday Recipe Agent
- **Before picking recipes (optional):**
  `GET /api/recipes/context` with `Authorization: Bearer $RECIPE_AGENT_API_KEY` → returns current `fridge_backlog` + `household_requests`.
- **Instead of checking out directly:**
  `POST /api/recipes/propose-cart` with:
  ```json
  {
    "target_meal_count": 4,
    "recipes": [
      {
        "name": "Miso Glazed Salmon",
        "perishables": ["salmon", "scallions", "bok choy"],
        "ingredients": [
          { "name": "salmon fillets", "quantity": "1.5 lb" },
          { "name": "scallions", "quantity": "1 bunch" },
          { "name": "bok choy", "quantity": "2 heads" }
        ]
      }
    ]
  }
  ```
- Poll `GET /api/recipes/proposals/:id` (or set `RECIPE_AGENT_CALLBACK_URL`) to observe the meal proposal decision. Warren handles checkout.

### 4. n8n Calendar Bridge (Warren's Outlook + Daniela's Google Calendar)
Create an n8n workflow running every 10 minutes:
1. **Microsoft Outlook node** → get events for the next 7 days → map each to `{ external_event_id: "outlook:" + id, source_calendar: "warren_outlook", title: subject, start_time: start.dateTime, end_time: end.dateTime }`.
2. **Google Calendar node** (work + personal) → get events for the next 7 days → map each to `{ external_event_id: "gcal:" + id, source_calendar: "daniela_google", title: summary, start_time: start.dateTime || start.date, end_time: end.dateTime || end.date }`.
3. **HTTP Request node** → `POST https://YOUR-VERCEL-DOMAIN.vercel.app/api/logistics/sync` with header `Authorization: Bearer $SYNC_API_KEY` and body `{ "events": [...] }`.

### 5. Cozyla Calendar+ 24" Wall Console (Full Kiosk Takeover)
Instead of using Cozyla's stock calendar launcher, the console runs **Fully Kiosk Browser** in single-app takeover mode so your Next.js app *is* the operating interface 24/7. The app natively integrates with Fully Kiosk's Android JavaScript bridge (`window.fully` in [`lib/cozyla.ts`](lib/cozyla.ts)):

1. **Install & Lock to Single-App Mode:**
   - Open Google Play on the Cozyla Calendar+ and install **Fully Kiosk Browser & Lockdown**.
   - **Web Content Settings → Start URL:** `https://YOUR-VERCEL-DOMAIN.vercel.app/?key=YOUR_KIOSK_ACCESS_TOKEN` (authenticates the Cozyla with a 1-year HttpOnly cookie and strips `?key=` from the URL).
   - **Kiosk Mode (Plus) → Enable Kiosk Mode:** `ON` (set a 4-digit PIN, e.g., `1234`, and enable **Launch on Boot** + **Disable Home/Status/Navigation Bars** so the Cozyla boots straight into your Kitchen Command Center after any power cycle).
2. **Enable Hardware Permissions (Mic, Speakers, Camera, JS Bridge):**
   - **Web Content Settings → Enable Autoplay:** `ON` and **Audio / Video Capture (Microphone):** `Allow` (lets the Cozyla's far-field mic array and dual 5W speakers stream OpenAI Realtime WebRTC voice, NPR, and timer chimes without popups).
   - **Advanced Web Settings → Enable JavaScript Interface:** `ON` (exposes `window.fully` so the web app can wake the screen and speak timer alerts via Android TTS when a timer finishes, and auto-dim the 24" panel to `25/255` brightness between 10:00 PM and 6:00 AM).
3. **Front-Camera Walk-Up Wake & Burn-In Prevention:**
   - **Motion Detection (Plus) → Enable Visual Motion Detection:** `ON` and **Turn Screen On on Motion:** `ON` (wakes the 24" display as soon as someone walks within 5–8 ft of the kitchen wall, triggering `window.onFullyMotion()` in [`lib/cozyla.ts`](lib/cozyla.ts) to refresh live state).
   - **Device Management → Keep Screen On:** `ON` (or set **Screen Off Timer** to `15 minutes` of no motion so the screen sleeps when the kitchen is empty and wakes instantly when you walk in).
