import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { POST } from '../app/api/slack/dotty/route';

test('Dotty wakes the GitHub review workflow for signed thumbs-up events', async t => {
  const settings = { DOTTY_SIGNING_SECRET: 'fixture-secret', DOTTY_CHANNEL_ID: 'C1', DOTTY_APPROVER_ID: 'U1',
    DOTTY_BOT_USER_ID: 'UBOT', DOTTY_REVIEW_DISPATCH_TOKEN: 'fixture-token',
    HOME_CONSOLE_BETA_DEPLOYMENT: '', HOME_CONSOLE_GROCERY_DEVELOPMENT: '' };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key];
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
    process.env[key] = value;
  }
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = oldFetch; });
  let calls = 0, status = 204;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/dpmald/home-console/actions/workflows/dotty-pr-review.yml/dispatches');
    assert.equal(options?.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(String(options.body)), { ref: 'main' });
    return new Response(null, { status });
  };
  const item = { type: 'message', channel: 'C1', ts: '1795000000.123456' };
  const event = { type: 'reaction_added', user: 'U1', item_user: 'UBOT', reaction: '+1', item };
  const callback = (patch: object) => ({ type: 'event_callback', event: { ...event, ...patch } });
  const send = (body: object, secret = 'fixture-secret', timestamp = String(Math.floor(Date.now() / 1000))) => {
    const raw = JSON.stringify(body);
    const signature = createHmac('sha256', secret).update('v0:' + timestamp + ':' + raw).digest('hex');
    return POST(new Request('https://kitchen.example.test/api/slack/dotty', { method: 'POST', body: raw,
      headers: { 'x-slack-request-timestamp': timestamp, 'x-slack-signature': 'v0=' + signature } }));
  };
  assert.equal((await send(callback({}), 'unrelated-app')).status, 401);
  assert.equal((await send(callback({}), 'fixture-secret', '1')).status, 401);
  assert.equal((await send(callback({}), 'fixture-secret', 'invalid')).status, 401);
  assert.deepEqual(await (await send({ type: 'url_verification', challenge: 'fixture' })).json(), { challenge: 'fixture' });
  for (const patch of [{ type: 'reaction_removed' }, { user: 'U2' }, { reaction: 'eyes' }, { item_user: 'U3' },
    { item: { ...item, channel: 'C2' } }, { item: { ...item, type: 'file' } }]) {
    assert.equal((await send(callback(patch))).status, 200);
  }
  assert.equal(calls, 0);
  for (const patch of [{}, { reaction: 'thumbsup::skin-tone-4' }, { item_user: undefined }]) {
    assert.equal((await send(callback(patch))).status, 200);
  }
  assert.equal(calls, 3);
  status = 503;
  assert.equal((await send(callback({}))).status, 503);
  process.env.HOME_CONSOLE_BETA_DEPLOYMENT = '1';
  assert.equal((await send(callback({}))).status, 404);
  assert.equal(calls, 4);
});
