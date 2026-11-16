// Core family-data operations. Shared by Slack, the kiosk, voice and crons
// so every surface behaves identically.
import { db, unwrap } from './supabase/server';
import { syncIcsCalendarsIfConfigured, updateGoogleCalendarEventDescription } from './gcal';
import { addDays, dayBoundsUTC, dowOf, fmtTime, localHour, todayISO } from './time';
import { NAMES, formatClaimedDescription, isClaimableLogistics, isParent, ownerOfCalendar } from './family';
import type {
  Assignee, BacklogItem, BacklogLocation, CartProposal, Chef, Chore, Conflict,
  DinnerRow, GroceryItem, KitchenState, LateNote, LogisticsEvent, Parent,
} from './types';

const now = () => new Date().toISOString();

// ───────────────────────────── Dinner ─────────────────────────────
const DINNER_COLS = 'date, chef, recipe_name, linked_backlog_id, status, unavailable, claimed_via';

export async function getDinner(date: string): Promise<DinnerRow> {
  const existing = unwrap<DinnerRow | null>(
    await db().from('dinner_schedule').select(DINNER_COLS).eq('date', date).maybeSingle(),
    'get dinner',
  );
  if (existing) return existing;
  unwrap(
    await db().from('dinner_schedule').upsert({ date }, { onConflict: 'date', ignoreDuplicates: true }),
    'ensure dinner',
  );
  return unwrap(await db().from('dinner_schedule').select(DINNER_COLS).eq('date', date).single(), 'get dinner');
}

async function patchDinner(date: string, patch: Partial<DinnerRow>): Promise<DinnerRow> {
  return unwrap(
    await db()
      .from('dinner_schedule')
      .upsert({ date, ...patch, updated_at: now() }, { onConflict: 'date' })
      .select(DINNER_COLS)
      .single(),
    'patch dinner',
  );
}

export async function claimDinner(
  date: string,
  chef: Exclude<Chef, 'unclaimed'>,
  via: string,
  recipeName?: string | null,
): Promise<DinnerRow> {
  const cur = await getDinner(date);
  const patch: Partial<DinnerRow> = { chef, status: 'planned', claimed_via: via };
  if (chef === 'takeout') {
    patch.recipe_name = recipeName?.trim() || 'Takeout / fend for yourselves';
    patch.linked_backlog_id = null;
  } else {
    if (recipeName) {
      patch.recipe_name = recipeName;
      patch.linked_backlog_id = null;
    } else if (cur.chef === 'takeout') {
      patch.recipe_name = null;
    }
    // Claiming means you're available after all.
    patch.unavailable = cur.unavailable.filter((p) => p !== chef);
  }
  return patchDinner(date, patch);
}

export async function unclaimDinner(date: string, via: string) {
  return patchDinner(date, {
    chef: 'unclaimed', status: 'unclaimed', recipe_name: null, linked_backlog_id: null, claimed_via: via,
  });
}

export async function setNotTonight(date: string, parent: Parent, unavailable: boolean, via: string) {
  const cur = await getDinner(date);
  const set = new Set(cur.unavailable);
  if (unavailable) set.add(parent);
  else set.delete(parent);
  const patch: Partial<DinnerRow> = { unavailable: [...set], claimed_via: via };
  if (unavailable && cur.chef === parent && cur.status === 'planned') {
    patch.chef = 'unclaimed';
    patch.status = cur.linked_backlog_id ? 'planned' : 'unclaimed';
  }
  return patchDinner(date, patch);
}

export async function cookFromBacklog(date: string, backlogId: string, chef: Parent | null, via: string) {
  const item = unwrap<BacklogItem>(
    await db().from('fridge_backlog').select('*').eq('id', backlogId).single(),
    'backlog item',
  );
  const cur = await getDinner(date);
  const resolvedChef: Chef = chef ?? (isParent(cur.chef) ? cur.chef : 'unclaimed');
  return patchDinner(date, {
    chef: resolvedChef,
    recipe_name: item.recipe_or_item_name,
    linked_backlog_id: item.id,
    status: 'planned',
    claimed_via: via,
  });
}

