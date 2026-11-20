# Working on Home Console

Shared project context for any coding assistant working with Warren or Daniela.
Read this file explicitly if your tool does not discover AGENTS.md automatically.
Direct instructions from the person requesting the work take precedence over these defaults.

## Start here

- Read README.md and docs/COLLABORATION.md, then the code relevant to the task.
- Inspect git status, the current branch, and recent commits before editing. Preserve existing work.
- Refresh origin/main when network access permits, and check open pull requests before overlapping work. If access is blocked, report the last known commit instead of implying the checkout is current.
- Work in a separate checkout or worktree for each concurrently running assistant.

## Coordination

- Use one task branch and one active writer per task. Suggested names: warren/<task> and daniela/<task>.
- Use pull requests to integrate changes into main unless the user explicitly directs another workflow.
- State the task, acceptance criteria, and likely files before substantial work. Split unrelated work into separate changes.
- Coordinate edits to components/KioskBoard.tsx, app/globals.css, lib/types.ts, lib/domain.ts, package files, and migrations; these are shared areas.
- Do not overwrite another contributor's work or force-push a shared branch. Resolve conflicts against current code and rerun affected checks.
- Keep decisions in repository documentation or an authorized issue/PR, rather than relying on private chat history. Do not post messages or request reviews without the user's authorization.

## Production deployment agreement

- Warren relayed Daniela's deployment update on November 15, 2026: use GitHub Actions on pushes to main for Vercel production, authenticated with repository secrets VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID. Contributors keep their own Git name and email.
- Preserve .github/workflows/deploy.yml and "git": { "deploymentEnabled": false } in vercel.json once present. Do not restore native Git auto-deploy or replace the agreed workflow without a new instruction.
- Main at 39a227f35a134cde22d10a4d35104df4ba561888 contains the Actions workflow and native-Git-disable setting. A successful production Actions deployment was not rechecked during grocery integration. Verify a successful deployment before calling any change live.
- Treat a push or merge to main as a production deployment trigger once the workflow is installed. Local preview work does not require Vercel credentials. Do not assume automatic PR previews are available with native Git deployment disabled.

## Architecture and behavior

- Next.js App Router and React provide the wall display and API routes. Supabase holds shared family state.
- Keep business operations in lib/domain.ts and lib/cart.ts so kiosk, Slack, voice, and cron entry points agree.
- Use lib/time.ts and the configured family timezone for dates and scheduling.
- Preserve the explicit approval gate for grocery proposals. Approval, order placement, and delivery are distinct events; do not claim an external order succeeded without provider confirmation.
- Keep server credentials on the server. Never commit .env.local, tokens, or real private family data; this repository was public when these instructions were prepared.
- Use isolated development data for integration checks. Do not run migrations or external notifications against production as part of ordinary local tests.
- Add new migration files for schema changes once migrations have been applied; do not silently rewrite deployed migration history.
- Preserve migration 0002's row-level broadcasts and unchanged-update suppression, plus migration 0003's per-table transaction deduplication and chore fields. Statement-level notifications on initialization upserts caused a verified kiosk refresh loop. With the isolated database running, npm run test:local-db checks actual-change broadcasts and deduplication. After fetching new migrations, use npm run db:migrate with the app stopped to upgrade only the verified local database.
- Distinguish demo behavior from production failures. Do not hide failed persistence behind a success state or replace live data with unlabeled demo data.
- For display changes, consult stitch_family_kitchen_command_center/warm_hearth_hub/DESIGN.md and the adjacent HTML references. Preserve readable landscape layouts, touch targets, and ambient/bento/timeline modes.

## Local development and verification

The repository declares Node >=20 and uses npm with package-lock.json.

```sh
npm ci
npm run db:groceries
npm run dev:grocery-ui
npm run test:groceries
npm run typecheck
npm run build:grocery-check
```

- The source has a demo fallback when Supabase is unavailable. That is useful for layout work, but does not verify persistence or integrations.
- Read docs/LOCAL-DEVELOPMENT.md for the synthetic grocery preview on port 3004. Warren's older private-data preview on port 3001 is a separate checkout/stack; do not repoint or upgrade it during grocery work. Do not link a development checkout to hosted Supabase or import production credentials.
- The private production-to-local data copy is explicitly authorized in its own workflow. Its installed refresher must be reviewed before adopting the new grocery schema; see docs/GROCERY-FLOW-PLAN.md. Do not bypass its schema, trigger or foreign-key protections.
- No automated test suite or CI workflow existed at the initial collaboration setup. Do not report tests as passing unless you actually ran them.
- Add focused tests for meaningful behavioral changes; documentation-only changes do not need application tests.
- For UI changes, inspect the rendered display at the intended landscape size and check relevant interactions when runtime access permits.
- Finish with the change, validation results, any blocked checks, and the exact branch/commit or uncommitted state needed for a handoff.
