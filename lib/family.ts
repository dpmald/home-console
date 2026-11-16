import type { Assignee, LogisticsType, Parent, SourceCalendar } from './types';

export const NAMES: Record<Parent, string> = { daniela: 'Daniela', warren: 'Warren' };
export const KID = 'Wesley';
export const KIDS = ['Wesley', 'Lachlan'] as const;
export const PARENTS: Parent[] = ['daniela', 'warren'];

export const isParent = (x: unknown): x is Parent => x === 'daniela' || x === 'warren';

export function ownerOfCalendar(src: SourceCalendar): Parent | null {
  if (src === 'warren_outlook') return 'warren';
  if (src === 'daniela_google') return 'daniela';
  return null;
}

export const SOURCE_LABEL: Record<SourceCalendar, string> = {
  warren_outlook: "Warren's Outlook",
  daniela_google: "Daniela's Google",
  family_google: 'Family Calendar',
  manual: 'Added manually',
};

/**
 * Claims are reserved for items on the Family Calendar (such as Wesley & Lachlan's
 * M–F school dropoffs and pickups), not personal events on Daniela's or Warren's calendars.
 */
export function isClaimableLogistics(ev: {
  source_calendar: SourceCalendar;
  logistics_type: LogisticsType;
}): boolean {
  return ev.source_calendar === 'family_google' && ev.logistics_type === 'pickup';
}

export function isSchoolLogisticsEvent(ev: {
  title: string;
  description?: string | null;
  logistics_type: LogisticsType;
  source_calendar: SourceCalendar;
}): boolean {
  if (ev.logistics_type === 'pickup') return true;
  const hay = `${ev.title} ${ev.description ?? ''}`.toLowerCase();
  return /\b(school|dropoff|drop-off|drop off|pickup|pick-up|pick up|goddard|nycps|wesley|lachlan|recess|dismissal)\b/.test(
    hay,
  );
}

export function formatClaimedDescription(
  existingDesc: string | null | undefined,
  title: string,
  parent: Assignee,
): string {
  const cleaned = (existingDesc ?? '')
    .replace(/\s*(?:Claimed by (?:Daniela|Warren)\.?|Unclaimed\.?)\s*$/i, '')
    .trim();
  const base = cleaned || `School logistics — ${title}.`;
  const normalizedBase = /[.!?]$/.test(base) ? base : `${base}.`;
  const claimLine =
    parent === 'unassigned' ? 'Unclaimed.' : `Claimed by ${NAMES[parent]}.`;
  return `${normalizedBase} ${claimLine}`;
}
