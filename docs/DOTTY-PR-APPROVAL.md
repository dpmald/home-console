# Reviewing a kitchen change in Slack

When Warren opens a pull request from a branch in this repository into `main`, Dotty mentions Daniela in `#home-console`. The message includes the title, PR link and reviewed commit.

- **Draft.** Use the link to try the feature. Marking the PR ready for review creates a fresh approval message.
- **Ready for review.** To ship that version, Daniela adds a 👍 emoji reaction directly to Dotty’s message. She can remove it before the merge check. A typed reply or another person’s reaction has no effect.
- **Another commit or a reopened PR.** Look for the new message. The previous approval expires.
- **Deployment.** GitHub checks the reaction about every ten minutes. Its scheduler can be delayed. After checking the current PR and its mergeability, GitHub squash-merges the approved commit and builds and deploys the resulting `main` commit. Check the [deployment run](https://github.com/dpmald/home-console/actions/workflows/deploy.yml) for the Vercel result. If the build or deployment fails after the merge, open that run and choose **Re-run failed jobs**.

## One-time setup

1. In Dotty’s Slack app, under **OAuth & Permissions**, give the installed bot the `chat:write` and `reactions:read` bot scopes. Reinstall the app in the workspace if the scopes changed. Dotty must be a member of the channel.
2. In [Actions secrets](https://github.com/dpmald/home-console/settings/secrets/actions), add the **Bot User OAuth Token** as the repository secret `DOTTY_SLACK_BOT_TOKEN`. In the adjacent **Variables** tab, set `DOTTY_CHANNEL_ID` to the channel ID, `DOTTY_BOT_USER_ID` to Dotty’s Slack member ID, and `DOTTY_APPROVER_ID` to Daniela’s Slack member ID. The workflow checks the token’s identity before using it.
3. Merge the workflow installation PR through GitHub. On the next scheduled check Dotty posts notices for eligible open PRs. To check immediately, select **Run workflow** on [Dotty PR review](https://github.com/dpmald/home-console/actions/workflows/dotty-pr-review.yml) on `main`.

## How the merge is verified

The Actions job uses the workflow and scripts from the base branch. It records Dotty’s Slack message timestamp on the PR, then reads that message again immediately before merging. The message must be in the configured channel, from Dotty, for this PR, commit and review round, with Daniela’s reaction still present. Dotty requires a successful Kitchen PR checks run for this PR, reviewed commit and target revision. GitHub checks that the head commit still matches when accepting the merge. See [Testing Home Console](TESTING.md) for the manual merge requirement.

Pushes to `main` continue to use the existing Vercel deployment. GitHub suppresses push workflows for merges made using its built-in Actions token, so Dotty dispatches the deployment workflow explicitly. That workflow verifies the approval, merges, and passes the resulting commit to its Vercel job. [GitHub workflow triggering rules](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

To pause Slack-triggered merges, disable the **Dotty PR review** workflow and cancel any approval runs already queued in **Deploy Kitchen Console to Vercel**. Ordinary GitHub merges still deploy the kitchen.
