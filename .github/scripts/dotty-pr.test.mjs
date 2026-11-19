import test from 'node:test';
import assert from 'node:assert/strict';
import { scan, mergeApproved } from './dotty-pr.mjs';

const repo = { full_name: 'dpmald/home-console' };
const sha = 'a'.repeat(40);
const mergeSha = 'b'.repeat(40);
const config = { channel: 'C1', bot: 'U2', approver: 'U3' };

function fixture() {
  const pr = { number: 7, title: 'Kitchen change', state: 'open', user: { login: 'warrenmacdonald' },
    base: { ref: 'main', repo }, head: { sha, repo }, draft: false, mergeable: true, mergeable_state: 'clean' };
  const state = { pr, events: [], comments: [], messages: [], dispatches: [], merges: [] };
  const io = {
    config,
    async pages(path) {
      if (path.startsWith('/pulls?')) return [pr];
      if (path.endsWith('/timeline')) return state.events;
      if (path.endsWith('/comments')) return state.comments;
      assert.fail(path);
    },
    async gh(path, method, body) {
      if (path === '/issues/7/comments' && method === 'POST') {
        state.comments.push({ id: state.comments.length + 1, user: { login: 'github-actions[bot]' }, ...body });
      } else if (path === '/actions/workflows/deploy.yml/dispatches' && method === 'POST') {
        state.dispatches.push(body);
      } else if (path === '/pulls/7' && method === undefined) {
        return pr;
      } else if (path === '/pulls/7/merge' && method === 'PUT') {
        state.merges.push(body);
        pr.state = 'closed';
        return { merged: true, sha: mergeSha };
      } else assert.fail(path);
    },
    async slack(method, args) {
      assert.equal(args.channel, config.channel);
      if (method === 'chat.postMessage') {
        const ts = '1700000000.' + String(state.messages.length).padStart(6, '0');
        const response = { channel: config.channel, type: 'message',
          message: { ts, user: config.bot, text: args.text, reactions: [] } };
        state.messages.push(response);
        return { channel: config.channel, ts };
      }
      assert.equal(method, 'reactions.get');
      return state.messages.find(m => m.message.ts === args.timestamp);
    },
  };
  return { state, io, input: { number: '7', sha, receiptId: '1' } };
}

function approve(state, name = '+1', user = config.approver) {
  state.messages.at(-1).message.reactions = [{ name, users: [user] }];
}

test('announces once, dispatches on a skin-tone thumbs-up, merges the reviewed head once', async () => {
  const { io, state, input } = fixture();
  await scan(io);
  await scan(io);
  assert.equal(state.messages.length, 1);
  assert.match(state.messages[0].message.text, /<@U3>.*PR #7/);
  assert.equal(state.dispatches.length, 0);
  approve(state, '+1::skin-tone-4');
  await scan(io);
  assert.deepEqual(state.dispatches, [{ ref: 'main', inputs: { pr_number: '7', head_sha: sha, receipt_id: '1' } }]);
  assert.equal(await mergeApproved(io, input), mergeSha);
  assert.equal(await mergeApproved(io, input), undefined);
  assert.deepEqual(state.merges, [{ sha, merge_method: 'squash' }]);
});

test('draft, new commits and reopening each get a fresh review message', async () => {
  const { io, state, input } = fixture();
  state.pr.draft = true;
  await scan(io);
  approve(state);
  await scan(io);
  assert.equal(await mergeApproved(io, input), undefined);
  state.pr.draft = false;
  state.events.push({ event: 'ready_for_review', id: 1 });
  await scan(io);
  assert.equal(await mergeApproved(io, input), undefined);
  approve(state);
  state.pr.head.sha = 'c'.repeat(40);
  await scan(io);
  assert.equal(await mergeApproved(io, { ...input, receiptId: '2' }), undefined);
  approve(state);
  state.events.push({ event: 'reopened', id: 2 });
  await scan(io);
  await scan(io);
  assert.equal(state.messages.length, 4);
  assert.equal(state.dispatches.length, 0);
});

test('rechecks the reaction, channel, message, sender and receipt before merging', async () => {
  for (const change of [
    x => approve(x, '+1', 'OTHER'), x => approve(x, 'eyes'), x => approve(x, 'thumbsdown'),
    x => { x.messages[0].message.reactions = []; },
    x => { x.messages[0].channel = 'OTHER'; }, x => { x.messages[0].message.user = 'OTHER'; },
    x => { x.messages[0].message.text += 'edited'; }, x => { x.comments[0].user.login = 'OTHER'; },
  ]) {
    const { io, state, input } = fixture();
    await scan(io);
    approve(state);
    await scan(io);
    assert.equal(state.dispatches.length, 1);
    change(state);
    assert.equal(await mergeApproved(io, input), undefined);
    assert.deepEqual(state.merges, []);
  }
});

test('respects GitHub mergeability, closed PRs, other authors, forks and other base branches', async () => {
  const { io, state, input } = fixture();
  await scan(io);
  approve(state);
  state.pr.mergeable_state = 'blocked';
  await assert.rejects(mergeApproved(io, input), /blocked/);
  assert.deepEqual(state.merges, []);
  for (const change of [
    p => { p.state = 'closed'; }, p => { p.base = { ref: 'develop', repo }; },
    p => { p.user.login = 'another-author'; }, p => { p.head.repo = { full_name: 'fork/kitchen' }; },
  ]) {
    const { io, state, input } = fixture();
    change(state.pr);
    await scan(io);
    assert.deepEqual(state.messages, []);
    assert.equal(await mergeApproved(io, input), undefined);
  }
});

test('a concurrent push rejected by GitHub produces no deploy SHA', async () => {
  const { io, state, input } = fixture();
  await scan(io);
  approve(state);
  const gh = io.gh;
  io.gh = (path, method, body) => {
    if (method === 'PUT') {
      assert.equal(body.sha, sha);
      throw Error('GitHub HTTP 409');
    }
    return gh(path, method, body);
  };
  await assert.rejects(mergeApproved(io, input), /409/);
});
