// Server-side execution of voice tool calls.
import {
  addBacklogItem, addGrocery, assignLogistics, claimDinner, cookFromBacklog, fuzzyFind,
  getKitchenState, listBacklog, listChores, eventsForDate, markDinnerCooked, setBacklogStatus,
  setNotTonight, toggleChore,
} from '../domain';
import { isParent, NAMES } from '../family';
import { fmtTime, fmtDay, todayISO } from '../time';
import { getWeather } from '../weather';
import { controlSpotify } from '../spotify';
import { postMessage, CHANNELS } from '../slack/api';
import { refreshDinnerMessages } from '../slack/sync';
import { dinnerLine } from '../slack/blocks';

const plain = (s: string) => s.replace(/[*_]/g, '');

export async function executeVoiceTool(name: string, args: Record<string, any>): Promise<{ result: unknown; touchedDinner: boolean }> {
  const date = todayISO();
  const ok = (result: unknown, touchedDinner = false) => ({ result, touchedDinner });

  switch (name) {
    case 'get_today_overview': {
      const s = await getKitchenState(date);
      return ok({
        date: fmtDay(date),
        dinner: plain(dinnerLine(s.dinner)),
        not_tonight: s.dinner.unavailable.map((p) => NAMES[p]),
        fridge_backlog: s.backlog.map((b) => `${b.recipe_or_item_name} (since ${b.delivery_date})`),
        wesley_chores: s.chores.map((c) => `${c.chore_title}: ${c.completed ? 'done' : 'not done'}`),
        logistics: s.events
          .filter((e) => e.logistics_type !== 'general')
          .map((e) => `${fmtTime(e.start_time)} ${e.title} — ${e.assigned_parent === 'unassigned' ? 'NO OWNER' : NAMES[e.assigned_parent]}`),
        conflicts: s.conflicts.map((c) => c.message),
        grocery_list: s.groceries.map((g) => g.name),
      });
    }

    case 'set_dinner': {
      const chef = args.chef;
      if (chef !== 'takeout' && !isParent(chef)) return ok({ error: 'chef must be daniela, warren or takeout' });
      if (chef !== 'takeout' && args.recipe_name) {
        const match = fuzzyFind(await listBacklog(), (b) => b.recipe_or_item_name, String(args.recipe_name));
        if (match) {
          const d = await cookFromBacklog(date, match.id, chef, 'voice');
          return ok({ ok: true, dinner: plain(dinnerLine(d)), linked_backlog: match.recipe_or_item_name }, true);
        }
      }
      const d = await claimDinner(date, chef, 'voice', chef === 'takeout' ? undefined : args.recipe_name ?? null);
      return ok({ ok: true, dinner: plain(dinnerLine(d)) }, true);
    }

    case 'not_tonight': {
      if (!isParent(args.parent)) return ok({ error: 'unknown parent' });
      const d = await setNotTonight(date, args.parent, args.unavailable !== false, 'voice');
      return ok({ ok: true, not_tonight: d.unavailable.map((p) => NAMES[p]) }, true);
    }

    case 'mark_dinner_cooked': {
      const d = await markDinnerCooked(date, 'voice');
      return ok({ ok: true, dinner: plain(dinnerLine(d)) }, true);
    }

    case 'update_fridge_item': {
      const backlog = await listBacklog();
      const match = fuzzyFind(backlog, (b) => b.recipe_or_item_name, String(args.name ?? ''));
      if (!match) return ok({ error: 'not found', backlog: backlog.map((b) => b.recipe_or_item_name) });
      await setBacklogStatus(match.id, args.status === 'discarded' ? 'discarded' : 'cooked');
      return ok({ ok: true, item: match.recipe_or_item_name, status: args.status }, true);
    }

    case 'add_fridge_item': {
      const item = await addBacklogItem({
        name: String(args.name),
        perishables: Array.isArray(args.perishables) ? args.perishables.map(String) : [],
        location: ['fridge', 'pantry', 'freezer'].includes(args.location) ? args.location : 'fridge',
        added_by: 'voice',
      });
      return ok({ ok: true, added: item.recipe_or_item_name }, true);
    }

    case 'add_grocery_item': {
      const g = await addGrocery(String(args.name), args.quantity ? String(args.quantity) : null, 'voice');
      return ok({ ok: true, added: g.name, note: "Added to Saturday's list. Checkout remains manual." });
    }

    case 'set_chore_done': {
      const chores = await listChores(date);
      const match = fuzzyFind(chores, (c) => c.chore_title, String(args.chore ?? ''));
      if (!match) return ok({ error: 'not found', chores: chores.map((c) => c.chore_title) });
      await toggleChore(match.id, args.done !== false);
      return ok({ ok: true, chore: match.chore_title, done: args.done !== false });
    }

    case 'assign_logistics': {
      if (!isParent(args.parent)) return ok({ error: 'unknown parent' });
      const events = await eventsForDate(date);
      const match = fuzzyFind(events, (e) => e.title, String(args.event ?? ''));
      if (!match) return ok({ error: 'not found', events: events.map((e) => e.title) });
      await assignLogistics(match.id, args.parent);
      return ok({ ok: true, event: match.title, assigned: NAMES[args.parent as 'daniela' | 'warren'] }, true);
    }

    case 'get_weather':
      return ok(await getWeather());

    case 'control_spotify': {
      const op = ['play', 'pause', 'next', 'previous'].includes(args.op) ? args.op : 'play';
      const res = await controlSpotify({ op, query: args.query ? String(args.query) : undefined });
      return ok(res);
    }

    case 'post_to_slack': {
      const channel = args.channel === 'food' ? CHANNELS.food() : CHANNELS.logistics();
      await postMessage(channel, `🎙️ From the kitchen: ${String(args.message ?? '')}`);
      return ok({ ok: true });
    }

    default:
      return ok({ error: `Unknown tool ${name}` });
  }
}

export async function afterVoiceTool(touchedDinner: boolean) {
  if (touchedDinner) await refreshDinnerMessages(todayISO());
}
