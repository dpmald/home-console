import assert from 'node:assert/strict';
import test from 'node:test';
import { openKitchen } from './helpers/kiosk-browser.mjs';

test('phone views scroll above a reachable dock and keep dinner actions on screen', async (t) => {
  const page = await openKitchen(t, { viewport: { width: 390, height: 844 }, isMobile: true });
  const dock = page.locator('.hearth-dock');
  const content = page.locator('.hearth-content');
  const guide = page.getByRole('region', { name: 'Dinner guide' });

  for (const [width, height] of [[390, 844], [320, 568]]) {
    await page.setViewportSize({ width, height });
    await dock.getByRole('button', { name: 'Today', exact: true }).tap();
    const today = page.getByRole('heading', { name: "Tonight's Dinner Decision" });
    await today.waitFor();
    const dockBox = await dock.boundingBox();
    const viewBox = await content.boundingBox();
    assert.ok(viewBox.y + viewBox.height <= dockBox.y + 1);
    assert.ok(dockBox.y + dockBox.height <= height + 1);
    assert.equal(await content.evaluate(el => el.scrollWidth), width);
    const clock = await page.locator('.glance-card').boundingBox();
    assert.ok((await today.boundingBox()).y >= clock.y + clock.height);
    await page.getByRole('button', { name: /Browse Ideas/ }).scrollIntoViewIfNeeded();
    await content.evaluate(el => el.scrollTo(0, el.scrollHeight));
    assert.ok(await content.evaluate(el => el.scrollTop > 0));
    assert.equal((await dock.boundingBox()).y, dockBox.y);

    await dock.getByRole('button', { name: 'More', exact: true }).tap();
    assert.ok(await dock.getByRole('link', { name: /Beta/ }).isVisible());
    await dock.getByRole('button', { name: 'Family', exact: true }).tap();
    await page.getByRole('heading', { name: /Wesley.s Chores/ }).waitFor();
    assert.ok(await dock.getByRole('link', { name: /Beta/ }).isHidden());

    await dock.getByRole('button', { name: 'Dinner', exact: true }).tap();
    const chef = guide.getByRole('button', { name: /Warren.s cooking/i });
    const box = await chef.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width);
    await chef.tap();
    const recipe = guide.getByRole('button', { name: /Open Step-by-Step Recipe/i });
    await recipe.tap();
    await guide.getByRole('button', { name: /Tips & Photo View/i }).waitFor();
    assert.equal(await content.evaluate(el => el.scrollTop), 0);
    const facts = await guide.locator('.recipe-facts').boundingBox();
    assert.ok(facts.x >= 0 && facts.x + facts.width <= width);
    await guide.getByRole('button', { name: 'Reset', exact: true }).tap();
    await chef.waitFor();
  }
});
