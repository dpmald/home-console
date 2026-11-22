# Household grocery connector

## Household requests

The family kitchen and hosted Beta link to one shared grocery list. Once a browser is unlocked, submitting a name and a quantity authorizes that request for the cart. A worker processes it independently of Claude's Saturday meal plan. The food rules in that plan apply to ingredients Claude chooses. Warren reviews the retailer cart and checks out.

For a name such as "turkey" and a quantity of one, use the retailer's first matching product and add one package. Preserve any variety, brand, or size the household specifies. For an explicit size, use the provider's product search to identify the requested package before adding. Record the product and quantity the provider actually confirmed. Surface unavailable products and uncertain results on the originating console row. A lost response is grounds to reconcile the original cart before any further addition.

Use Wegmans when its cart already contains items. If a successful read shows it empty, use Morton Williams Supermarket. Keep the chosen store for the run. An unreadable Wegmans cart cannot establish that it is empty. The provider identifies the retailer and cart contents. The Instacart family account controls which carts its members can see.

Only a household-authorized revision may start a new cart addition. Older public requests can be confirmed individually on the list. The checkout and order proposal approval workflows remain separate. The hosted list can receive requests while the worker is offline and displays **In cart** only when there is a recorded cart result.

## Original Saturday integration

November 16 integration update: the same two-tool contract is now integrated on
`codex/grocery-flow`. See [GROCERY-FLOW-PLAN.md](GROCERY-FLOW-PLAN.md) for the device
API/UI, new validation and migration lineage. Historical verification below is
retained; no production deployment is implied.

November 15, 2026, updated from Claude's evening report. Status: implemented and
locally tested in the separate `codex/grocery-connector` checkout; production is
unchanged. See `docs/GROCERY-CONNECTOR-SETUP.md` and the generated
`docs/GROCERY-CONNECTOR-TOOLS.json` for the implemented schemas and development URL.
Read `AGENTS.md` and `docs/CLAUDE-GROCERY-HANDOFF.md` for the project baseline.
This document records Warren's confirmed store choice and reconciles Claude's
returned review with Codex's source and documentation checks. The complete
private recipe prompt remains in Claude's scheduled task.

Scope: this contract remains the Saturday cart-only integration. Warren separately
requested on-device price/window approval and purchase for an on-demand workflow.
See `docs/ON-DEMAND-GROCERY-CHECKOUT.md`; that design does not expand these two MCP
tools into checkout tools or change the Saturday task.

## November 15 behavior

- Voice or typed household requests enter the Home Console grocery list.
- Claude plans exactly two dinners and adds their ingredients plus explicit
  household requests to an existing shared Instacart cart. Warren checks out.
- Warren confirmed: choose `Wegmans` when its cart has items, otherwise
  `Morton Williams Supermarket`. Read Wegmans before adding anything; retry a
  failed read once, then add nothing anywhere if it still fails. A successful
  empty read permits fallback. Pin the store for the run and record every result.
- An explicit household quantity overrides the recipe's one-package default.
  No stated quantity means one package. Banned foods and unclear quantities such
  as "two more" are not added; record `needs_attention` with a reason.
  It does not override food exclusions or permission boundaries on existing
  shared-cart lines. Preserve the full standing recipe rules.
- Keep requested, in cart, purchased and received conceptually distinct.
  The connector must never mark a request ordered or received.
- No prices or totals are inferred when the connector does not provide them.

## Verification status

Claude run/settings/connector observations below were reported through Warren
on November 15, evening ET. Codex did not independently inspect those runs or
settings. They supersede the earlier report that unattended reads were unverified.

