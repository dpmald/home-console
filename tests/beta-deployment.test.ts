import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getBetaDeployment } from '../lib/beta-deployment';
import { GET as unlockForm, POST as unlockDevice } from '../app/unlock/route';
import { middleware } from '../middleware';
import { requireKioskRequest } from '../lib/kiosk-auth';
import { getBetaDatabaseConfiguration } from '../lib/beta-database';
import { POST as kitchenAction } from '../app/api/kiosk/route';
import { POST as groceryWrite } from '../app/api/groceries/route';
import { POST as voiceTool } from '../app/api/voice/tool/route';

test('hosted beta requires dedicated database configuration and rejects copied stable credentials', () => {
  const stable = { NEXT_PUBLIC_SUPABASE_URL: 'https://stable.example.test/', SUPABASE_SERVICE_ROLE_KEY: 'stable-test-key' };
  assert.throws(() => getBetaDatabaseConfiguration(stable), /Separate beta database/);
  const beta = { HOME_CONSOLE_BETA_SUPABASE_URL: 'https://beta.example.test', HOME_CONSOLE_BETA_SUPABASE_SERVICE_ROLE_KEY: 'beta-test-key' };
  assert.deepEqual(getBetaDatabaseConfiguration({ ...stable, ...beta }), { url: 'https://beta.example.test', key: 'beta-test-key' });
  assert.throws(() => getBetaDatabaseConfiguration({ ...stable, ...beta, HOME_CONSOLE_BETA_SUPABASE_URL: stable.NEXT_PUBLIC_SUPABASE_URL }), /must not share/);
  assert.throws(() => getBetaDatabaseConfiguration({ ...stable, ...beta, NEXT_PUBLIC_SUPABASE_URL: 'https://BETA.example.test:443/' }), /must not share/);
  assert.throws(() => getBetaDatabaseConfiguration({ ...stable, ...beta, HOME_CONSOLE_BETA_SUPABASE_SERVICE_ROLE_KEY: stable.SUPABASE_SERVICE_ROLE_KEY }), /must not share/);
  assert.throws(() => getBetaDatabaseConfiguration({ ...beta, HOME_CONSOLE_BETA_SUPABASE_URL: 'https://oovlsrfczswrmnmhqbpt.supabase.co' }), /family production/);
  for (const url of ['http://beta.example.test', 'https://user:password@beta.example.test', 'https://beta.example.test/?key=secret']) {
    assert.throws(() => getBetaDatabaseConfiguration({ ...beta, HOME_CONSOLE_BETA_SUPABASE_URL: url }), /Invalid beta database/);
  }
});

test('beta must be explicitly enabled and hosted return links have no local fallback', () => {
  assert.deepEqual(getBetaDeployment({}), { enabled: false, kitchenUrl: null, testData: false });
  assert.deepEqual(getBetaDeployment({ HOME_CONSOLE_BETA_DEPLOYMENT: '1', HOME_CONSOLE_GROCERY_DEVELOPMENT: '1', NODE_ENV: 'development' }),
    { enabled: true, kitchenUrl: 'http://localhost:3001/', testData: true });
  const production = { HOME_CONSOLE_BETA_DEPLOYMENT: '1', NODE_ENV: 'production' };
  assert.equal(getBetaDeployment(production).kitchenUrl, null);
  assert.equal(getBetaDeployment({ ...production, HOME_CONSOLE_KITCHEN_URL: 'http://localhost:3001/' }).kitchenUrl, null);
  assert.equal(getBetaDeployment({ ...production, HOME_CONSOLE_KITCHEN_URL: 'https://kitchen.example.test/' }).kitchenUrl, 'https://kitchen.example.test/');
  assert.equal(getBetaDeployment({ ...production, HOME_CONSOLE_KITCHEN_URL: 'https://kitchen.example.test/?key=secret' }).kitchenUrl, null);
});

