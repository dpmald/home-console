import assert from 'node:assert/strict';
import test from 'node:test';
import { createDinnerGuideLoader } from '../lib/dinner-guide';

test('touch and voice share one in-flight request for each meal and guide view', async () => {
  const urls: string[] = [];
  const load = createDinnerGuideLoader(async input => {
    const url = String(input);
    urls.push(url);
    const guide = url.includes('mode=recipe') ? { steps: [{ instruction: 'Chop vegetables' }] } : { tips: [{ detail: 'Serve warm' }] };
    return Response.json({ mealTitle: 'Soup & rice', ...guide });
  });
  const steps = load('steps', 'Soup & rice');
  assert.equal(load('steps', 'Soup & rice'), steps);
  const [recipe, tips] = await Promise.all([steps, load('tips', 'Soup & rice')]);
  assert.ok('steps' in recipe && 'tips' in tips);
  assert.deepEqual(urls, ['/api/dinner-tips?meal=Soup%20%26%20rice&mode=recipe', '/api/dinner-tips?meal=Soup%20%26%20rice&mode=tips']);
});

test('a mismatched, empty or unavailable guide cannot confirm readiness and can be retried', async () => {
  const replies = [
    new Response(null, { status: 503 }),
    Response.json({ mealTitle: 'Other meal', steps: [{ stage: 'Prep' }] }),
    Response.json({ mealTitle: 'Soup', tips: [{ detail: 'Serve' }] }),
    Response.json({ mealTitle: 'Soup', steps: [] }),
    Response.json({ mealTitle: 'Soup', steps: [{ stage: 'Prep' }] }),
  ];
  const load = createDinnerGuideLoader(async () => replies.shift()!);
  for (let n = 0; n < 4; n++) await assert.rejects(load('steps', 'Soup'));
  assert.ok('steps' in await load('steps', 'Soup'));
});
