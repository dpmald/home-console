import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import { POST } from '../app/api/voice/tool/route';

const root = 'https://kitchen.example.test';
const channelId = 'C0123456789';
const timestamp = '1764000000.123456';
const feedback = { recipient: 'codex', kind: 'bug', title: 'Timer repeats', details: 'Closing the timer should silence it.' };

function configure(t: TestContext) {
  const settings: Record<string, string | undefined> = {
    KIOSK_ACCESS_TOKEN: 'synthetic-device-key', SLACK_BOT_TOKEN: 'synthetic-bot',
    SLACK_CHANNEL_BACKLOG: undefined, HOME_CONSOLE_GROCERY_DEVELOPMENT: undefined, HOME_CONSOLE_BETA_DEPLOYMENT: undefined,
  };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

function post(args: Record<string, unknown> = feedback, id: string | null = 'call_synthetic_feedback',
  headers: Record<string, string> = {}) {
  return POST(new NextRequest(root + '/api/voice/tool', {
    method: 'POST', headers: { origin: root, authorization: 'Bearer synthetic-device-key', 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ name: 'post_developer_feedback', args, ...(id !== null && { call_id: id }) }),
  }));
}

test('voice files both kinds of feedback for the chosen assistant in the backlog and returns the Slack receipt', async t => {
  configure(t);
  const messages: { channel: string; text: string; client_msg_id: string; mrkdwn?: boolean; link_names?: boolean }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init: RequestInit) => {
    assert.equal(String(input), 'https://slack.com/api/chat.postMessage');
    assert.equal(init.method, 'POST');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer synthetic-bot');
    messages.push(JSON.parse(String(init.body)));
    return Response.json({ ok: true, channel: channelId, ts: timestamp });
  });
  for (const [recipient, kind, destination] of [['codex', 'bug', '#home-console'], ['gemini', 'feature', channelId]]) {
    if (destination === channelId) process.env.SLACK_CHANNEL_BACKLOG = channelId;
    const title = 'Timer request <!here>';
    const details = 'Sample detail <@U12345678> & <!channel>';
    const response = await post({ recipient, kind, title, details }, 'call_' + recipient);
    assert.equal(response.status, 200);
    const receipt = (await response.json()).result;
    assert.equal(receipt.ok, true);
    assert.equal(receipt.recipient, recipient);
    assert.equal(receipt.kind, kind);
    assert.equal(receipt.channel, channelId);
    assert.equal(receipt.ts, timestamp);

    const message = messages.at(-1)!;
    assert.equal(message.channel, destination);
    const owner = recipient === 'codex' ? 'Warren' : 'Daniela';
    for (const word of [recipient, owner, kind, 'Timer request', 'Sample detail']) {
      assert.ok(message.text.toLowerCase().includes(word.toLowerCase()), word);
    }
    assert.doesNotMatch(message.text, /<!here>|<@U12345678>|<!channel>/);
    assert.equal(message.mrkdwn, false);
    assert.equal(message.link_names, false);
  }
  assert.equal(messages.length, 2);
  await post({ ...feedback, recipient: 'gemini', kind: 'feature', title: 'Timer request <!here>',
    details: 'Sample detail <@U12345678> & <!channel>' }, 'call_gemini');
  assert.ok(messages[0].client_msg_id);
  assert.notEqual(messages[0].client_msg_id, messages[1].client_msg_id);
  assert.equal(messages[1].client_msg_id, messages[2].client_msg_id);
});

test('feedback requires a valid tool call from the authenticated family console before contacting Slack', async t => {
  configure(t);
  const network = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected external request'); });
  for (const args of [
    { ...feedback, recipient: 'someone-else' }, { ...feedback, kind: 'other' },
    { ...feedback, title: '  ' }, { ...feedback, title: 'a'.repeat(121) },
    { ...feedback, details: ' ' }, { ...feedback, details: 'b'.repeat(2001) },
    { ...feedback, channel: '#other' },
  ]) assert.equal((await post(args)).status, 400);
  assert.equal((await post(feedback, null)).status, 400);
  assert.equal((await post(feedback, 'bad/id')).status, 400);
  assert.equal((await post(feedback, 'call', { authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await post(feedback, 'call', { origin: 'https://another.example.test' })).status, 403);
  process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT = '1';
  assert.equal((await post()).ok, false);
  delete process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT;
  process.env.HOME_CONSOLE_BETA_DEPLOYMENT = '1';
  assert.equal((await post()).ok, false);
  assert.equal(network.mock.callCount(), 0);
});

test('an unsuccessful or incomplete Slack acknowledgement never becomes a successful agent handoff', async t => {
  configure(t);
  process.env.SLACK_CHANNEL_BACKLOG = channelId;
  const replies = [
    Response.json({ ok: false, error: 'channel_not_found' }),
    Response.json({ ok: true, channel: channelId }),
    Response.json({ ok: true, ts: timestamp }),
    Response.json({ ok: true, ts: timestamp, channel: 'C9999999999' }),
    Response.json({ ok: true, ts: timestamp, channel: channelId }, { status: 502 }),
  ];
  let index = 0;
  t.mock.method(globalThis, 'fetch', async () => replies[index++]);
  for (let i = 0; i < replies.length; i++) {
    const response = await post(feedback, 'call_' + i);
    assert.equal(response.ok, false);
    assert.equal((await response.json()).result.ok, false);
  }
  assert.equal(index, replies.length);
});