test('first kitchen visit opens the local Beta hub and issues a separate device cookie', (t) => {
  const env: Record<string, string | undefined> = process.env;
  const settings = { NODE_ENV: 'development', HOME_CONSOLE_BETA_DEPLOYMENT: '1',
    HOME_CONSOLE_GROCERY_DEVELOPMENT: '1', KIOSK_ACCESS_TOKEN: 'home-console-groceries-local-only' };
  for (const [name, value] of Object.entries(settings)) {
    const previous = env[name];
    t.after(() => { if (previous === undefined) delete env[name]; else env[name] = previous; });
    env[name] = value;
  }
  const session = 'kiosk_key=home-console-local-only';
  const visit = (path = '/beta', host = 'localhost:3005', cookie = session, method = 'GET') =>
    middleware(new NextRequest(`http://${host}${path}`, { headers: { host, cookie }, method }));
  const response = visit();
  assert.equal(response.headers.get('x-middleware-next'), '1');
  const issued = response.cookies.get('grocery_dev_kiosk_key');
  assert.equal(issued?.value, settings.KIOSK_ACCESS_TOKEN);
  assert.ok(issued?.httpOnly);
  assert.equal(visit('/beta', 'localhost:3005', session + '; grocery_dev_kiosk_key=' + issued?.value).headers.get('set-cookie'), null);
  for (const denied of [visit('/api/groceries'), visit('/beta/groceries'), visit('/beta', 'localhost:3004'),
    visit('/beta', 'beta.example.test'), visit('/beta', 'localhost:3005', ''), visit('/beta', 'localhost:3005', session, 'POST')]) {
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('set-cookie'), null);
  }
  env.KIOSK_ACCESS_TOKEN = 'another-device-key';
  assert.equal(visit().status, 401);
  env.KIOSK_ACCESS_TOKEN = settings.KIOSK_ACCESS_TOKEN;
  env.NODE_ENV = 'production';
  assert.equal(new URL(visit().headers.get('location')!).pathname, '/unlock');
  assert.equal(visit('/api/kiosk').status, 401);
});

test('beta isolates normal APIs, fails closed for devices, and leaves MCP to its own auth', () => {
  const names = ['HOME_CONSOLE_BETA_DEPLOYMENT', 'HOME_CONSOLE_GROCERY_DEVELOPMENT', 'KIOSK_ACCESS_TOKEN'] as const;
  const previous = names.map(name => process.env[name]);
  const req = (path: string, cookie?: string) => new NextRequest(`http://localhost:3004${path}`, { headers: cookie ? { cookie } : {} });
  try {
    process.env.HOME_CONSOLE_BETA_DEPLOYMENT = '1';
    process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT = '1';
    process.env.KIOSK_ACCESS_TOKEN = 'synthetic-beta-key';
    const cookie = 'grocery_dev_kiosk_key=synthetic-beta-key';
    for (const path of ['/api/voice/tool', '/api/voice/session', '/api/slack/interactions', '/api/cron/daily-standup', '/api/logistics/sync', '/api/recipes/context', '/api/spotify', '/api/weather', '/api/dinner-tips']) {
      assert.equal(middleware(req(path, cookie)).status, 404, path);
    }
    for (const path of ['/', '/beta', '/beta/groceries', '/api/groceries', '/api/kiosk', '/api/kiosk/order', '/guide']) {
      assert.equal(middleware(req(path)).status, 401, path);
      assert.equal(middleware(req(path, 'kiosk_key=synthetic-beta-key')).status, 401, path);
      assert.equal(middleware(req(path, cookie)).headers.get('x-middleware-next'), '1', path);
    }
    assert.equal(middleware(req('/api/mcp')).headers.get('x-middleware-next'), '1');
    delete process.env.KIOSK_ACCESS_TOKEN;
    assert.equal(middleware(req('/beta')).status, 503);
    delete process.env.HOME_CONSOLE_BETA_DEPLOYMENT;
    for (const path of ['/beta', '/beta/groceries', '/api/groceries', '/api/mcp']) {
      assert.equal(middleware(req(path)).status, 404, path);
    }
    assert.equal(middleware(req('/')).headers.get('x-middleware-next'), '1');
  } finally {
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
  }
});

