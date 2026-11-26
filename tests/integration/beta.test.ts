import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync, fork } from 'node:child_process';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { checkGroceryFlow } from '../../scripts/grocery-ui-smoke';

test('disposable Beta kitchen', { timeout: 240000 }, async t => {
  const database = new URL(process.env.HOME_CONSOLE_PR_DATABASE_URL || '');
  assert.equal(database.host, '127.0.0.1:55442');
  assert.equal(database.pathname, '/home_console_pr_test');
  assert.equal(database.href, process.env.HOME_CONSOLE_GROCERY_DEV_DATABASE_URL);
  const deviceKey = process.env.KIOSK_ACCESS_TOKEN!;
  const server = fork('tests/integration/server.mjs', { execArgv: [], silent: false });
  const exited = once(server, 'exit');
  t.after(async () => {
    if (server.exitCode === null && server.signalCode === null) server.kill();
    await exited;
  });
  const origin = await Promise.race([
    once(server, 'message').then(([value]) => String(value)),
    exited.then(() => { throw new Error('Beta test server exited before startup'); }),
  ]);

  await t.test('Beta screens and API boundaries', () => {
    execFileSync(process.execPath, ['scripts/beta-http-check.mjs', new URL(origin).port], {
      stdio: 'inherit', env: { ...process.env, HOME_CONSOLE_PR_DEVICE_KEY: deviceKey },
    });
  });

  await t.test('the grocery screen accepts a typed item and refreshes verified cart results automatically', async t => {
    const browser = await chromium.launch({ channel: 'chrome' });
    t.after(() => browser.close());
    const page = await browser.newPage({ hasTouch: true, viewport: { width: 1920, height: 1080 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    assert.equal((await page.goto(origin + '/beta/groceries?key=' + deviceKey))?.status(), 200);
    await page.getByLabel('Item name').fill('Synthetic household turkey');
    await page.getByLabel('Quantity', { exact: true }).fill('1');
    await page.getByRole('button', { name: 'Add to shared list' }).tap();
    await page.getByRole('listitem').filter({ hasText: 'Synthetic household turkey' }).getByText('Pending').waitFor();

    await checkGroceryFlow(origin, deviceKey, process.env.HOME_CONSOLE_GROCERY_AGENT_KEY!);
    const verified = page.getByRole('listitem').filter({ hasText: 'SIMULATED-MILK' });
    // The display shows the matched product name, package and count, while IDs stay internal.
    await page.getByText(/Morton Williams Supermarket.*Synthetic milk \(1 carton\) × 2/).waitFor({ timeout: 20000 });
    assert.equal(await verified.count(), 0);
  });

  await t.test('a touch claim keeps the same cook and recipe after a page reload', async t => {
    const browser = await chromium.launch({ channel: 'chrome' });
    t.after(() => browser.close());
    const page = await browser.newPage({ hasTouch: true, viewport: { width: 1280, height: 720 } });
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const login = await page.goto(origin + '/beta?key=' + deviceKey);
    assert.equal(login?.status(), 200);
    const state = async () => {
      const response = await page.request.get(origin + '/api/kiosk');
      assert.equal(response.status(), 200);
      return (await response.json()).dinner;
    };
    assert.equal((await state()).chef, 'unclaimed');
    await page.getByRole('button', { name: /Dinner Hub/ }).last().tap();
    await page.getByRole('button', { name: /Warren.s cooking/i }).tap();
    const meal = 'Synthetic dinner for the reload test';
    await page.getByPlaceholder(/Charcuterie Board/).fill(meal);
    const saved = page.waitForResponse(r => r.url() === origin + '/api/kiosk' && r.request().method() === 'POST');
    await page.getByRole('button', { name: /Open Step-by-Step Recipe/ }).tap();
    const response = await saved;
    assert.equal(response.status(), 200, 'claim must be accepted by the API');
    assert.equal((await response.json()).dinner.chef, 'warren');
    assert.equal((await page.reload())?.status(), 200);
    await page.getByText('WARREN LEAD', { exact: true }).waitFor();
    await page.getByText(meal, { exact: true }).first().waitFor();
    const dinner = await state();
    assert.equal(dinner.chef, 'warren');
    assert.equal(dinner.recipe_name, meal);
    assert.equal(dinner.status, 'planned');
    assert.equal(dinner.claimed_via, 'kiosk');
  });

  await t.test('a held proposal adds nothing and a repeated approval adds the recipe only once', async () => {
    const { proposeCart, decideProposal } = await import('../../lib/cart');
    const { listBacklog } = await import('../../lib/domain');
    const input = { recipes: [{ name: 'Synthetic soup', ingredients: [{ name: 'carrot' }] }],
      include_household_requests: false };
    const held = (await proposeCart(input)).proposal;
    assert.equal(held.status, 'pending');
    assert.equal((await decideProposal(held.id, false, 'fixture')).status, 'rejected');
    assert.equal((await decideProposal(held.id, true, 'fixture')).status, 'rejected');
    assert.deepEqual(await listBacklog(), []);
    const next = (await proposeCart(input)).proposal;
    for (let i = 0; i < 2; i++) assert.equal((await decideProposal(next.id, true, 'fixture')).status, 'approved');
    assert.deepEqual((await listBacklog()).map(row => row.recipe_or_item_name), [input.recipes[0].name]);
  });

  await t.test('a voice follow-up selects a saved meal and a fresh board read confirms the assignment', async () => {
    const { executeVoiceTool } = await import('../../lib/voice/execute');
    for (const name of ['Synthetic green curry', 'Synthetic red curry']) {
      const receipt = await executeVoiceTool('add_fridge_item', { name, location: 'freezer' });
      assert.deepEqual(receipt.result, { ok: true, added: name });
    }
    const board = async () => {
      const response = await fetch(origin + '/api/kiosk', { headers: { Authorization: 'Bearer ' + deviceKey } });
      assert.equal(response.status, 200);
      return response.json();
    };
    const previous = (await board()).dinner;
    const ambiguous = await executeVoiceTool('plan_fridge_meal', { item: 'curry', chef: 'daniela' });
    const clarification = ambiguous.result as { ok: boolean; needs_clarification: boolean; choices: { ref: string; label: string }[] };
    assert.equal(clarification.ok, false);
    assert.equal(clarification.needs_clarification, true);
    assert.deepEqual((await board()).dinner, previous);
    const selected = clarification.choices.find((c) => c.label.startsWith('Synthetic red curry'));
    assert.ok(selected);
    const receipt = await executeVoiceTool('plan_fridge_meal', { item: selected.ref, chef: 'daniela' });
    assert.equal((receipt.result as { ok: boolean }).ok, true);
    const saved = (await board()).dinner;
    assert.equal(saved.recipe_name, 'Synthetic red curry');
    assert.equal(saved.linked_backlog_id, selected.ref);
    assert.equal(saved.chef, 'daniela');
    assert.equal(saved.claimed_via, 'voice');
  });
});
