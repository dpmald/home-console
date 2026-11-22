import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { chromium } from 'playwright-core';

// Run with npm run test:dinner-scroll, using the offline build and installed Chrome.
test('the kitchen supports Dinner Hub touch navigation and opens shared grocery requests on the configured Beta', async (t) => {
  process.env.NODE_ENV = 'production';
  for (const [, name] of readFileSync('.env.example', 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)) {
    process.env[name] = '';
  }
  process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT = '1';
  process.env.HOME_CONSOLE_BETA_URL = 'https://beta.example.test/beta';
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, hasTouch: true });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, body: '{}' });
    return route.continue();
  });
  const touch = await page.context().newCDPSession(page);
  async function swipeUp(panel, inset = 12) {
    const box = await panel.boundingBox();
    const x = box.x + inset;
    const y = box.y + box.height * 0.8;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 8; step++) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x, y: y - box.height * 0.55 * step / 8 }],
      });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(el => el.scrollTop > 0, await panel.elementHandle());
  }
  const top = panel => panel.evaluate(el => el.scrollTop);
  const dock = page.locator('.hearth-dock');
  const guide = page.getByRole('region', { name: 'Dinner guide' });
  const rail = page.getByRole('complementary', { name: 'Dinner shortcuts' });

  await page.goto(origin);
  await page.getByRole('button', { name: /Dinner Hub/ }).last().tap();
  const listLink = page.getByRole('link', { name: 'Shared grocery list' });
  const expectedListUrl = 'https://beta.example.test/beta/groceries';
  assert.equal(await rail.getByRole('link', { name: 'Shared grocery list' }).getAttribute('href'), expectedListUrl);
  const dockY = (await dock.boundingBox()).y;
  await swipeUp(guide);
  assert.equal(await top(rail), 0);
  await swipeUp(rail);
  assert.equal((await dock.boundingBox()).y, dockY);

  await guide.getByRole('button', { name: /Warren.s cooking/i }).tap();
  const openRecipe = guide.getByRole('button', { name: /Open Step-by-Step Recipe/i });
  await openRecipe.waitFor();
  assert.equal(await top(guide), 0);
  await swipeUp(guide);
  await openRecipe.tap();
  const tips = guide.getByRole('button', { name: /Tips & Photo View/i });
  await tips.waitFor();
  assert.equal(await top(guide), 0);
  await swipeUp(guide);
  await swipeUp(guide);
  await page.waitForFunction(el => el.scrollTop + el.clientHeight >= el.scrollHeight - 1, await guide.elementHandle());
  const lists = guide.locator('div[style*="overflow-y: auto"]');
  assert.equal(await lists.count(), 2);
  for (const list of await lists.all()) {
    await swipeUp(list, 45);
  }
  await tips.tap();
  await guide.getByRole('button', { name: /Step-by-Step Guide/i }).waitFor();
  assert.equal(await top(guide), 0);
  await swipeUp(guide);
  assert.equal((await dock.boundingBox()).y, dockY);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(origin);
  await dock.getByRole('button', { name: /Chores & Schedule/ }).tap();
  const pantry = page.getByText(/^Kitchen-only pantry list/);
  const pantryItem = page.getByRole('textbox', { name: 'Kitchen pantry item' });
  assert.equal(await pantryItem.isVisible(), false);
  await pantry.tap();
  assert.equal(await pantryItem.count(), 0);
  assert.equal(await listLink.getAttribute('target'), '_top');
  assert.equal(await listLink.getAttribute('referrerpolicy'), 'no-referrer');
  await page.route(expectedListUrl, route => route.fulfill({ contentType: 'text/html', body: '<h1>Beta grocery fixture</h1>' }));
  await listLink.tap();
  await page.waitForURL(expectedListUrl);

  // Disabling Beta still leaves the regular pantry form usable.
  process.env.HOME_CONSOLE_BETA_URL = 'off';
  await page.goto(origin);
  await dock.getByRole('button', { name: /Chores & Schedule/ }).tap();
  assert.equal(await listLink.count(), 0);
  assert.equal(await pantryItem.isVisible(), true);
});