test('hosted Beta unlock requires a same-origin device key and sets a host-only device cookie', async (t) => {
  const env: Record<string, string | undefined> = process.env;
  for (const [name, value] of Object.entries({ NODE_ENV: 'production', HOME_CONSOLE_BETA_DEPLOYMENT: '1', HOME_CONSOLE_GROCERY_DEVELOPMENT: '', KIOSK_ACCESS_TOKEN: 'beta-device' })) {
    const previous = env[name];
    t.after(() => { if (previous === undefined) delete env[name]; else env[name] = previous; });
    env[name] = value;
  }
  const origin = 'https://beta.example.test';
  const attempt = (body: string, source = origin) => unlockDevice(new NextRequest(origin + '/unlock', {
    method: 'POST', headers: { origin: source, 'content-type': 'application/x-www-form-urlencoded' }, body,
  }));
  assert.equal(unlockForm().status, 200);
  assert.equal((await attempt('key=wrong')).status, 401);
  assert.equal((await attempt('key=beta-device', 'https://elsewhere.test')).status, 403);
  const unlocked = await attempt('key=beta-device');
  assert.equal(unlocked.status, 303);
  assert.equal(unlocked.headers.get('location'), origin + '/beta');
  assert.match(unlocked.headers.get('set-cookie') ?? '', /beta_kiosk_key=beta-device/);
  assert.match(unlocked.headers.get('set-cookie') ?? '', /HttpOnly/i);
  assert.match(unlocked.headers.get('set-cookie') ?? '', /Secure/i);
  env.HOME_CONSOLE_BETA_DEPLOYMENT = '0';
  assert.equal(unlockForm().status, 404);
});

