import assert from 'node:assert/strict';
import test from 'node:test';
import { openKitchen } from './helpers/kiosk-browser.mjs';

// Run with npm run test:dinner-scroll, using the offline build and installed Chrome.
test('Dinner Hub accepts touch swipes on the guide, shortcuts and nested recipe lists', async (t) => {
  const page = await openKitchen(t, { viewport: { width: 1280, height: 720 } });
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

  await page.getByRole('button', { name: /Dinner Hub/ }).last().tap();
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
});
