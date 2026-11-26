import {
  addBacklogItem, assignLogistics, claimDinner, cookFromBacklog, computeConflicts, eventsInRange,
  getKitchenState, listBacklog, listChores, markDinnerCooked, setBacklogStatus,
  setNotTonight, toggleChore, unclaimDinner,
} from '../domain';
import { isClaimableLogistics, isParent, NAMES } from '../family';
import { syncIcsCalendarsIfConfigured } from '../gcal';
import { fmtTime, todayISO, TZ } from '../time';
import { getWeather } from '../weather';
import { controlSpotify } from '../spotify';
import { postMessage, CHANNELS } from '../slack/api';
import { refreshDinnerMessages } from '../slack/sync';
import { dinnerLine } from '../slack/blocks';
import { kitchenOverview, matchVoiceTarget, scheduleWindow, voiceEvent } from './context';
import { voicePage } from './request';
import type { BacklogItem } from '../types';

const plain = (s: string) => s.replace(/[*_]/g, '');
const text = (value: unknown, max = 250): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const inventoryMatch = (items: BacklogItem[], name: string) => matchVoiceTarget(items, name,
  (b) => b.recipe_or_item_name, (b) => `${b.recipe_or_item_name} (${b.location}, ${b.delivery_date})`);

export async function executeVoiceTool(name: string, args: Record<string, unknown>) {
  const date = todayISO();
  const result = (body: unknown, touchedDinner = false) => ({ result: body, touchedDinner });
  const invalid = () => result({ ok: false, error: 'Invalid arguments.' });
  const clarify = (choices: { ref: string; label: string }[]) => result({
    ok: false, needs_clarification: true, choices,
    message: choices.length ? 'Which one did you mean?' : 'No matching record. Check its name before trying again.',
  });

  switch (name) {
    case 'get_today_overview':
      return result(kitchenOverview(await getKitchenState(date)));

    case 'get_schedule': {
      const range = scheduleWindow(args.start_date, args.days, date);
      if (!range || (args.include_notes !== undefined && typeof args.include_notes !== 'boolean')) return invalid();
      await syncIcsCalendarsIfConfigured();
      const events = await eventsInRange(range.first, range.last);
      const { page, total, next_offset } = voicePage(events, args.offset);
      return result({ ok: true, ...range, timezone: TZ,
        total, next_offset, events: page.map((event) => ({ ...voiceEvent(event), notes: args.include_notes ? event.description?.slice(0, 1500) : undefined })),
        conflicts: computeConflicts(events).map((c) => c.message) });
    }

    case 'set_dinner': {
      const chef = args.chef;
      if (chef !== 'takeout' && !isParent(chef)) return invalid();
      const recipe = args.recipe_name;
      if (recipe !== undefined && !text(recipe)) return invalid();
      if (chef !== 'takeout' && recipe) {
        const { match, choices } = inventoryMatch(await listBacklog(), recipe);
        if (!match && choices.length) return clarify(choices);
        if (match) {
          const d = await cookFromBacklog(date, match.id, chef, 'voice');
          return result({ ok: true, dinner: plain(dinnerLine(d)), linked_backlog: match.recipe_or_item_name }, true);
        }
      }
      const d = await claimDinner(date, chef, 'voice', chef === 'takeout' ? undefined : recipe);
      return result({ ok: true, dinner: plain(dinnerLine(d)) }, true);
    }
    case 'unclaim_dinner': {
      const d = await unclaimDinner(date, 'voice');
      return result({ ok: true, dinner: plain(dinnerLine(d)) }, true);
    }
    case 'plan_fridge_meal': {
      if (!text(args.item) || (args.chef !== undefined && !isParent(args.chef))) return invalid();
      const { match, choices } = inventoryMatch(await listBacklog(), args.item);
      if (!match) return clarify(choices);
      const d = await cookFromBacklog(date, match.id, args.chef ?? null, 'voice');
      return result({ ok: true, dinner: plain(dinnerLine(d)) }, true);
    }
    case 'not_tonight': {
      if (!isParent(args.parent) || (args.unavailable !== undefined && typeof args.unavailable !== 'boolean')) return invalid();
      const d = await setNotTonight(date, args.parent, args.unavailable !== false, 'voice');
      return result({ ok: true, not_tonight: d.unavailable.map((p) => NAMES[p]) }, true);
    }
    case 'mark_dinner_cooked': {
      const d = await markDinnerCooked(date, 'voice');
      return result({ ok: true, dinner: plain(dinnerLine(d)) }, true);
    }
    case 'update_fridge_item': {
      if (!text(args.name) || (args.status !== 'cooked' && args.status !== 'discarded')) return invalid();
      const { match, choices } = inventoryMatch(await listBacklog(), args.name);
      if (!match) return clarify(choices);
      await setBacklogStatus(match.id, args.status);
      return result({ ok: true, item: match.recipe_or_item_name, status: args.status }, true);
    }
    case 'add_fridge_item': {
      const location = args.location ?? 'fridge';
      const perishables = args.perishables ?? [];
      if (!text(args.name) || (location !== 'fridge' && location !== 'pantry' && location !== 'freezer') ||
        !Array.isArray(perishables) || perishables.length > 30 || !perishables.every((p) => text(p))) return invalid();
      const item = await addBacklogItem({ name: args.name.trim(), perishables, location, added_by: 'voice' });
      return result({ ok: true, added: item.recipe_or_item_name }, true);
    }
    case 'set_chore_done': {
      if (!text(args.chore) || (args.done !== undefined && typeof args.done !== 'boolean')) return invalid();
      const { match, choices } = matchVoiceTarget(await listChores(date), args.chore, (c) => c.chore_title);
      if (!match) return clarify(choices);
      const saved = await toggleChore(match.id, args.done !== false);
      if (!saved || saved.completed !== (args.done !== false)) return result({ ok: false, error: 'The chore change was not confirmed.' });
      return result({ ok: true, chore: match.chore_title, done: saved.completed });
    }
    case 'assign_logistics': {
      const range = scheduleWindow(args.date, 1, date);
      if (!range || !text(args.event) || (!isParent(args.parent) && args.parent !== 'unassigned')) return invalid();
      await syncIcsCalendarsIfConfigured();
      const events = (await eventsInRange(range.first, range.last)).filter(isClaimableLogistics);
      const { match, choices } = matchVoiceTarget(events, args.event, (e) => e.title, (e) => `${e.title} at ${fmtTime(e.start_time)}`);
      if (!match) return clarify(choices);
      await assignLogistics(match.id, args.parent);
      return result({ ok: true, event: match.title, date: range.first, assigned: args.parent }, true);
    }
    case 'get_weather':
      return result({ ok: true, units: 'Fahrenheit', ...await getWeather() });
    case 'control_spotify': {
      const op = args.op;
      if (op !== 'play' && op !== 'pause' && op !== 'next' && op !== 'previous') return invalid();
      if (args.query !== undefined && !text(args.query)) return invalid();
      return result(await controlSpotify({ op, query: args.query }));
    }
    case 'post_to_slack': {
      if ((args.channel !== 'food' && args.channel !== 'logistics') || !text(args.message, 1000)) return invalid();
      const channel = CHANNELS[args.channel]();
      const sent = await postMessage(channel, `🎙️ From the kitchen: ${args.message.trim()}`);
      return result({ ok: Boolean(sent.ts && sent.channel) });
    }
    default:
      return invalid();
  }
}

export async function afterVoiceTool(touchedDinner: boolean) {
  if (touchedDinner) await refreshDinnerMessages(todayISO());
}
