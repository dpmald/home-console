import assert from 'node:assert/strict';
import test from 'node:test';
import { computeConflicts } from '../lib/domain';
import { formatClaimedDescription } from '../lib/family';
import { outstandingPickups, parseClaimReply, todaysPickups } from '../lib/pickups';
import { dayBoundsUTC, nextSaturday, todayISO } from '../lib/time';
import type { LogisticsEvent } from '../lib/types';

const pickup: LogisticsEvent = { id: 'pickup', external_event_id: 'test:pickup', title: 'Wesley pickup',
  start_time: '2026-03-09T20:00:00Z', end_time: '2026-03-09T20:30:00Z', logistics_type: 'pickup',
  source_calendar: 'family_google', assigned_parent: 'unassigned' };

test('New York day boundaries span 23 and 25 hours on DST transition days', () => {
  for (const [date, start, next] of [
    ['2026-03-08', '2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ['2026-11-01', '2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
  ]) {
    const [from, to] = dayBoundsUTC(date);
    assert.deepEqual([from.toISOString(), to.toISOString()], [start, next]);
    assert.equal(todayISO(new Date(to.getTime() - 1)), date);
  }
});

test('Saturday delivery advances to the following week on Saturday and across year end', () => {
  assert.equal(nextSaturday('2026-12-25'), '2026-12-26');
  assert.equal(nextSaturday('2026-12-26'), '2027-01-02');
});

test('pickup nudges target only today’s unclaimed, unfinished family pickups', () => {
  const events: LogisticsEvent[] = [pickup, { ...pickup, id: 'assigned', assigned_parent: 'daniela' },
    { ...pickup, id: 'over', end_time: '2026-03-09T20:05:00Z' },
    { ...pickup, id: 'personal', source_calendar: 'daniela_google' },
    { ...pickup, id: 'tomorrow', start_time: '2026-03-10T20:00:00Z' }];
  const targets = outstandingPickups(todaysPickups(events, '2026-03-09'), new Date('2026-03-09T20:05:00Z'));
  assert.deepEqual(targets.map(row => row.id), ['pickup']);
});

test('pickup replies preserve refusals, the named child and an explicitly named parent', () => {
  const all = [pickup, { ...pickup, id: 'second', title: 'Lachlan pickup' }];
  assert.equal(parseClaimReply('I can’t get Wesley', 'daniela', all), null);
  assert.deepEqual(parseClaimReply('I’ll get Wesley', 'daniela', all), { parent: 'daniela', eventIds: ['pickup'] });
  assert.deepEqual(parseClaimReply('Warren has both', 'daniela', all), { parent: 'warren', eventIds: ['pickup', 'second'] });
});

test('calendar claim updates preserve the household note through reassignment and release', () => {
  const first = formatClaimedDescription('Use the side gate.', 'School', 'warren');
  const second = formatClaimedDescription(first, 'School', 'daniela');
  assert.equal(second, 'Use the side gate. Claimed by Daniela.');
  assert.equal(formatClaimedDescription(second, 'School', 'unassigned'), 'Use the side gate. Unclaimed.');
});

test('conflicts distinguish a real overlap from the same invite, an all-day event and touching endpoints', () => {
  const claimed = { ...pickup, assigned_parent: 'warren' as const };
  const work = { ...pickup, id: 'work', source_calendar: 'warren_outlook' as const, title: 'Work meeting' };
  assert.equal(computeConflicts([pickup])[0].kind, 'unassigned');
  assert.equal(computeConflicts([claimed, work])[0].kind, 'clash');
  for (const other of [{ ...work, title: pickup.title }, { ...work, start_time: pickup.end_time },
    { ...work, end_time: '2026-03-10T20:00:00Z' }, { ...work, source_calendar: 'daniela_google' as const }]) {
    assert.deepEqual(computeConflicts([claimed, other]), []);
  }
});
