import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const repo = 'dpmald/home-console';
const api = 'https://api.github.com/repos/' + repo;
const author = 'warrenmacdonald';
const lifecycleEvents = new Set([
  'ready_for_review', 'convert_to_draft', 'reopened', 'head_ref_force_pushed', 'base_ref_changed',
]);

function eligible(pr) {
  return pr.state === 'open' && pr.user.login === author && pr.base.ref === 'main' &&
    pr.base.repo.full_name === repo && pr.head.repo?.full_name === repo &&
    /^[0-9a-f]{40}$/.test(pr.head.sha);
}

function textFor(pr, version, approver) {
  const link = '<https://github.com/' + repo + '/pull/' + pr.number + '|PR #' + pr.number + '>';
  const action = pr.draft ? 'Draft for testing. A review request will follow when it is ready.'
    : 'React to this message with a thumbs-up to approve merging this commit to main and deploying the kitchen.';
  return '<@' + approver + '> ' + link + ' · ' + pr.head.sha + '\n' + action + '\nReview ' + version;
}

export function approved(reply, ts, config, expectedText) {
  const msg = reply.message;
  return reply.type === 'message' && reply.channel === config.channel && msg?.ts === ts &&
    msg.user === config.bot && msg.text === expectedText &&
    !!msg.reactions?.some(r => /^(?:\+1|thumbsup)(?:::skin-tone-[2-6])?$/.test(r.name) &&
      r.users?.includes(config.approver));
}

async function review(pr, io) {
  const events = await io.pages('/issues/' + pr.number + '/timeline');
  const event = events.filter(e => lifecycleEvents.has(e.event)).at(-1);
  const version = String(event ? event.id ?? event.node_id : 'initial');
  if (!/^[\w=-]+$/.test(version) || version === 'undefined') throw Error('Missing review event ID');
  const key = ['dotty-review-v1', pr.number, pr.draft ? 'draft' : 'ready', pr.head.sha, version].join(' ');
  const comments = await io.pages('/issues/' + pr.number + '/comments');
  const prefix = '<!-- ' + key + ' ';
  const receipt = comments.findLast(c => c.user?.login === 'github-actions[bot]' &&
    c.body?.startsWith(prefix) && /^\d{10,}\.\d{6} -->$/.test(c.body.slice(prefix.length).split('\n')[0]));
  const ts = receipt?.body.split('\n')[0].split(' ').at(-2);
  return { key, receipt, ts, text: textFor(pr, version, io.config.approver) };
}

async function reacted(io, state) {
  const data = await io.slack('reactions.get', { channel: io.config.channel, timestamp: state.ts, full: 'true' });
  return approved(data, state.ts, io.config, state.text);
}

async function checksPassed(io, pr) {
  const path = '/actions/workflows/pr-checks.yml/runs?event=pull_request&head_sha=' + pr.head.sha;
  const { workflow_runs: runs } = await io.gh(path);
  // GitHub lists newest runs first. An older success cannot clear a later failure or rerun.
  const latest = runs.find(run => run.head_sha === pr.head.sha && run.head_repository?.full_name === repo &&
    run.pull_requests.some(link => link.number === pr.number && link.base.sha === pr.base.sha));
  return latest?.status === 'completed' && latest.conclusion === 'success';
}

export async function scan(io) {
  const pulls = await io.pages('/pulls?state=open&base=main');
  const failures = [];
  for (const pr of pulls.filter(eligible)) {
    try {
      const state = await review(pr, io);
      if (!state.receipt) {
        const sent = await io.slack('chat.postMessage', {
          channel: io.config.channel, text: state.text, unfurl_links: false, unfurl_media: false,
          blocks: [
            { type: 'section', text: { type: 'plain_text', text: pr.title } },
            { type: 'section', text: { type: 'mrkdwn', text: state.text } },
          ],
        });
        if (sent.channel !== io.config.channel || !/^\d{10,}\.\d{6}$/.test(sent.ts)) {
          throw Error('Missing Slack message receipt');
        }
        const note = pr.draft ? 'Dotty posted a draft testing notice' : 'Dotty requested merge approval from Daniela';
        await io.gh('/issues/' + pr.number + '/comments', 'POST', {
          body: '<!-- ' + state.key + ' ' + sent.ts + ' -->\n' + note + ' in Slack for ' + pr.head.sha + '.',
        });
      } else if (!pr.draft && await reacted(io, state) && await checksPassed(io, pr)) {
        await io.gh('/actions/workflows/deploy.yml/dispatches', 'POST', {
          ref: 'main', inputs: {
            pr_number: String(pr.number), head_sha: pr.head.sha, receipt_id: String(state.receipt.id),
          },
        });
      }
    } catch (err) {
      failures.push('PR #' + pr.number + ': ' + err.message);
    }
  }
  if (failures.length) throw Error(failures.join('\n'));
}