export async function markDinnerCooked(date: string, via: string) {
  const cur = await getDinner(date);
  const d = await patchDinner(date, { status: 'cooked', claimed_via: via });
  if (cur.linked_backlog_id) await updateBacklogRow(cur.linked_backlog_id, 'cooked');
  return d;
}

// ─────────────────────────── Fridge backlog ───────────────────────────
export async function listBacklog(): Promise<BacklogItem[]> {
  return unwrap(
    await db().from('fridge_backlog').select('*').eq('status', 'in_fridge').order('delivery_date'),
    'list backlog',
  );
}

async function updateBacklogRow(id: string, status: BacklogItem['status']) {
  unwrap(
    await db()
      .from('fridge_backlog')
      .update({ status, resolved_at: status === 'in_fridge' ? null : now() })
      .eq('id', id),
    'update backlog',
  );
}

/** Marking a backlog meal cooked anywhere also closes tonight's linked dinner. */
export async function setBacklogStatus(id: string, status: 'cooked' | 'discarded') {
  await updateBacklogRow(id, status);
  const today = todayISO();
  if (status === 'cooked') {
    await db()
      .from('dinner_schedule')
      .update({ status: 'cooked', updated_at: now() })
      .eq('linked_backlog_id', id)
      .eq('status', 'planned')
      .lte('date', today);
  } else {
    // Tossed: unlink it from any upcoming dinner so that night needs a new plan.
    await db()
      .from('dinner_schedule')
      .update({ linked_backlog_id: null, recipe_name: null, status: 'unclaimed', chef: 'unclaimed', updated_at: now() })
      .eq('linked_backlog_id', id)
      .eq('status', 'planned')
      .gte('date', today);
  }
}

export async function addBacklogItem(input: {
  name: string;
  perishables?: string[];
  location?: BacklogLocation;
  delivery_date?: string;
  added_by?: string;
  source_proposal_id?: string;
}) {
  return unwrap<BacklogItem>(
    await db()
      .from('fridge_backlog')
      .insert({
        recipe_or_item_name: input.name,
        key_perishables: input.perishables ?? [],
        location: input.location ?? 'fridge',
        delivery_date: input.delivery_date ?? todayISO(),
        added_by: input.added_by ?? null,
        source_proposal_id: input.source_proposal_id ?? null,
      })
      .select()
      .single(),
    'add backlog',
  );
}

// ───────────────────────────── Chores ─────────────────────────────
export async function ensureChoresForDate(date: string) {
  const templates = unwrap<
    {
      chore_title: string;
      emoji: string | null;
      days_of_week: number[];
      category?: 'allowance' | 'pay_per_chore';
      reward_cents?: number;
      sort_order: number;
    }[]
  >(await db().from('wesley_chore_templates').select('*').eq('active', true), 'chore templates');
  const dow = dowOf(date);
  const rows = templates
    .filter((t) => t.days_of_week.includes(dow))
    .map((t) => ({
      chore_title: t.chore_title,
      emoji: t.emoji,
      category: t.category ?? 'allowance',
      reward_cents: t.reward_cents ?? 0,
      sort_order: t.sort_order,
      chore_date: date,
    }));
  if (rows.length) {
    unwrap(
      await db().from('wesley_chores').upsert(rows, { onConflict: 'chore_date,chore_title', ignoreDuplicates: true }),
      'ensure chores',
    );
  }
}

export async function listChores(date: string): Promise<Chore[]> {
  const existing = unwrap<Chore[]>(
    await db().from('wesley_chores').select('*').eq('chore_date', date).order('sort_order'),
    'list chores',
  );
  if (existing.length > 0) return existing;
  await ensureChoresForDate(date);
  return unwrap(
    await db().from('wesley_chores').select('*').eq('chore_date', date).order('sort_order'),
    'list chores',
  );
}

