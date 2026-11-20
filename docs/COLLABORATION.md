# Collaboration on Home Console

Warren uses Codex, Daniela uses Gemini/Antigravity, and Claude owns the Saturday
meal-planning/cart task. Shared code and durable decisions live in
https://github.com/dpmald/home-console. Assistants do not share chat histories or
uncommitted files automatically.

Use a separate checkout/worktree and one task branch per active writer. Refresh
main before starting; check open PRs before overlapping work. Coordinate edits to
KioskBoard, globals.css, shared types/domain, package files and migrations. Preserve
other contributors' changes; do not force-push a shared branch.

For this feature read docs/GROCERY-FLOW-PLAN.md, docs/LOCAL-DEVELOPMENT.md and the
MCP contract/tool schema. Start with synthetic data, run focused checks and share
the feature branch for review. Screenshots must contain only synthetic data when
committed to this public repository.

Production deployment agreement: pushes to main use .github/workflows/deploy.yml,
with VERCEL_TOKEN, VERCEL_ORG_ID and VERCEL_PROJECT_ID held in repository secrets.
Keep personal Git identities and preserve git.deploymentEnabled=false in
vercel.json. These files were verified on main at 39a227f; a successful production
Actions run was not rechecked during grocery integration. Branch pushes do not
trigger this production workflow. Automatic PR previews are not configured here.

The grocery branch includes a current-main integration of earlier uncommitted
connector work. The original preview, data-refresh, connector and checkout-design
worktrees remain intact. The private-data refresher is intentionally unchanged;
its schema/history compatibility is a separate rollout prerequisite.

On November 16 the grocery branch was rebased onto main at 39a227f. The shared
KioskBoard conflicts retained Daniela's bottom navigation and larger pantry type,
while exposing the new grocery panel through a Groceries dock tab and pantry
button. The pre-rebase tip is preserved as codex/grocery-flow-before-main-20261116.

Review handoff: identify branch/commit, describe behavior and acceptance checks,
list validation actually run, and identify what still needs physical-device,
provider or production verification. Never put credentials or private recipe
instructions in Git. Ask before production changes, deploying or changing the
real scheduled shopping task unless the user has explicitly authorized that step.
