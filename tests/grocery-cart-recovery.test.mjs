import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Use the offline build. The public page and unlock cookie are real. Rows and
// device API responses are fixtures, so no database or cart is involved.
test('an unlocked display can retry a checked missing cart item after its previous attempt expires', async t => {
  for (const [, name] of readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) process.env[name] = '';
  Object.assign(process.env, { NODE_ENV: 'production', HOME_CONSOLE_BETA_DEPLOYMENT: '1',
    HOME_CONSOLE_BETA_DEVICE_ACCESS: 'public', HOME_CONSOLE_KITCHEN_URL: 'https://kitchen.example.test/',
    KIOSK_ACCESS_TOKEN: 'synthetic-device-key' });
  const { default: next } = await import('next');
  const app = next({ dev: false, hostname: '127.0.0.1' });
  await app.prepare();
  const server = createServer(app.getRequestHandler()).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await app.close();
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const attempt = { attempt_id:'00000000-0000-4000-8000-000000000020', revision:1, retailer:'Wegmans',
    product_name:'Synthetic deli turkey', product_size:'12 oz', product_quantity:1,
    request_name:'Synthetic turkey', request_quantity:'1', lease_expires_at:new Date(Date.now()+60000).toISOString() };
  const item = { id:'00000000-0000-4000-8000-000000000010', revision:2, cart_authorized_revision:2,
    name:'Updated turkey', quantity:'1', status:'needs_attention', result:{ requires_reconciliation:true, unresolved_attempt:attempt } };
  let sent;
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname !== '/api/groceries') return route.continue();
    if (route.request().method() === 'POST') {
      sent = route.request().postDataJSON();
      return route.fulfill({ json:{ ok:true, items:[{ ...item, status:'needed', result:null }] } });
    }
    return route.fulfill({ json:{ ok:true, items:[item] } });
  });
  assert.equal((await page.goto(origin + '/beta/groceries'))?.status(), 200);
  const retry = page.getByRole('button', { name:'I checked the cart. Retry missing item' });
  await page.getByRole('link', { name:'Unlock this device' }).waitFor();
  assert.equal(await retry.count(), 0);
  await page.context().addCookies([{ name:'beta_kiosk_key', value:'synthetic-device-key', url:origin, httpOnly:true }]);
  await page.reload();
  await page.getByText(/Check the Wegmans cart for Synthetic deli turkey/).waitFor();
  await page.getByText(/The worker can still finish its attempt/).waitFor();
  assert.equal(await retry.isDisabled(), true);
  assert.equal(await page.getByRole('button', { name:'Return to pending' }).count(), 0);
  attempt.lease_expires_at = new Date(Date.now()-1000).toISOString();
  await page.getByRole('button', { name:'Refresh', exact:true }).click();
  await retry.click();
  await page.getByText('Your cart check was saved. The request is pending again.').waitFor();
  assert.deepEqual(sent, { action:'retry_missing', id:item.id, revision:2, attempt_id:attempt.attempt_id });
});