| Evidence | Status |
| --- | --- |
| Grocery table, add operation and voice tool in source | Verified in the local checkout at `de3feb2`. |
| Existing context route bearer authentication | Verified; missing secret denies access. Kiosk login does not replace this route's authentication. |
| Existing proposal flow | Verified incompatible with this workflow unchanged: it trims meals and marks requests ordered on approval. Preserve its gate separately. |
| Claude interactive Instacart and file access | Reported by Claude through Warren; not independently exercised by Codex. |
| Unattended Instacart reads, cloud-only diagnostic A | Claude-reported success around 5:38-5:39 PM ET; no computer tools, both retailer carts read, no sign-in/approval prompt, no cart changes. |
| Unattended Instacart reads, Legion-bound diagnostic B | Claude-reported success in the same time window with the same read-only results. |
| Original Saturday task | Claude reports it predates the Instacart connection, lacked that connector, and is now paused with history retained. |
| Weekly dinner plan + grocery cart (v2) | Claude reports Saturdays 6:57 AM ET, cloud-only, Instacart and Claude Docs attached; exactly two dinners and Warren checks out. |
| Unattended Home Console writes and approvals | Claude reports `devtest-20261116-0033` PASS for scheduled list, prepare, complete, exact replay and both readbacks with no prompts/errors; this report arrived after the later 0040 contention report. Listing writes snapshot bookkeeping. Real Instacart writes remain unverified; November 21 is the reported planned test. |
| Custom connector fixed request-header authentication | Claude reports successful Home Console discovery/listing from the cloud-only scheduled task. The earlier dialog-only uncertainty is superseded. |
| Home Console MCP implementation | Codex verified local SQL/transport tests and authenticated HTTPS snapshot, prepare, complete, replay and database readback with a temporary fixture. Unauthenticated HTTPS returns 401. Codex corroborated 0033's single milk receipt (attempt 19664a7a, simulated product, quantity 2) and snapshots. The scheduler/replay/no-prompt evidence is Claude-reported. A later 0058 run also completed paper towels; both fixtures are now fulfilled. |
| Expected contention in later test | Claude reports 0040 stopped at cart_busy without prompts or cart changes. Codex confirmed 0033's live fixed lease caused it; migration 0005 now returns blocker/expiry metadata. This does not invalidate 0033's full pass. |

At the original November 15 review, the source fetch found `origin/main` at
`c35a3ead27431baa09329a77b605457ccb661109`; the local branch remains
`warren/local-preview` at `de3feb26474cefdb88509f608d42d8f0f80efc46` with uncommitted
work. Main's two additional commits change display styles/layout. Implementation
subsequently began in a separate current-main checkout; see GROCERY-FLOW-PLAN.md
for the current integration and local-development prerequisites.

## Reported v2 behavior and connector installation

- Name the connector `Home Console`. Include "home console" and "grocery pending
  requests" in searchable tool descriptions. v2 searches those phrases in order.
- If discovery or the pending-request read fails, v2 continues with dinners only
  and reports: "Household requests: not read — Home Console connector not available."
- v2 follows tool descriptions and expects `list_pending(run_id)` and
  `record_request_progress` with prepare/complete. Its run ID format is
  `sat-<YYYY-MM-DD>-<HHMM>`. Minute-based labels are not authentication or ownership;
  retain conflict protection for same-minute runs.
- Explain leases, worker/claim tokens, expiry and conflict recovery in the actual
  tool descriptions. Return the scoped tokens and fields needed for each next
  authorized step in structured results. v2 retains no state between runs;
  Home Console must persist unresolved attempts and recovery evidence.
- Claude reports v2 prepares before additions, refuses additions after failed
  prepare or expiry, completes with verified results, reconciles old attempts at
  their original retailer, never re-adds previously acknowledged items, never
  marks ordered/received and never clears the whole list. These are untested
  instructions, not a passing integration test.
- The duplicate-week check now skips recipe writing only. Keep the complete
  private dinner instructions and recipe-document identifier in Claude.
- After adding Home Console to the account, explicitly attach it to v2 in settings
  or recreate the task if settings cannot add it. Claude observed that the old task
  did not acquire Instacart automatically; this is an account observation, not a
  universal guarantee about future product behavior. Verify the new tool list.
