import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3005';
const cookie = 'grocery_dev_kiosk_key=home-console-groceries-local-only';
const get = (path, authenticated = false) => fetch(`${origin}${path}`, {
  headers: authenticated ? { Cookie: cookie } : {}, redirect: 'manual', signal: AbortSignal.timeout(15000),
});

for (const path of ['/beta', '/beta/groceries', '/api/groceries']) {
  assert.equal((await get(path)).status, 401, `${path} must require its beta device credential`);
  const response = await get(path, true);
  assert.equal(response.status, 200, path);
  if (path !== '/api/groceries') assert.match(await response.text(), /Back to kitchen/);
}
assert.equal((await get('/api/mcp')).status, 401, 'MCP must require its independent agent credential');
assert.equal((await get('/api/mcp', true)).status, 401, 'A device cookie must not authenticate MCP');
for (const path of ['/api/kiosk', '/api/kiosk/order', '/api/weather', '/api/voice/session',
  '/api/voice/tool', '/api/cron/daily-standup', '/api/slack/interactions', '/api/logistics/sync',
  '/api/recipes/context', '/api/spotify', '/api/dinner-tips']) {
  assert.equal((await get(path, true)).status, 404, `${path} must not run on beta`);
}
const home = await get('/', true);
assert.equal(home.status, 307);
assert.equal(new URL(home.headers.get('location'), origin).pathname, '/beta');
console.log('PASS: beta screens, return navigation markup, device/agent separation and normal API isolation. Read-only; no cart or grocery writes.');