export async function toggleChore(id: string, completed: boolean) {
  unwrap(
    await db()
      .from('wesley_chores')
      .update({ completed, completed_at: completed ? now() : null })
      .eq('id', id)
      .eq('verified_in_greenlight', false), // don't change history after payout reconciliation
    'toggle chore',
  );
}

export interface GreenlightSummary {
  start: string;
  end: string;
  days: { date: string; chores: Chore[] }[];
  done: number;
  total: number;
  verified: boolean;
}

export async function greenlightSummary(start: string, end: string): Promise<GreenlightSummary> {
  const chores = unwrap<Chore[]>(
    await db()
      .from('wesley_chores')
      .select('*')
      .gte('chore_date', start)
      .lte('chore_date', end)
      .order('chore_date')
      .order('sort_order'),
    'chores in range',
  );
  const days: GreenlightSummary['days'] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const list = chores.filter((c) => c.chore_date === d);
    if (list.length) days.push({ date: d, chores: list });
  }
  const done = chores.filter((c) => c.completed);
  return {
    start,
    end,
    days,
    done: done.length,
    total: chores.length,
    verified: done.length > 0 && done.every((c) => c.verified_in_greenlight),
  };
}

export async function markGreenlightVerified(start: string, end: string) {
  unwrap(
    await db()
      .from('wesley_chores')
      .update({ verified_in_greenlight: true })
      .gte('chore_date', start)
      .lte('chore_date', end)
      .eq('completed', true),
    'verify chores',
  );
}

// ──────────────────────────── Logistics ────────────────────────────
export async function eventsForDate(date: string): Promise<LogisticsEvent[]> {
  const [s] = dayBoundsUTC(date);
  const [, e] = dayBoundsUTC(addDays(date, 1));
  return unwrap(
    await db()
      .from('family_logistics')
      .select('*')
      .lt('start_time', e.toISOString())
      .gt('end_time', s.toISOString())
      .order('start_time'),
    'events',
  );
}

export async function assignLogistics(id: string, parent: Assignee) {
  const existing = unwrap<LogisticsEvent | null>(
    await db().from('family_logistics').select('*').eq('id', id).maybeSingle(),
    'get logistics event',
  );
  const newDescription = existing
    ? formatClaimedDescription(existing.description, existing.title, parent)
    : undefined;

  unwrap(
    await db()
      .from('family_logistics')
      .update({
        assigned_parent: parent,
        ...(newDescription !== undefined ? { description: newDescription } : {}),
        updated_at: now(),
      })
      .eq('id', id),
    'assign logistics',
  );

  if (existing && newDescription && existing.source_calendar === 'family_google') {
    await updateGoogleCalendarEventDescription(existing.external_event_id, newDescription);
  }
}

const overlaps = (a: LogisticsEvent, b: LogisticsEvent) =>
  Date.parse(a.start_time) < Date.parse(b.end_time) && Date.parse(a.end_time) > Date.parse(b.start_time);

export function computeConflicts(events: LogisticsEvent[]): Conflict[] {
  const out: Conflict[] = [];
  for (const ev of events) {
    if (!isClaimableLogistics(ev)) continue;
    if (ev.assigned_parent === 'unassigned') {
      out.push({ eventId: ev.id, kind: 'unassigned', message: `${fmtTime(ev.start_time)} ${ev.title} has no owner` });
      continue;
    }
    const who = ev.assigned_parent;
    const clash = events.find(
      (o) =>
        o.id !== ev.id &&
        ownerOfCalendar(o.source_calendar) === who &&
        o.title.trim().toLowerCase() !== ev.title.trim().toLowerCase() && // same invite on both calendars
        Date.parse(o.end_time) - Date.parse(o.start_time) < 20 * 3_600_000 && // ignore all-day
        overlaps(ev, o),
    );
    if (clash) {
      out.push({
        eventId: ev.id,
        kind: 'clash',
        message: `${NAMES[who]} has "${clash.title}" (${fmtTime(clash.start_time)}–${fmtTime(clash.end_time)}) during ${ev.title} at ${fmtTime(ev.start_time)}`,
      });
    }
  }
  return out;
}

