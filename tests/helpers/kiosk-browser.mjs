import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

export async function openKitchen(t, options) {
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
  const page = await browser.newPage({ hasTouch: true, ...options });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 503, body: '{}' });
    return route.continue();
  });
  await page.goto(origin);
  return page;
}