export async function mergeApproved(io, { number, sha, receiptId }) {
  if (!/^[1-9]\d*$/.test(number) || !/^[1-9]\d*$/.test(receiptId) ||
      !/^[0-9a-f]{40}$/.test(sha)) throw Error('Invalid approval reference');
  const pr = await io.gh('/pulls/' + number);
  if (!eligible(pr) || pr.draft || pr.head.sha !== sha) return;
  const state = await review(pr, io);
  if (!state.receipt || String(state.receipt.id) !== receiptId || !await reacted(io, state)) return;
  if (!await checksPassed(io, pr)) return;
  if (pr.mergeable !== true || pr.mergeable_state !== 'clean') {
    throw Error('GitHub has not cleared PR #' + number + ' for merging: ' + pr.mergeable_state);
  }
  const result = await io.gh('/pulls/' + number + '/merge', 'PUT', { sha, merge_method: 'squash' });
  if (!result.merged || !/^[0-9a-f]{40}$/.test(result.sha)) throw Error('GitHub did not confirm the merge');
  return result.sha;
}

function client(env) {
  const config = { channel: env.DOTTY_CHANNEL_ID, bot: env.DOTTY_BOT_USER_ID, approver: env.DOTTY_APPROVER_ID };
  if (!/^C[A-Z0-9]+$/.test(config.channel) || !/^U[A-Z0-9]+$/.test(config.bot) ||
      !/^U[A-Z0-9]+$/.test(config.approver) || config.approver === config.bot ||
      !env.DOTTY_SLACK_BOT_TOKEN || !env.GH_TOKEN) throw Error('Configure the Dotty Actions secret and variables');
  async function gh(path, method = 'GET', body) {
    const response = await fetch(api + path, {
      method, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + env.GH_TOKEN, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'User-Agent': 'home-console-dotty' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw Error('GitHub ' + method + ' ' + path.split('?')[0] + ' HTTP ' + response.status);
    const raw = await response.text();
    return raw ? JSON.parse(raw) : undefined;
  }
  async function pages(path) {
    const all = [];
    for (let page = 1; ; page++) {
      const rows = await gh(path + (path.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
      all.push(...rows);
      if (rows.length < 100) return all;
    }
  }
  async function slack(method, params = {}) {
    const query = method === 'reactions.get';
    const response = await fetch('https://slack.com/api/' + method + (query ? '?' + new URLSearchParams(params) : ''), {
      method: query ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: 'Bearer ' + env.DOTTY_SLACK_BOT_TOKEN, 'Content-Type': 'application/json; charset=utf-8' },
      body: query ? undefined : JSON.stringify(params),
    });
    if (!response.ok) throw Error('Slack ' + method + ' HTTP ' + response.status);
    const data = await response.json();
    if (!data.ok) throw Error('Slack ' + method + ': ' + data.error);
    return data;
  }
  return { config, gh, pages, slack };
}

async function main() {
  const io = client(process.env);
  if ((await io.slack('auth.test')).user_id !== io.config.bot) throw Error('Token does not belong to Dotty');
  if (process.argv[2] === 'scan') return scan(io);
  if (process.argv[2] !== 'merge') throw Error('Unknown command');
  const sha = await mergeApproved(io, {
    number: process.env.PR_NUMBER, sha: process.env.HEAD_SHA, receiptId: process.env.RECEIPT_ID,
  });
  if (sha) appendFileSync(process.env.GITHUB_OUTPUT, 'merge_sha=' + sha + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}
