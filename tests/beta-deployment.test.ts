import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { getBetaDeployment } from '../lib/beta-deployment';
import { middleware } from '../middleware';
import { getBetaDatabaseConfiguration } from '../lib/beta-database';

test('hosted beta requires dedicated database configuration and rejects copied stable credentials', () => {
  const stable = { NEXT_PUBLIC_SUPABASE_URL: 'https://stable.example.test/', SUPABASE_SERVICE_ROLE_KEY: 'stable-test-key' };
  assert.throws(() => getBetaDatabaseConfiguration(stable), /Separate beta database/);
  const beta = { HOME_CONSOLE_BETA_SUPABASE_URL: 'https://beta.example.test', HOME_CONSOLE_BETA_SUPABASE_SERVICE_ROLE_KEY: 'beta-test-key' };
  assert.deepEqual(getBetaDatabaseConfiguration({ ...stable, ...beta }), { url: 'https://beta.example.test', key: 'beta-test-key' });
  assert.throws(() => getBetaDatabaseConfiguration({ ...stable, ...beta, HOME_CONSOLE_BETA_SUPABASE_URL: stable.NEXT_PUBLIC_SUPABASE_URL }), /must not share/);
  assert.throws(() => getBetaDatabaseConfiguration({ ...stable, ...beta, NEXT_PUBLIC_SUPABASE_URL: 'https://BETA.example.test:443/' }), /must not share/);
  assert.throws(() => getBetaDatabaseConfiguration({ ...stable, ...beta, HOME_CONSOLE_BETA_SUPABASE_SERVICE_ROLE_KEY: stable.SUPABASE_SERVICE_ROLE_KEY }), /must not share/);
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
  assert.equal(visit().status, 401);
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
    for (const path of ['/api/kiosk', '/api/kiosk/order', '/api/voice/tool', '/api/voice/session', '/api/slack/interactions', '/api/cron/daily-standup', '/api/logistics/sync', '/api/recipes/context', '/api/spotify', '/api/weather', '/api/dinner-tips', '/guide']) {
      assert.equal(middleware(req(path, cookie)).status, 404, path);
    }
    for (const path of ['/', '/beta', '/beta/groceries', '/api/groceries']) {
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