test('public hosted Beta allows viewing and requires a trusted device for grocery and proposal writes', async (t) => {
  const env: Record<string, string | undefined> = process.env;
  for (const [name, value] of Object.entries({
    NODE_ENV: 'production', HOME_CONSOLE_BETA_DEPLOYMENT: '1', HOME_CONSOLE_GROCERY_DEVELOPMENT: '',
    HOME_CONSOLE_BETA_DEVICE_ACCESS: 'public', KIOSK_ACCESS_TOKEN: '',
  })) {
    const original = env[name];
    t.after(() => { if (original === undefined) delete env[name]; else env[name] = original; });
    env[name] = value;
  }
  const host = 'https://beta.example.test';
  const req = (path: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(host + path, init);
  for (const path of ['/', '/guide', '/beta', '/beta/groceries', '/api/groceries', '/api/kiosk', '/api/kiosk/order']) {
    const response = middleware(req(path));
    assert.equal(response.headers.get('x-middleware-next'), '1', path);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  assert.equal(unlockForm().status, 503);
  assert.equal(middleware(req('/beta?key=old&view=one')).headers.get('location'), host + '/beta?view=one');
  for (const path of ['/api/groceries', '/api/kiosk/order']) {
    assert.equal(requireKioskRequest(req(path)), null);
    const write = (headers: Record<string, string>) => requireKioskRequest(req(path, { method: 'POST', headers }), true);
    env.KIOSK_ACCESS_TOKEN = '';
    assert.equal(write({ origin: host })?.status, 503);
    env.KIOSK_ACCESS_TOKEN = 'beta-device';
    assert.equal(write({ origin: host })?.status, 401);
    const cookie = 'beta_kiosk_key=beta-device';
    assert.equal(write({ origin: host, cookie }), null);
    assert.equal(write({ authorization: 'Bearer beta-device' }), null);
    assert.equal(write({ origin: 'https://elsewhere.test', cookie })?.status, 403);
    assert.equal(write({ origin: host, cookie, 'sec-fetch-site': 'cross-site' })?.status, 403);
  }
  assert.equal(requireKioskRequest(req('/api/kiosk', { method: 'POST', headers: { origin: host } }), true), null);
  for (const action of [{ type:'add_grocery', name:'Synthetic' }, { type:'grocery_status', id:'synthetic', status:'needed' }]) {
    const retired = await kitchenAction(req('/api/kiosk', { method:'POST', headers:{ origin:host }, body: JSON.stringify(action) }));
    assert.equal(retired.status, 410);
    assert.equal((await retired.json()).grocery_url, '/beta/groceries');
  }
  const unlocked = await unlockDevice(req('/unlock', { method:'POST', headers: { origin: host, 'content-type':'application/x-www-form-urlencoded' }, body:'key=beta-device' }));
  assert.equal(unlocked.headers.get('location'), host + '/beta/groceries');
  assert.match(unlocked.headers.get('set-cookie') ?? '', /HttpOnly/i);
  env.KIOSK_ACCESS_TOKEN = '';
  assert.equal(middleware(req('/api/voice/session')).status, 404);
  assert.equal(requireKioskRequest(req('/api/voice/session'))?.status, 503);
  env.HOME_CONSOLE_GROCERY_DEVELOPMENT = '1';
  assert.equal(middleware(req('/beta')).status, 503);
  env.HOME_CONSOLE_BETA_DEPLOYMENT = '0';
  assert.equal(middleware(req('/beta')).status, 404);
  assert.equal(requireKioskRequest(req('/api/groceries'))?.status, 503);
});

test('family production forwards voice only from an unlocked device and gives legacy writers the shared URL', async t => {
  const origin = 'https://home-console-pied.vercel.app';
  const env: Record<string, string | undefined> = process.env;
  for (const [name, value] of Object.entries({ NODE_ENV: 'production', HOME_CONSOLE_BETA_DEPLOYMENT: '',
    HOME_CONSOLE_GROCERY_DEVELOPMENT: '', HOME_CONSOLE_BETA_URL: '', KIOSK_ACCESS_TOKEN: 'stable-test-device',
    HOME_CONSOLE_SHARED_GROCERY_DEVICE_KEY: 'beta-test-device' })) {
    const old = env[name];
    t.after(() => { if (old === undefined) delete env[name]; else env[name] = old; });
    env[name] = value;
  }
  const request = (path: string, payload: object, cookie = '') => new NextRequest(origin + path, { method:'POST', body: JSON.stringify(payload),
    headers: { cookie, origin, host:'home-console-pied.vercel.app', 'content-type':'application/json' } });
  const legacy = await kitchenAction(request('/api/kiosk', { type:'add_grocery', name:'Synthetic' }));
  assert.equal(legacy.status, 410);
  assert.equal((await legacy.json()).grocery_url, 'https://home-console-beta.vercel.app/beta/groceries');
  assert.equal((await groceryWrite(request('/api/groceries', {}))).status, 404);

  let forwarded = 0;
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    forwarded++;
    assert.equal(url.href, 'https://home-console-beta.vercel.app/api/groceries');
    assert.equal(init.redirect, 'error');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer beta-test-device');
    assert.deepEqual(JSON.parse(String(init.body)), { action:'add', operation_id:'voice:call_123', items:[{name:'turkey',quantity:'1',notes:null}] });
    return Response.json({ ok:true, added_ids:['synthetic'], items:[] });
  });
  const args = { name:'add_grocery_items', call_id:'call_123', args:{items:[{name:'turkey',quantity:'1'}]} };
  assert.equal((await voiceTool(request('/api/voice/tool', args))).status, 401);
  const unlocked = 'kiosk_key=stable-test-device';
  assert.equal((await voiceTool(request('/api/voice/tool', args, unlocked))).status, 200);
  env.HOME_CONSOLE_BETA_URL = 'https://other.example.test';
  assert.equal((await voiceTool(request('/api/voice/tool', args, unlocked))).status, 503);
  assert.equal(forwarded, 1);
});
