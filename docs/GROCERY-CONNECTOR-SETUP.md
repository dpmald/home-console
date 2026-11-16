# Home Console development connector handoff

Current integration: see [GROCERY-FLOW-PLAN.md](GROCERY-FLOW-PLAN.md) for the
`codex/grocery-flow` app, port 3004, canonical migration timestamps and validation.
The temporary tunnel and commands below describe the earlier standalone connector;
they are not a permanent production endpoint or the current UI launcher.

November 15, 2026. Implemented locally on `codex/grocery-connector`, based on
`c35a3ead27431baa09329a77b605457ccb661109`. Changes are uncommitted and not deployed
to the household app. The original checkout and its preview remain separate.

## Development endpoint

Temporary HTTPS URL:
https://curious-depending-virginia-emphasis.trycloudflare.com/mcp

This is a Cloudflare development tunnel to a dedicated MCP-only server. It needs
this Windows PC, the server and the tunnel process to remain running; its hostname
changes after a new tunnel is created. It is not the production deployment or a
permanent Saturday dependency. Only `/mcp` and `/api/mcp` are routed by that server;
there is no kiosk, Slack/calendar endpoint, arbitrary SQL tool or filesystem tool.

The server uses a new PostgreSQL container/database containing only synthetic
requests. The existing local Supabase database, production data and Instacart carts
were not used for these tests. Two synthetic fixtures were seeded. Pending counts
change when a test completes one; seeding again preserves their existing state.

## Claude configuration

Warren approved the development credential transfer through Cloudflare; the
authenticated HTTPS smoke test passed for this exact endpoint.

- Connector name: `Home Console`.
- MCP server URL: the development URL above.
- Transport: Streamable HTTP (JSON responses; no SSE subscription required).
- Authentication: `No sign-in` (API-key authentication, without OAuth).
- Required request header: `authorization` (case-insensitive). Claude reserves
  this header when OAuth is selected, so choose No sign-in first.
- Header value: `Bearer ` followed by the dedicated development key, including
  the space. Warren enters this himself; do not put the value in chat or Git.

The key is the value of `HOME_CONSOLE_GROCERY_AGENT_KEY` in this worktree's ignored
`.env.grocery-dev.local`. That file also contains the dedicated local database URL;
Claude does not need that URL or its password. Never use the recipe API key, kiosk
token, a Supabase service-role key or a production credential for this connector.

An initial automatic approval review required explicit approval for transferring
the development credential through Cloudflare. After Warren's approval, Codex
verified authenticated HTTPS initialization, tool discovery, durable snapshot,
prepare, complete, exact acknowledgement replay and database readback using a
temporary synthetic fixture, then removed only that fixture and its bookkeeping.
Unauthenticated HTTPS requests return 401. Claude now reports a full scheduled
synthetic pass for `devtest-20261116-0033`; persisted records were corroborated by
Codex. Real cart writes and production deployment remain separate, unverified steps.

## Final tool contract

`docs/GROCERY-CONNECTOR-TOOLS.json` is the exact `tools/list` response generated
from the running implementation: parameter schemas, field descriptions, tool
descriptions and write annotations. Claude should read it and align v2 with it.

- `list_pending({run_id})`: creates/reuses a durable snapshot; this has a small
  write effect. `sat-YYYY-MM-DD-HHMM` labels are supported. Requests arriving later
  wait for another run. Up to 100 pending/recovery requests per snapshot.
- `record_request_progress({operation})`: `phase` is `prepare` or `complete`.
  Common fields are `operation_id`, `run_id`, `request_id`, `revision`, `retailer`,
  and `observed_at`. Preparation also requires `product` and `observed_cart`.
  Completion requires `outcome`, product evidence for covered outcomes, and a
  reason for unresolved outcomes. Worker and claim tokens are required when
  completing a prepared mutation; recovery uses `recovery_attempt_id`.
- Product evidence: actual string `product_id`, `name`, raw `size` text and integer
  `quantity`. No invented cart/line identifiers, weights, prices or delivery status.
- Preparation returns a worker token, request claim token and `lease_expires_at`.
  Fixed leases last 15 minutes with no renewal. Do not add after expiry or conflict.
- `cart_busy` returns `retailer`, `blocking_run_id`, `lease_expires_at` and
  `retry_after_seconds`, without another worker's tokens. Completion of one request
  retains the run's lease until expiry. Wait, then obtain a fresh cart observation
  and use a new operation ID; preparation rejects observations over five minutes
  old. Null retailer/lease fields on a listing describe the caller's own run.
- Use distinct operation IDs for prepare and complete. Retry an identical payload
  with its original operation ID. A changed payload conflicts. Request IDs and
  revisions must come from Home Console, never invented for recipe-only ingredients.
- Recovery reads the old attempt's retailer and never authorizes a new addition.
  Uncertain evidence remains unresolved; there is no exactly-once external-cart
  guarantee. The API validates structured evidence, not semantic food quantities;
  Claude must verify package coverage from actual cart responses before submitting
  a covered outcome.

The endpoint intentionally cannot execute any Instacart operation. Home Console
acknowledgements record observations; they never prove purchase or delivery.

## Scheduled development test

Completed acceptance procedure (reference, not a request to rerun): a separate
one-time cloud-only diagnostic explicitly attached Home Console, used simulated
product evidence and synthetic requests, and checked discovery, list,
prepare/complete, exact replay, persistence and approval behavior. No Instacart
or recipe changes were part of this test.

### November 15 evening test findings

