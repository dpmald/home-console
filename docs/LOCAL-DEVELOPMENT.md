# Local development

For the new separate Beta screen on port 3005, use `npm run dev:beta` and follow
[BETA-DEVELOPMENT.md](BETA-DEVELOPMENT.md). The older grocery preview on port 3004
and its standalone connector remain separate. The instructions below describe
that legacy grocery-only workflow, not the beta navigation checks.

Read AGENTS.md and docs/GROCERY-FLOW-PLAN.md first. This feature uses a dedicated
synthetic grocery database and its own app preview. It does not modify Warren's
private household-data copy or the existing preview on port 3001.

Prerequisites already used for verification: Node >=20, npm and Docker Desktop
with the local Linux engine. No hosted Supabase or Vercel login is needed.

```sh
npm ci
npm run db:groceries
npm run dev:grocery-ui
```

Open the local-only sign-in URL printed by the launcher on port 3004. Grocery
requests persist in home-console-grocery-dev on 127.0.0.1:55432. Other dashboard
cards are demo data; the screen labels this. External voice, calendar, Slack,
Gemini and Spotify credentials are blanked by the launcher. Server weather and the
browser weather fallback are explicitly disabled in this mode. Browser assets/audio
can still access the internet. Use the dedicated launcher, not a raw next dev
command that might load unrelated environment settings.

The setup preserves an existing synthetic database and its historical receipts.
Its ignored .env.grocery-dev.local contains only dedicated development credentials;
never share its values in a prompt or commit it. On another computer the setup
creates its own credentials. Do not copy production keys or point it at port 54322.

Validation commands:

```sh
npm run test:groceries
npm run typecheck
npm run test:grocery-flow-db
node --import tsx scripts/grocery-ui-smoke.ts
npm run build:grocery-check
```

The HTTP smoke needs the port 3004 server. Stop this worktree's development server
before the production build because both use .next. Database tests use rollback
fixtures and a disposable synthetic database, never production. They do not prove
hosted PostgREST, Supabase Realtime, physical Cozyla audio or Instacart operations.

The separate legacy MCP-only server on port 3003 is still available via
npm run dev:groceries. It exposes only MCP, not the UI. For current app tests use
/api/mcp on port 3004. The existing temporary Cloudflare endpoint is not the
production Saturday connector. No cloud deployment occurs when running these
commands.

On Windows, OneDrive can lock generated .next files after a build. Stop only this
worktree's server and move the generated .next directory into ignored
node_modules/.cache before starting with fresh build output. Never remove source
files or stop another worktree's server to make a test pass.

For collaboration, push a task branch and share its PR. Native Vercel Git previews
are disabled by agreement; a branch alone does not provide a hosted preview.
Merging to main triggers the existing production Actions workflow, so review the
migration and configuration prerequisites before merging.
