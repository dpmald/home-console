import assert from 'node:assert/strict';
import test from 'node:test';
import { hasVoiceRecipe, readViewRequest, recipeControl } from '../lib/voice/console-view';

test('voice navigation keeps the current family filter or applies an explicit one', () => {
  assert.deepEqual(readViewRequest({ view: 'timeline', member: 'school' }, 'all'), { view: 'timeline', member_filter: 'school' });
  assert.deepEqual(readViewRequest({ view: 'dinner' }, 'warren'), { view: 'dinner', member_filter: 'warren' });
  assert.throws(() => readViewRequest({ view: 'url' }, 'all'));
  assert.throws(() => readViewRequest({ view: 'ambient', member: 'unknown' }, 'all'));
});

test('voice reports instructions only for a confirmed matching recipe', () => {
  assert.ok(hasVoiceRecipe('saved', 'recipe', 'Crispy Miso Salmon Rice Bowls', true));
  assert.ok(hasVoiceRecipe('saved', 'recipe', 'Soup', false));
  assert.equal(hasVoiceRecipe('saved', 'recipe', 'Soup', true), false);
  assert.equal(hasVoiceRecipe('saved', 'capture', 'Soup', false), false);
  assert.equal(hasVoiceRecipe('demo', 'recipe', 'Soup', false), false);
  assert.equal(hasVoiceRecipe('unconfirmed', 'recipe', 'Soup', false), false);
});

test('recipe navigation selects the correct step and resets or resumes its own timer', () => {
  const steps = [{ defaultTimerSecs: 10 }, { defaultTimerSecs: 70 }];
  assert.deepEqual(recipeControl('next', steps, 0, 2, true), { index: 1, seconds: 70, running: false });
  assert.deepEqual(recipeControl('previous', steps, 1, 11, true), { index: 0, seconds: 10, running: false });
  assert.deepEqual(recipeControl('start_timer', steps, 1, 11, false), { index: 1, seconds: 11, running: true });
  assert.deepEqual(recipeControl('pause_timer', steps, 1, 11, true), { index: 1, seconds: 11, running: false });
  assert.deepEqual(recipeControl('start_timer', steps, 1, 0, false), { index: 1, seconds: 70, running: true });
  assert.throws(() => recipeControl('next', steps, 1, 70, false));
  assert.throws(() => recipeControl('previous', steps, 0, 70, false));
});
