import { isClaimableLogistics, SOURCE_LABEL } from '../family';
import { addDays, fmtTime, isAllDay, todayISO, TZ } from '../time';
import type { KitchenState, LogisticsEvent } from '../types';

const words = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/);

/** Prefer a known row reference or exact title; never guess among partial matches. */
export function matchVoiceTarget<T extends { id: string }>(
  rows: T[], query: string, title: (row: T) => string, detail: (row: T) => string = title,
) {
  const name = words(query).join(' ');
  const exact = rows.filter((row) => row.id === query || words(title(row)).join(' ') === name);
  const tokens = words(query).filter((word) => word && !['a', 'an', 'the', 'my', 'our'].includes(word));
  const matches = exact.length ? exact : rows.filter((row) => {
    const terms = words(title(row));
    return tokens.length > 0 && tokens.every((word) => terms.includes(word));
  });
  return {
    match: matches.length === 1 ? matches[0] : undefined,
    choices: matches.slice(0, 8).map((row) => ({ ref: row.id, label: detail(row).slice(0, 300) })),
  };
}

export function scheduleWindow(start: unknown, days: unknown, today = todayISO()) {
  const first = start === undefined ? today : start;
  const count = days === undefined ? 1 : days;
  if (typeof first !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(first)
      || !Number.isFinite(Date.parse(first + 'T12:00:00Z')) || addDays(first, 0) !== first
      || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 7) return null;
  return { first, last: addDays(first, count - 1) };
}

export function voiceEvent(event: LogisticsEvent) {
  return {
    ref: event.id, title: event.title, calendar: SOURCE_LABEL[event.source_calendar],
    date: todayISO(new Date(event.start_time)), start: fmtTime(event.start_time),
    end_date: todayISO(new Date(event.end_time)), end: fmtTime(event.end_time),
    all_day: isAllDay(event.start_time, event.end_time), assigned: event.assigned_parent,
    can_assign: isClaimableLogistics(event),
  };
}

export function kitchenOverview(state: KitchenState) {
  const pending = state.orders.find((proposal) => proposal.status === 'pending');
  return {
    ok: true, date: state.date, timezone: TZ,
    dinner: { chef: state.dinner.chef, dish: state.dinner.recipe_name, status: state.dinner.status, unavailable: state.dinner.unavailable },
    inventory: state.backlog.map((b) => ({ ref: b.id, name: b.recipe_or_item_name, location: b.location, since: b.delivery_date, perishables: b.key_perishables })),
    kitchen_only_pantry_requests: state.groceries.map(({ name, quantity, status }) => ({ name, quantity, status })),
    chores: state.chores.map((c) => ({ ref: c.id, name: c.chore_title, done: c.completed, reward_cents: c.reward_cents })),
    calendar: state.events.map(voiceEvent), conflicts: state.conflicts.map((c) => c.message),
    recent_cart_proposals: state.orders.map((p) => ({
      proposed_delivery_date: p.delivery_date, approval_status: p.status,
      recipes: p.kept_recipes.map((r) => ({ name: r.name, ingredients: r.ingredients?.map(({ name, quantity }) => ({ name, quantity })), perishables: r.perishables })),
      ...(p === pending ? { items_up_for_approval: p.items.map(({ name, quantity, source }) => ({ name, quantity, source })) } : {}),
    })),
  };
}