The reports arrived out of order. Claude's later-delivered report establishes
`devtest-20261116-0033` as a PASS: cloud-only scheduled discovery, list, prepare,
complete, identical acknowledgement replay and both same-run/new-run readbacks,
with no approval prompts, denials, blocks or errors. All product evidence was
simulated; Claude reports no cart reads/writes or recipe changes. It reports
ToolSearch, Bash date, the two Home Console tools and the notification only.

Codex independently checked the stored snapshot at `00:33:25.786199Z` (two
requests), milk's single attempt `19664a7a`, revision 1, product
`SIMULATED-TEST-001`, quantity 2, outcome `in_cart`, and no reconciliation required.
The `-readback` snapshot contains only paper towels. These records corroborate
persistence; the scheduled execution, replay response and absence of prompts are
Claude-reported. They do not establish unattended Instacart write behavior.

Claude reports cloud-only run `devtest-20261116-0040` loaded both tools and listed
the remaining paper-towels request without any approval prompts. Two preparations
reached the server and returned `cart_busy`; it correctly stopped before complete
and replay. Listing created snapshot records, but this run recorded no grocery
result and made no cart change. The Saturday task was unchanged.

Codex inspected the dedicated database and verified a different, earlier run,
`devtest-20261116-0033`, had completed synthetic milk as `in_cart` at
`2026-11-16T00:33:38Z` (November 15, 7:33 PM EST). That run's Morton Williams lease
expired at `2026-11-16T00:48:34.081154Z` (7:48:34 PM EST). This explains both the
single pending request and the valid contention response. Its completed attempt
has no outstanding reconciliation. The later-delivered PASS report supplies the
previously missing scheduler/replay evidence. No fixture or receipt was erased
or reset to hide this history.

Migration `0005_grocery_lease_diagnostics.sql` adds conflict expiry/holder metadata
without shortening leases. The requested paper-towels follow-up also left a
completed receipt: Codex inspected `devtest2-20261116-0058` at `01:11:28Z` and found
attempt `de5aa02f`, revision 1, `in_cart`, no reconciliation required, completed
at `00:58:54.793204Z`; its new `-readback` snapshot contains zero requests. Both
synthetic fixtures are now fulfilled. That later run's scheduler, approvals and
replay have not been separately reported. Its lease ends at `01:13:48.351882Z`.
No further synthetic rerun is required to establish the reported 0033 pass; do
not treat an empty pending list as a failure or add either fixture again.

After applying the additive migration and refreshing the running server, Codex's
authenticated HTTPS smoke passed again. At `2026-11-16T00:49:20Z` the database had
zero active cart leases and zero unresolved attempts; milk remained `in_cart`,
paper towels remained `needed`, both revision 1. Only the smoke's generated fixture
and bookkeeping were removed. This is a point-in-time check, not a reservation
against future runs; avoid overlapping diagnostics.

The account's existing v2 task is reported cloud-only, Saturdays 6:57 AM ET, with
Instacart and Claude Docs. Do not assume it picks up this connector automatically:
after production rollout, connect the permanent endpoint and add Home Console in
v2's settings, or recreate v2 if necessary. Keep the old paused task's history.
Do not wire the temporary synthetic endpoint into the real Saturday workflow.
Real cart writes, their approvals
and the physical Cozyla microphone path remain separate unverified checks.

## Local operation and validation

Run inside `.worktrees/grocery-connector`:

```sh
npm ci
npm run db:groceries -- --seed
npm run dev:groceries
npm run test:groceries
npm run typecheck
node --import tsx scripts/grocery-mcp-smoke.ts
```

`db:groceries` accepts only a verified local Docker engine and the dedicated
`127.0.0.1:55432/home_console_grocery_dev` database. It rejects URL query overrides,
pins the local Docker endpoint, generates ignored development credentials and
applies only this database's missing migrations. It does not reset data on rerun.
The bootstrap realtime function is a test stub; these tests do not validate
Supabase Realtime delivery or PostgREST transport.

The temporary MCP-only server listens at `127.0.0.1:3003`. Stop that server and its
own Cloudflare process to close the public development endpoint. Stop the dedicated
`home-console-grocery-dev` container separately if desired; its volume persists.
Do not stop or delete the unrelated `home-console-local` Supabase containers.

Completed verification: 13 focused transport/validation/isolation tests; transactional
PostgreSQL regression covering snapshots, replay, ownership, pinned retailer, expiry,
lost acknowledgements, edits/cancellation, stale receipts, recovery and grants;
additional rollback-only lease regression checks completed-holder contention,
safe expiry metadata, no failed-prepare writes, expiry takeover and fresh evidence;
local and public HTTPS MCP smoke with a temporary fixture and database readback;
TypeScript; credential-cleared Next.js production build; public unauthenticated
HTTPS 401. No Instacart operation was invoked by either smoke test.
No UI layout was changed. Voice confirmation wording now refers to Saturday's list,
but the currently unmounted voice component has not been wired to the physical device.

The dependency audit still reports the existing Next.js/PostCSS advisory chain
(one moderate, one high; suggested automatic fix is a Next major upgrade). No
unrelated framework upgrade was made. Review that separately before production
deployment. The temporary server serves only MCP and does not process CSS input.

## Production integration still required

After review: use the canonical timestamp migrations and migration-lineage plan
in `GROCERY-FLOW-PLAN.md`, through the normal migration
workflow, configure a distinct production `HOME_CONSOLE_GROCERY_AGENT_KEY` server-side,
and deploy the `/api/mcp` Next.js route. Leave the development database variable unset
in production; the adapter explicitly rejects that variable in production mode.
Do not run the plain-Postgres test bootstrap against hosted Supabase. Production
deployment, database changes and credential entry were not performed here.
