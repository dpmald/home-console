# The Beta kitchen

Beta runs the same kitchen board as the family display, with its own database, device access settings and Claude credential. Use **Groceries** in the kitchen dock to open Saturday’s list. **Back to Beta** returns to the full board. **Back to kitchen** leaves Beta.

| Where you open the kitchen | Where edits go | Who reads the list |
| --- | --- | --- |
| Local private preview on port 3001 | Local copy of household data | Normal preview |
| Local Beta on port 3005 | Legion’s isolated Beta database | Local development tools |
| [Hosted Beta](https://home-console-beta.vercel.app/beta) | Dedicated hosted Beta database | The Home Console Beta connector in Claude |

Use [hosted groceries](https://home-console-beta.vercel.app/beta/groceries) for items Claude should pick up with Legion asleep or off. Local fixtures and earlier simulated receipts stay on Legion. The shared board starts with the repository’s chore templates. Kitchen state is initialized in Beta as needed. No production data import is scheduled.

## Claude and device access

- Add a custom connector named **Home Console Beta** with the URL `https://home-console-beta.vercel.app/api/mcp`. Choose API key or header authentication. Add the **Authorization** request header with the value `Bearer <the Beta connector key>`, including one space. The MCP endpoint exposes `list_pending` and `record_request_progress`.
- While hosted Beta is public, anyone with its URL can view and edit its kitchen and grocery list. The Cozyla can open it directly. Local previews still use their own access settings.
- On Warren’s Windows account, the local helper `%LOCALAPPDATA%\HomeConsole\HostedBeta\Copy-ClaudeHeader.ps1` copies the complete header value. Paste it directly into Claude’s connector settings.
- Attach the connector to the intended Claude task in its connector settings. Creating a connector at the account level does not establish that an existing scheduled task has it. For a first read, ask Claude to call `list_pending` with a fresh run ID and report the names and quantities only. That call records a snapshot. The menu, Instacart cart, checkout and task schedule are separate operations.
- Supabase holds groceries and their run receipts. Claude authenticates separately to the MCP endpoint. The database key stays on the server.

## Local development

Use `codex/beta-area`. Install dependencies with `npm ci`. On a fresh machine, `npm run db:groceries` creates the isolated development database. On Legion the existing database and agent receipts are reused. `npm run dev:beta` verifies the labelled Docker database at `127.0.0.1:55432/home_console_grocery_dev`, starts its dedicated PostgREST service on loopback port 55433, then serves the app on port 3005. The private preview uses a different database. The ignored local configuration can set `HOME_CONSOLE_HOSTED_BETA_URL` to show a link from local groceries to the shared hosted list.

The Beta homepage uses the shared kitchen queries and actions. The Beta grocery screen uses the same Beta database. Calendar synchronization, Slack notifications, cron routes and real shopping callbacks are disconnected. A failed kitchen or grocery write must surface on the screen. Add experiments in this deployment, keep external actions explicitly scoped, and check new routes against the Beta allowlist in `lib/beta-deployment.ts`.

Run `npm run test:beta`, `npm run test:groceries`, `npm run typecheck` and `node scripts/beta-http-check.mjs`. For a local production build, stop only this checkout’s dev server before `npm run build:grocery-check`. Both commands use its .next directory.

## Hosting and releases

The hosted Beta is the Vercel Hobby project `thewarrenterror-8694/home-console-beta` and Supabase project `warpssbaylfualwroqvo` in the separate **Home Console Beta** organization. On the Supabase Free plan, a low-activity project can be paused. [Supabase project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)

Set these Vercel environment variables in that Beta project’s production environment only. The configuration contains no family integration keys.

| Variable | Purpose |
| --- | --- |
| `HOME_CONSOLE_BETA_DEPLOYMENT` | Set to `1` |
| `HOME_CONSOLE_KITCHEN_URL` | Public return URL for the family kitchen |
| `HOME_CONSOLE_BETA_SUPABASE_URL` | Canonical HTTPS origin of the Beta database |
| `HOME_CONSOLE_BETA_SUPABASE_SERVICE_ROLE_KEY` | Beta database server credential |
| `HOME_CONSOLE_BETA_DEVICE_ACCESS` | Set to `public` for key-free device access. Omit to require a device credential. |
| `KIOSK_ACCESS_TOKEN` | Required in device-key mode. To restore the lock, set a device key, remove the public setting and redeploy Beta. |
| `HOME_CONSOLE_GROCERY_AGENT_KEY` | Separate Claude bearer credential |
| `NEXT_PUBLIC_FAMILY_TIMEZONE` | `America/New_York` |

Release Beta from a reviewed commit on the Beta branch. From that checkout in PowerShell:

```powershell
$betaStage = node scripts/stage-hosted-beta.mjs
Push-Location -LiteralPath $betaStage
try {
    npx.cmd --yes vercel@66.2.0 link --project home-console-beta --scope thewarrenterror-8694 --yes
    if ($LASTEXITCODE) { throw 'Beta project link failed' }
    $project = Get-Content -Raw .vercel/project.json | ConvertFrom-Json
    if ($project.projectId -ne 'prj_sePAOMx5IjmxYGExqhvhEsDD3V2f') { throw 'Unexpected Vercel project' }
    npx.cmd --yes vercel@66.2.0 deploy --prod --scope thewarrenterror-8694 --yes
} finally {
    Pop-Location
}
```

The staging script copies tracked app source from the working tree and uses `vercel.beta.json`, which has no family cron jobs. Source deployment excludes environment files, the Git repository, local databases and workstation credentials. Schema changes go to the explicit Beta project ref after reviewing a migration dry run. The family app keeps its independent GitHub Actions release to main.