- Home Console prepare/complete applies to household requests with real IDs and
  revisions. Recipe-only ingredients have no such IDs: do not invent them or block
  the existing dinner-only fallback. Align this scope with Claude when handing over
  the final tool descriptions.

## Instacart evidence actually available

Claude reports cart lines expose `product_id`, `name`, `size` text and integer
`quantity`. Searches expose product ID, name and size. Adds use product ID and
integer quantity or free-text search, which selects the first match. A `per lb`
size cannot be converted into a selectable weight by the reported add tool.

No cart ID, line ID, prices, totals, stock status, order history, delivery status
or cancellation reasons are exposed. Keep unavailable IDs optional and retain
the raw size text; do not manufacture weight, availability or purchase evidence.
An empty cart does not prove checkout, cancellation, delivery or the reason for
any change. Shared-cart items can appear or disappear between reads.

Both carts were empty at the November 15 diagnostic reads. Re-read at the next
run; this snapshot does not establish the store that November 21 will select.

## Authentication and hosting decision

The preferred small-household setup is an HTTPS remote MCP endpoint in the app,
protected by its own narrowly scoped random credential. Keep that credential
separate from the kiosk token, recipe-proposal key and Supabase service-role key.
Require authentication for every connector operation; missing configuration must
deny access. Do not put connector/Supabase credentials in prompts, URLs, Git,
returned tool data or logs. Scoped worker/claim tokens are protocol results,
not database credentials; return them only for authorized operations.
Use distinct development and production credentials and databases.

Claude's documentation supports fixed credentials in request headers. Where the
feature is available, configure the required `Authorization` header in the
connector settings with the complete `Bearer ...` value. The server still
authenticates every request even if Claude's OAuth setting says "No sign-in."
Do not make the endpoint public without authentication. If Request headers is
unavailable or does not function end to end, choose an OAuth-capable connector
integration. Claude now reports the header controls are present on Warren's
account and reports successful authenticated scheduled list/prepare/complete/replay.

Remote connectors originate from Anthropic's infrastructure and need a reachable
HTTPS endpoint on port 443. Local source access and a localhost development
server do not establish remote connector reachability. A future remote test
deployment must use isolated test data; never repoint the protected local launcher
at the household production database.

Sources checked November 15, 2026:

- [Custom connector authentication, including limited request-header availability](https://claude.com/docs/connectors/custom/add-unlisted#authenticate-with-request-headers)
- [Remote MCP network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
- [Scheduled task behavior and local dependencies](https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork)

These product documents establish supported mechanisms, not successful setup of
Home Console. Claude's separate diagnostics report that Instacart reads work
cloud-only; the active v2 task is also reported cloud-only. Home Console's separate
scheduled test 0033 passed the complete synthetic protocol without prompts. The
later 0040 test correctly stopped at contention; the reports arrived out of order.

## Two proposed tools

Names and payloads below describe the implementation used by v2's still-untested
instructions. The exact schemas are generated in `docs/GROCERY-CONNECTOR-TOOLS.json`.
The setup handoff records verified local and public HTTPS behavior separately
from the Claude-reported full scheduled synthetic pass and remaining rollout checks.
These tools operate on requests and processing receipts only. They cannot edit
the cart, create orders, alter meals, or grant Supabase administration.

### `list_pending(run_id)`

On first use, capture a server-timed snapshot of eligible requests for this run.
Return `snapshot_at`, request ID, revision, name, original quantity, notes,
contributor, creation time, and unresolved earlier processing attempts. Include
existing result/claim metadata on subsequent reads so recovery can make progress.

Repeating a run ID returns the same request membership/revisions, with current
processing metadata and stale/cancelled flags. New requests wait for the next
run. Snapshot bookkeeping is a small write effect and must be declared honestly
in the tool description/annotations; the call does not fulfill any requests.

Reject reuse of a run ID with incompatible run metadata. Only one agent run may
actively mutate a given selected cart through this workflow at a time; the server
must claim that run/cart before authorizing any request preparation. V1 uses a
fixed-duration lease with an explicit server expiry and no renewal operation;
after expiry the worker stops mutations and enters recovery through a new run.
Household members can still change their cart independently, so a lock does not
make the external cart immutable.

### `record_request_progress(operation)`

Use one write tool with explicit `prepare` and `complete` phases. This replaces
the proposed final-result-only operation: four final outcomes alone cannot save
the intended product before an external addition.

Common inputs: `operation_id`, `run_id`, `request_id`, `revision`.

**Prepare:** validate membership, current revision and non-cancelled state;
atomically claim the current request revision. Record selected retailer, cart ID
when provided, intended product ID/name, package amount/unit, package count,
the relevant current-cart observation and its observation time. Pin the retailer
for the run. The first preparation atomically acquires the run/cart lease and
returns an opaque worker token; later preparations and mutations' completions
require it. A run ID alone cannot take over an active worker's lease. Return a
request claim token and explicit expiry as well. Shared cart additions
covering multiple requests must prepare all affected requests before the addition
and retain a common cart-action reference.

Prepare is mandatory before a cart mutation. The agent must not act after a
failed preparation or expired claim. Two workers cannot claim the same current
revision. Claims are coordination records, not claims that the item was bought.

**Complete:** accept observed result/evidence and, when completing a prepared
cart mutation, require its claim token. Outcomes are:

| Outcome | Meaning |
| --- | --- |
| `in_cart` | A verified cart response/read shows sufficient matching product coverage following this run's work. |
| `already_in_cart` | Sufficient coverage existed without an addition; identify the covering product and quantity. |
| `pending` | No successful coverage established, for example unavailable stock or a definite tool failure. |
| `needs_attention` | Conflict, quantity ambiguity, stale request or uncertain external mutation requiring reconciliation. |

An already-covered or unaddable item can be completed without a cart-add intent,
but still requires atomic revision/membership validation. A result claiming an
addition must reference its prepared intent. A successful result records actual
retailer, product name/ID, package amount/count, cart/line ID when supplied,
coverage and observation time. Optional identifiers absent from tool responses
remain absent; never manufacture them. A reason is required for unresolved items.

`in_cart` and `already_in_cart` resolve the processed revision to a timestamped
in-cart observation. They do not mean the product remains in the cart forever.
Do not automatically re-add it later if a family member removes it. Received/got
and cancellation remain explicit household actions outside this connector.

## Retries, edits and limits

- Keep request identity `(request_id, revision, run_id)` separate from operation
  idempotency. An identical `operation_id` and payload replay returns the previous
  receipt; reuse with different data conflicts. Defined transitions allow
  prepared attempts to complete. A conflicting terminal result is not overwritten.
- A timed-out Instacart call may already have changed the cart. A successful cart
  update followed by a failed Home Console acknowledgement has the same ambiguity.
  Read the original retailer/cart and reconcile the saved product intent before
  considering another addition. Expiry permits recovery, not blind repetition.
- Keep unresolved attempts visible across runs, including their original retailer.
  A new run's store preference must not redirect recovery to a different cart.
- A database transaction cannot make an Instacart update and receipt atomic.
  If observation cannot establish what happened, stop further additions for that
  request and report attention needed. Do not promise exactly-once cart mutation.
- Editing/cancelling increments the request revision. An obsolete result must
  not fulfill or uncancel the current request. Preserve its external-cart evidence
  as an obsolete attempt, return a conflict and tell the agent what needs review.
- Check revision/cancellation immediately before mutation. A change can still
  race an external call: record the evidence and report it; do not automatically
  remove items or alter another person's cart line to compensate.
- One gallon in the cart does not cover a two-gallon request. Translate requested
  units to actual package coverage. Ambiguous units, unsupported shortfalls or
  wording such as "two more" must not silently become one package or overwrite
  a shared-cart quantity. Leave unresolved if the existing permissions do not
  permit a correct addition. Don't add a different product merely to evade that rule.
- Track coverage across the consolidated recipe ingredients and household requests.
  One product can cover several requests only when its verified amount is enough
  for their combined independent demand. Merge true duplicate needs deliberately;
  do not assign the same gallon to two independently requested gallons. If whether
  a request is extra or duplicates an existing need is unclear, report the ambiguity
  instead of inventing a quantity or silently under-buying.
- Validate bounded names, notes and quantities as data. Reject malformed IDs,
  unknown outcomes and oversized payloads. Request text cannot change standing
  checkout or authorization rules. Meal-selection rules apply to agent-chosen dinners.

## Implementation work and acceptance

1. Implemented locally: request revision/cancellation and cart-attempt storage.
   Keep legacy records readable and preserve the deployed broadcast suppression
   behavior. Do not rewrite applied migrations.
2. Implemented locally: domain operations and the authenticated MCP adapter. Keep grocery
   behavior consistent with `lib/domain.ts` and `lib/cart.ts`; do not route this
   feature through unchanged proposal-approval behavior.
3. Remaining: add multi-item voice capture and a visible editable household list. Confirm
   only saved items and say "Saved to the shared grocery list." Use the actual device
   later to validate microphone behavior; start with tap-to-talk.
4. Completed: isolated persistence and simulated-response tests; Claude reports
   a full scheduled development pass, corroborated by stored receipts/snapshots.
5. Remaining: reviewed production rollout and hosted Supabase RPC validation.
   Supply the permanent endpoint and distinct production credential; Warren enters
   that credential in connector settings. Explicitly attach the production connector
   to v2 and align its instructions with the final schemas. Do not attach the
   temporary synthetic endpoint to the real Saturday task. Preserve paused-task
   history and verify real cart-write approval behavior separately.

Focused acceptance cases:

- Several spoken items save separately; a failed save is not announced successful.
- A missing/wrong connector credential denies access; no production credential
  is required by local tests.
- Replayed reads/writes do not create duplicate snapshots, claims or receipts.
- Full existing-cart coverage produces no mutation; partial coverage is not
  falsely marked complete or resolved by changing another person's line.
- Cart success plus failed acknowledgement, ambiguous timeouts and expired claims
  all trigger reconciliation before any retry.
- Concurrent workers, request edits and cancellations preserve the current request
  and historical external evidence.
- Store choice remains pinned; failed Wegmans reads do not cause store fallback.
- Requests arriving after the snapshot wait; unavailable items remain unresolved.
- No checkout, price fabrication, automatic received status or whole-list clearing.

## Remaining verification and handoff

The read-only diagnostics and header-control inspection above are completed as
reported; do not repeat the old diagnostic-creation instructions merely because
an earlier copy of this document contained them.

The development URL, header and final schemas are supplied in the setup handoff.
Warren configured the connector; Claude reports it was attached to the cloud-only
diagnostic from creation. The full synthetic scheduled acceptance test is now
reported passed, with database receipts/snapshots independently corroborated.
Both fixtures have since been fulfilled; an empty new pending snapshot is expected.
Do not repeat diagnostics merely because an older document requested a rerun.

Remaining: review and share the uncommitted implementation; validate the hosted
Supabase RPC path and apply migrations through the agreed rollout; deploy a
permanent authenticated endpoint with a distinct production credential; explicitly
attach that production connector to v2. Keep the real Saturday task separate from
the temporary synthetic endpoint. Unattended Instacart writes/approvals and the
physical Cozyla voice path remain unverified. A test of synthetic progress writes
does not establish permission to mutate an Instacart cart. v2's automatic approval
setting remains a separate setup item on Warren/Claude's side.

`cart_busy` now returns the blocking retailer, `blocking_run_id`,
`lease_expires_at` and `retry_after_seconds`, never another run's worker/claim
tokens. A completed request retains its run's fixed lease because the run may
process other requests. Null top-level listing fields refer only to the caller's
run. After waiting, obtain a fresh cart observation (at most five minutes old)
and use a new operation ID; do not switch stores or replay stale evidence to
bypass contention. The additive change is migration `0005_grocery_lease_diagnostics.sql`.