// ──────────────────────────── Groceries ────────────────────────────
export async function listGroceries(): Promise<GroceryItem[]> {
  return unwrap(
    await db().from('grocery_items').select('*').in('status', ['needed', 'needs_attention']).order('created_at'),
    'list groceries',
  );
}

export async function addGrocery(name: string, quantity: string | null, addedBy: string) {
  const existing = (await listGroceries()).find((g) => g.name.toLowerCase() === name.trim().toLowerCase());
  if (existing) return existing;
  return unwrap<GroceryItem>(
    await db().from('grocery_items').insert({ name: name.trim(), quantity, added_by: addedBy }).select().single(),
    'add grocery',
  );
}

export async function setGroceryStatus(id: string, status: GroceryItem['status']) {
  unwrap(await db().from('grocery_items').update({ status }).eq('id', id), 'grocery status');
}

/** Household request snapshots and cart receipts; never an external order. */
export async function listGroceryAgentRequests(runId: string) {
  const { groceryAgentRpc } = await import('./grocery-agent-store');
  return groceryAgentRpc('grocery_agent_list_pending', { p_run_id: runId });
}

export async function recordGroceryAgentProgress(operation: Record<string, unknown>) {
  const { groceryAgentRpc } = await import('./grocery-agent-store');
  return groceryAgentRpc('grocery_agent_progress', { p_operation: operation });
}

// ──────────────────────────── Aggregate ────────────────────────────
export async function recentOrders(limit = 3): Promise<CartProposal[]> {
  return unwrap(
    await db().from('cart_proposals').select('*').order('created_at', { ascending: false }).limit(limit),
    'recent orders',
  );
}

export async function getKitchenState(date = todayISO()): Promise<KitchenState> {
  await syncIcsCalendarsIfConfigured();
  const [dinner, backlog, chores, events, groceries, orders] = await Promise.all([
    getDinner(date),
    listBacklog(),
    listChores(date),
    eventsForDate(date),
    listGroceries(),
    recentOrders(),
  ]);
  const conflicts = computeConflicts(events);

  const lateTonight: LateNote[] = events
    .filter((e) => e.logistics_type === 'late_office')
    .map((e) => ({
      parent: e.assigned_parent !== 'unassigned' ? e.assigned_parent : ownerOfCalendar(e.source_calendar),
      title: e.title,
      until: e.end_time,
    }));

  if (dinner.status === 'planned' && isParent(dinner.chef)) {
    const chef = dinner.chef;
    const late = lateTonight.find((l) => l.parent === chef && localHour(new Date(l.until)) >= 18);
    if (late) {
      conflicts.push({
        eventId: null,
        kind: 'dinner',
        message: `${NAMES[chef]} is on dinner but has "${late.title}" until ${fmtTime(late.until)}`,
      });
    }
  }

  return { date, dinner, backlog, chores, events, conflicts, groceries, lateTonight, orders };
}

// ──────────────────────────── Utilities ────────────────────────────
const STOP = new Set(['the', 'a', 'an', 'some', 'of', 'and', 'with', 'my', 'our', 'tonight', 'to']);
const norm = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t)).join(' ');

/** Loose name match for voice commands ("the pasta" → "Lemon pasta with peas"). */
export function fuzzyFind<T>(items: T[], name: (t: T) => string, query: string): T | undefined {
  const q = norm(query);
  if (!q) return undefined;
  const qTokens = new Set(q.split(' '));
  let best: T | undefined;
  let bestScore = 0;
  for (const it of items) {
    const s = norm(name(it));
    let score = 0;
    if (s === q) score = 100;
    else if (s.includes(q) || q.includes(s)) score = 50;
    else score = s.split(' ').filter((t) => qTokens.has(t)).length * 10;
    if (score > bestScore) {
      best = it;
      bestScore = score;
    }
  }
  return best;
}
