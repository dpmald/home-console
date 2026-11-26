import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { NextRequest } from 'next/server';
import { POST as callTool } from '../app/api/voice/tool/route';
import { POST as createSession } from '../app/api/voice/session/route';
import { kitchenOverview, matchVoiceTarget, scheduleWindow } from '../lib/voice/context';
import { voicePage } from '../lib/voice/request';
import { demoKitchenState } from '../lib/demo';
import { controlSpotify } from '../lib/spotify';

function environment(t: TestContext, values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    const previous = process.env[key];
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
}

const origin = 'https://kitchen.example.test';
function request(path: string, body: string, type = 'application/json') {
  return new NextRequest(origin + path, { method: 'POST', body,
    headers: { origin, authorization: 'Bearer synthetic-kiosk', 'content-type': type } });
}
const voiceTool = (name: string, args: object = {}) =>
  callTool(request('/api/voice/tool', JSON.stringify({ name, args, call_id: 'sample' })));

test('a vague title yields choices, and a follow-up row ref resolves the selected item', () => {
  const rows = [{ id: 'a', title: 'Lemon pasta' }, { id: 'b', title: 'Pasta salad' }];
  const find = (query: string) => matchVoiceTarget(rows, query, (row) => row.title);
  assert.equal(find('the pasta').match, undefined);
  assert.deepEqual(find('the pasta').choices.map((choice) => choice.label), ['Lemon pasta', 'Pasta salad']);
  assert.equal(find('Bolognese pasta').choices.length, 0);
  assert.equal(find('lemon pasta').match, rows[0]);
  assert.equal(find('b').match, rows[1]);
  assert.equal(find('').match, undefined);
});

test('range validation uses actual local dates and permits one week at a time', () => {
  assert.deepEqual(scheduleWindow('2028-02-28', 3), { first: '2028-02-28', last: '2028-03-01' });
  for (const start of ['2026-02-29', '2026-13-01', 'next Wednesday', null]) assert.equal(scheduleWindow(start, 1), null);
  for (const days of [0, 8, '3', 1.25, null]) assert.equal(scheduleWindow('2026-02-01', days), null);
});

test('inventory and a proposed meal stay distinct from shopping requests and delivery', () => {
  const state = demoKitchenState('2026-11-01');
  state.backlog.push({ id: 'sample', recipe_or_item_name: 'Pea soup', location: 'freezer', delivery_date: state.date,
    key_perishables: ['peas'], added_by: null, status: 'in_fridge' });
  state.groceries.push({ id: 'request', name: 'More peas', status: 'needed', quantity: null, added_by: null });
  state.orders.push({ id:'proposal', delivery_date: state.date, status:'approved', kept_recipes:[{name:'Carrot soup'}],
    target_meal_count: 1, created_at: state.date, decided_at: null, decided_by: null, grocery_item_ids: [], slack_channel: null,
    slack_ts: null, dropped_recipes: [], items: [], skipped_items: [], backlog_snapshot: [] });
  const overview = kitchenOverview(state);
  assert.deepEqual(overview.inventory.map((row) => [row.name, row.location]), [['Pea soup', 'freezer']]);
  assert.deepEqual(overview.kitchen_only_pantry_requests, [{ name: 'More peas', quantity: null, status: 'needed' }]);
  assert.equal(overview.recent_cart_proposals[0].approval_status, 'approved');
  assert.equal(overview.recent_cart_proposals[0].recipes[0].name, 'Carrot soup');
  state.orders.unshift({ ...state.orders[0], status: 'pending', slack_ts: 'private-timestamp',
    items: [{ name: 'Carrots', quantity: '2 lb', source: 'Carrot soup' }] });
  const proposals = kitchenOverview(state).recent_cart_proposals;
  assert.deepEqual(proposals[0].items_up_for_approval, [{ name: 'Carrots', quantity: '2 lb', source: 'Carrot soup' }]);
  assert.equal(proposals[1].items_up_for_approval, undefined);
  assert.doesNotMatch(JSON.stringify(proposals), /private-timestamp|slack_ts|grocery_item_ids|backlog_snapshot/);
  const rows = Array.from({ length: 18 }, (_, index) => index);
  const first = voicePage(rows, undefined);
  assert.equal(first.total, 18);
  const last = voicePage(rows, first.next_offset);
  assert.deepEqual([...first.page, ...last.page], rows);
  assert.equal(last.next_offset, null);
  assert.throws(() => voicePage(rows, -1));
});

