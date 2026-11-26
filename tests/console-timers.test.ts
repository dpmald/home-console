import assert from 'node:assert/strict';
import test from 'node:test';
import { createKitchenTimer, describeTimer, findKitchenTimer, updateKitchenTimer } from '../lib/voice/console-timers';

test('separate named timers can pause, resume and cancel individually', () => {
  const pasta = createKitchenTimer({ label: 'Pasta', minutes: 1, seconds: 30 }, 0);
  const sauce = createKitchenTimer({ label: 'Sauce', seconds: 45 }, 0);
  assert.notEqual(pasta.id, sauce.id);
  assert.equal(findKitchenTimer([pasta, sauce], ' pasta '), pasta);
  assert.throws(() => findKitchenTimer([pasta, sauce], undefined), /more than one/i);
  assert.throws(() => findKitchenTimer([pasta], 'toast'), /no matching/i);
  const paused = updateKitchenTimer(pasta, 'pause', 15000)!;
  assert.deepEqual(describeTimer(paused, 30000), { label: 'Pasta', remaining_seconds: 75, status: 'paused' });
  const extended = updateKitchenTimer(paused, 'add_minute', 30000)!;
  const resumed = updateKitchenTimer(extended, 'resume', 45000)!;
  assert.deepEqual(describeTimer(resumed, 50000), { label: 'Pasta', remaining_seconds: 130, status: 'running' });
  assert.equal(updateKitchenTimer(resumed, 'cancel'), null);
  assert.equal(describeTimer(sauce, 50000).status, 'finished');
});

test('an expired kitchen timer gets a full minute when extended and can be reset', () => {
  const timer = createKitchenTimer({ seconds: 5 }, 0);
  assert.throws(() => updateKitchenTimer(timer, 'resume', 100000), /finished/);
  assert.equal(describeTimer(updateKitchenTimer(timer, 'add_minute', 100000)!, 100000).remaining_seconds, 60);
  assert.deepEqual(describeTimer(updateKitchenTimer(timer, 'reset', 100000)!, 210000), {
    label: 'Kitchen Timer', remaining_seconds: 5, status: 'paused',
  });
});

test('invalid or ambiguous timer requests leave the timer unchanged', () => {
  for (const args of [{}, { seconds: -1 }, { minutes: '5' }, { minutes: Infinity }, { seconds: 86401 }, { seconds: 10, label: '' }]) {
    assert.throws(() => createKitchenTimer(args));
  }
  const timer = createKitchenTimer({ minutes: 2 });
  assert.throws(() => updateKitchenTimer(timer, 'rewind'), /unknown/i);
  assert.equal(timer.pausedRemaining, undefined);
});
