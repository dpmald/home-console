# Testing Home Console

Every pull request runs [Kitchen PR checks](../.github/workflows/pr-checks.yml) on its proposed merge with the target branch. The three parallel jobs feed one GitHub status check named **Kitchen quality gate**.

| Command | What it verifies |
| --- | --- |
| `npm test` | Fast Node tests for the grocery connector, Beta navigation and access, family scheduling, and Dotty approval. Put new TypeScript unit tests in `tests/*.test.ts`. |
| `npm run typecheck` | TypeScript contracts across the app and tests. |
| `npm run test:context` | Documented npm commands, application environment settings, local guide links and Beta's documented API routes. On a PR it also checks that changes affecting a guide have a guide update or a reason in the PR description. |
| `npm run build:grocery-check` followed by `node --test tests/*.test.mjs` | Offline Next production build and JavaScript regressions, including browser tests that use the built app. |
| `npm run test:integration` | Fresh PostgreSQL migrations, broadcast trigger behavior, grocery database tests, proposal decisions and retries, Beta HTTP routes, and a Chrome dinner claim and reload. |

## Running locally

Use a separate checkout, install dependencies with `npm ci`, and run the commands above. The browser tests use installed Google Chrome. The integration job also needs Docker Compose and a local Linux Docker engine. Its randomly named Compose project binds only loopback ports 55442 and 55443. Each run creates an empty database, generates credentials, starts PostgREST and Next, and removes its containers and volumes in teardown. Use a separate checkout from an active preview because both Next processes write to `.next`.

The grocery test adds a synthetic item through the device API, retries the same save, exercises the connector, then reads the result back. The dinner test submits an actual touchscreen claim and checks the owner and meal after a browser reload. The broadcast regression records calls made by real PostgreSQL triggers to a test implementation of the Realtime transport. Physical Cozyla input, hosted Realtime delivery and provider actions require separate verification.

## Merge requirements

Dotty rechecks the successful PR workflow before dispatch and again before merging an approved commit. If the target branch has moved, update the PR branch to get a fresh run. An administrator can also require **Kitchen quality gate** from GitHub Actions in the rules for `main`, with up-to-date branches, to enforce the same requirement for manual merges. After the workflow lands, older open PRs need an update or reopen to trigger their first run.

## Keeping guides current

The context check covers the README, assistant instructions, collaboration, Beta, local development, testing and Dotty guides. For changes to documented behavior, edit the owning guide in the same PR. If an internal change leaves the guides accurate, explain why on a line beginning `Context unchanged:` in the PR description. The automated comparisons catch verifiable facts. Reviewers still assess whether the prose accurately explains the change.