test('authenticated calendar reads include general events, times and requested notes; ambiguous assignments never write', async (t) => {
  environment(t, {
    KIOSK_ACCESS_TOKEN: 'synthetic-kiosk', HOME_CONSOLE_GROCERY_DEVELOPMENT: undefined, HOME_CONSOLE_BETA_DEPLOYMENT: undefined,
    GOOGLE_CALENDAR_ICS_URLS: undefined, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
  });
  const rows = ['Music lesson', 'North pickup', 'South pickup'].map((title, i) => ({
    id: String(i), title, description: 'Bring a notebook', source_calendar: i ? 'family_google' : 'daniela_google',
    logistics_type: i ? 'pickup' : 'general', assigned_parent: 'unassigned',
    start_time: '2026-11-01T15:00:00Z', end_time: '2026-11-01T16:00:00Z',
  }));
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(init.method, 'GET');
    assert.equal(url.origin, 'http://127.0.0.1:54321');
    assert.equal(url.pathname, '/rest/v1/family_logistics');
    requests.push(url);
    return Response.json(rows);
  });
  const calendar = await voiceTool('get_schedule', { start_date: '2026-11-01', include_notes: true });
  assert.equal(calendar.status, 200);
  const { result } = await calendar.json();
  assert.equal(result.ok, true);
  assert.equal(result.events[0].title, 'Music lesson');
  assert.equal(result.events[0].notes, 'Bring a notebook');
  assert.equal(result.events[0].can_assign, false);
  assert.equal(result.events[1].can_assign, true);
  // The family day contains the extra hour when US clocks go back.
  assert.equal(requests[0].searchParams.get('end_time'), 'gt.2026-11-01T04:00:00.000Z');
  assert.equal(requests[0].searchParams.get('start_time'), 'lt.2026-11-02T05:00:00.000Z');

  const ambiguous = await voiceTool('assign_logistics', { date: '2026-11-01', event: 'pickup', parent: 'daniela' });
  const { result: choice } = await ambiguous.json();
  assert.equal(choice.ok, false);
  assert.equal(choice.needs_clarification, true);
  assert.deepEqual(choice.choices.map((c: { ref: string }) => c.ref), ['1', '2']);
  assert.equal(requests.length, 2);
});

test('session advertises board and household tools, and synthetic sessions exclude live integrations', async (t) => {
  environment(t, {
    KIOSK_ACCESS_TOKEN: 'synthetic-kiosk', OPENAI_API_KEY: 'synthetic', HOME_CONSOLE_GROCERY_DEVELOPMENT: undefined,
    HOME_CONSOLE_BETA_DEPLOYMENT: undefined,
  });
  let names: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/realtime/calls');
    const body = init.body as FormData;
    assert.equal(body.get('sdp'), 'synthetic offer');
    const config = JSON.parse(String(body.get('session')));
    names = config.tools.map((tool: { name: string }) => tool.name);
    return new Response('synthetic answer', { status: 200 });
  });
  const connect = () => createSession(request('/api/voice/session', 'synthetic offer', 'application/sdp'));
  assert.equal((await connect()).status, 200);
  for (const name of ['get_console_context', 'get_today_overview', 'show_console_view', 'show_recipe_view', 'set_console_theme', 'control_recipe_step', 'control_timer', 'get_schedule', 'plan_fridge_meal', 'get_grocery_requests', 'post_developer_feedback']) {
    assert.ok(names.includes(name), name);
  }
  process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT = '1';
  assert.equal((await connect()).status, 200);
  assert.ok(names.includes('get_console_context') && names.includes('add_grocery_items'));
  for (const name of ['get_schedule', 'set_dinner', 'post_to_slack', 'control_spotify', 'play_npr', 'post_developer_feedback']) assert.ok(!names.includes(name), name);
  assert.equal((await voiceTool('get_schedule')).status, 400);
});

test('grocery cancellation carries the exact revision and verifies the changed row', async (t) => {
  environment(t, {
    KIOSK_ACCESS_TOKEN: 'synthetic-kiosk', HOME_CONSOLE_GROCERY_DEVELOPMENT: undefined, HOME_CONSOLE_BETA_DEPLOYMENT: undefined,
    HOME_CONSOLE_BETA_URL: 'https://home-console-beta.vercel.app', HOME_CONSOLE_SHARED_GROCERY_DEVICE_KEY: 'synthetic-shared',
  });
  const id = 'aaec7aec-ac0f-498e-ae88-4343ccf0fe23';
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    assert.equal(url.href, 'https://home-console-beta.vercel.app/api/groceries');
    assert.deepEqual(JSON.parse(String(init.body)), { action: 'status', id, revision: 3, status: 'cancelled' });
    return Response.json({ ok: true, items: [{ id, status: cancelled ? 'cancelled' : 'needed' }] });
  });
  const cancel = () => voiceTool('set_grocery_request_status', { id, revision: 3, status: 'cancelled' });
  assert.equal((await cancel()).status, 503);
  cancelled = true;
  assert.deepEqual((await (await cancel()).json()).result, { ok: true, id, status: 'cancelled' });
  assert.equal((await voiceTool('set_grocery_request_status', { id, revision: 3, status: 'in_cart' })).status, 400);
});

test('Spotify declines rejected playback and missing search results', async (t) => {
  environment(t, { SPOTIFY_CLIENT_ID: 'test', SPOTIFY_CLIENT_SECRET: 'test', SPOTIFY_REFRESH_TOKEN: 'test' });
  let playCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    if (url.endsWith('/api/token')) return Response.json({ access_token: 'test', expires_in: 0 });
    if (url.endsWith('/devices')) return Response.json({ devices: [{ id: 'kitchen', name: 'Kitchen', is_active: true }] });
    if (url.includes('/search?')) return Response.json({ tracks: { items: [] } });
    if (url.includes('/play?')) playCalls++;
    return new Response(null, { status: 403 });
  });
  for (const op of ['pause', 'next', 'previous', 'play'] as const) assert.equal((await controlSpotify({ op })).ok, false);
  assert.equal((await controlSpotify({ op: 'play', query: 'missing track' })).ok, false);
  assert.equal(playCalls, 1);
});
