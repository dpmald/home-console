# Reviewing a kitchen change in Slack

When Warren opens a pull request from a branch in this repository into `main`, Dotty mentions Daniela in `#home-console`. The message includes the title, PR link and reviewed commit.

- **Draft.** Use the link to try the feature. Marking the PR ready for review creates a fresh approval message.
- **Ready for review.** To ship that version, Daniela adds a 👍 emoji reaction directly to Dotty’s message. She can remove it before the merge check. A typed reply or another person’s reaction has no effect.
- **Another commit or a reopened PR.** Look for the new message. The previous approval expires.
- **Deployment.** When the Slack event subscription is enabled, a thumbs-up wakes the GitHub review workflow. A fallback scan is scheduled at minutes 07, 22, 37 and 52 each hour (UTC). GitHub can delay scheduled jobs. After checking the current PR and its mergeability, GitHub squash-merges the approved commit and builds and deploys the resulting `main` commit. Check the [deployment run](https://github.com/dpmald/home-console/actions/workflows/deploy.yml) for the Vercel result. If the build or deployment fails after the merge, open that run and choose **Re-run failed jobs**.

## One-time setup

1. In Dotty’s Slack app, under **OAuth & Permissions**, give the installed bot the `chat:write` and `reactions:read` bot scopes. Reinstall the app in the workspace if the scopes changed. Dotty must be a member of the channel.
2. In [Actions secrets](https://github.com/dpmald/home-console/settings/secrets/actions), add the **Bot User OAuth Token** as the repository secret `DOTTY_SLACK_BOT_TOKEN`. In the adjacent **Variables** tab, set `DOTTY_CHANNEL_ID` to the channel ID, `DOTTY_BOT_USER_ID` to Dotty’s Slack member ID, and `DOTTY_APPROVER_ID` to Daniela’s Slack member ID. The workflow checks the token’s identity before using it.
3. Merge the workflow installation PR through GitHub. On the next scheduled check Dotty posts notices for eligible open PRs. To check immediately, select **Run workflow** on [Dotty PR review](https://github.com/dpmald/home-console/actions/workflows/dotty-pr-review.yml) on `main`.

## Enable the reaction listener

1. In the stable kitchen's Vercel **Production** environment, set `DOTTY_SIGNING_SECRET` from **Basic Information → App Credentials** for **Home Console PR Approvals**. Copy the three existing Dotty IDs from the repository Actions variables into the corresponding Vercel environment variables.
2. Set `DOTTY_REVIEW_DISPATCH_TOKEN` in the same Vercel environment to a dedicated fine-grained GitHub credential for `dpmald/home-console` with **Actions: write**. The callback dispatches only `dotty-pr-review.yml` on `main`. Keep the signing secret and token in the deployment secret store.
3. Deploy the stable kitchen with those settings. In the Dotty Slack app, enable **Event Subscriptions**, enter the stable kitchen origin followed by `/api/slack/dotty`, and wait for Slack to verify the URL. Under **Subscribe to bot events** add `reaction_added`, save, and reinstall if Slack prompts for changed permissions. The bot uses its existing `reactions:read` scope.
4. Confirm a thumbs-up on an eligible review produces a **workflow_dispatch** run of **Dotty PR review**. The merge step re-reads the recorded message and Daniela's reaction. If an approval is removed before that check, the deployment is skipped. Duplicate events can wake another scan and the per-PR approval job serializes merges.

The callback acknowledges an event after GitHub accepts the dispatch. A temporary GitHub failure returns a retryable response to Slack. The scheduled workflow also picks up outstanding approvals after a missed delivery. The approval job logs the receipt and reason when a Slack message or reaction does not match.

See the [Slack reaction event](https://docs.slack.dev/reference/events/reaction_added/) and [GitHub workflow dispatch permissions](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

## How the merge is verified

The Actions job uses the workflow and scripts from the base branch. It records Dotty’s Slack message timestamp on the PR, then reads that message again immediately before merging. The message must be in the configured channel, from Dotty, for this PR, commit and review round, with Daniela’s reaction still present. Dotty requires a successful Kitchen PR checks run for this PR, reviewed commit and target revision. GitHub checks that the head commit still matches when accepting the merge. See [Testing Home Console](TESTING.md) for the manual merge requirement.

Pushes to `main` continue to use the existing Vercel deployment. GitHub suppresses push workflows for merges made using its built-in Actions token, so Dotty dispatches the deployment workflow explicitly. That workflow verifies the approval, merges, and passes the resulting commit to its Vercel job. [GitHub workflow triggering rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

To pause Slack-triggered merges, disable the **Dotty PR review** workflow and cancel any approval runs already queued in **Deploy Kitchen Console to Vercel**. Ordinary GitHub merges still deploy the kitchen.
