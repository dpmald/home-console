// Pure helpers for the 2 PM / 4 PM "pickups still unclaimed" Slack nudge.
// No DB or Slack calls here, so this is safe to import from blocks.ts.
import { KIDS, NAMES, PARENTS, isClaimableLogistics } from './family';
import { todayISO } from './time';
import type { LogisticsEvent, Parent } from './types';

export const PICKUP_NUDGE = {
  job: 'pickup-nudge',
  followUpJob: 'pickup-nudge-4pm',
  cursorJob: 'pickup-nudge-cursor',
  /** Local times, minutes since midnight. */
  start: () => Number(process.env.PICKUP_NUDGE_HOUR ?? 14) * 60,
  followUp: () => Number(process.env.PICKUP_FOLLOWUP_HOUR ?? 16) * 60,
  /** Stop posting/reading replies after this. */
  stop: () => Number(process.env.PICKUP_NUDGE_STOP_HOUR ?? 19) * 60,
};

/** Family-calendar pickups that start on `date` (eventsForDate also returns tomorrow). */
export function todaysPickups(events: LogisticsEvent[], date: string): LogisticsEvent[] {
  return events.filter((e) => isClaimableLogistics(e) && todayISO(new Date(e.start_time)) === date);
}

/** Unassigned pickups that haven't finished yet. */
export function outstandingPickups(pickups: LogisticsEvent[], now = new Date()): LogisticsEvent[] {
  return pickups.filter((e) => e.assigned_parent === 'unassigned' && Date.parse(e.end_time) > now.getTime());
}

export interface ReplyClaim {
  parent: Parent;
  eventIds: string[];
}

const CLAIM_RE =
  /\b(i'?ve got|i got|i have|i'?ll (get|grab|do|take|pick)|i can|i will|got (it|them|him|her|both|this)|on it|mine|i'?m on|will do|has (it|them|him|both)|is (getting|grabbing|doing|taking)|'s got|can (get|grab|do|take))\b/i;
const NEGATIVE_RE = /\b(can'?t|cannot|can not|won'?t|unable|not able|nope)\b/i;
const FIRST_PERSON_RE = /\b(i|i'?ll|i'?ve|i'?m|me|mine)\b/i;

/**
 * Turn a free-text thread reply into a claim.
 *  - "I've got it" / "I'll grab both"          → author takes all outstanding pickups
 *  - "I'll get Wesley"                         → author takes pickups whose title mentions Wesley
 *  - "Warren's got it" (from Daniela)          → assigns to the other parent
 *  - "I can't" / chatter                       → null (ignored)
 */
export function parseClaimReply(
  text: string,
  author: Parent,
  outstanding: LogisticsEvent[],
  slackIds: Partial<Record<Parent, string>> = {},
): ReplyClaim | null {
  const t = text.replace(/[’‘]/g, "'").trim();
  if (!t || !outstanding.length) return null;
  if (!(CLAIM_RE.test(t) || /^(me|mine)\b[\s!.]*$/i.test(t)) || NEGATIVE_RE.test(t)) return null;

  // Who is taking it?
  let parent: Parent = author;
  const other = PARENTS.find((p) => p !== author)!;
  const otherId = slackIds[other];
  const mentionsOther =
    new RegExp(`\\b${NAMES[other]}\\b`, 'i').test(t) || (otherId ? t.includes(`<@${otherId}>`) : false);
  if (mentionsOther && !FIRST_PERSON_RE.test(t)) parent = other;

  // Which pickups?
  const kids = KIDS.filter((k) => new RegExp(`\\b${k}\\b`, 'i').test(t));
  const mentionsKid = (e: LogisticsEvent, names: readonly string[]) =>
    names.some((k) => new RegExp(`\\b${k}\\b`, 'i').test(`${e.title} ${e.description ?? ''}`));
  let targets = kids.length ? outstanding.filter((e) => mentionsKid(e, kids)) : outstanding;
  // Titles like "School pickup" don't name a kid — then "I'll get Wesley" just means "I've got it".
  if (kids.length && !targets.length && !outstanding.some((e) => mentionsKid(e, KIDS))) targets = outstanding;
  if (!targets.length) return null;
  return { parent, eventIds: targets.map((e) => e.id) };
}
