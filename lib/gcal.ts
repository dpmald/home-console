// Zero-OAuth Google Calendar iCal (.ics) feed sync + Family Calendar event description write-back.
// Supports comma-separated Secret iCal URLs in GOOGLE_CALENDAR_ICS_URLS
// (e.g. Daniela's primary calendar + Google Family calendar + Warren's calendar).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from './supabase/server';
import { isBetaDeployment } from './beta-deployment';
import { ownerOfCalendar } from './family';
import { localHour, TZ, zonedTimeToUtc } from './time';
import type { Assignee, LogisticsType, SourceCalendar } from './types';

const execFileAsync = promisify(execFile);

export const FAMILY_CALENDAR_ID =
  process.env.GOOGLE_FAMILY_CALENDAR_ID || 'family04106130811563564934@group.calendar.google.com';

let lastSyncAt = 0;
const SYNC_TTL_MS = 5 * 60_000; // Refresh at most every 5 minutes per serverless instance

function classify(title: string, startIso: string, endIso: string): LogisticsType {
  const t = title.toLowerCase();
  if (
    /\b(pick\s*up|pickup|drop\s*off|dropoff|carpool|bus|aftercare|camp|school\s*run|wesley\s*from|wesley\s*to|lachlan\s*from|lachlan\s*to|goddard\s*early\s*closure)\b/.test(
      t,
    )
  ) {
    return 'pickup';
  }
  if (
    /\b(dentist|doctor|dr\.?\b|orthodont|pediatric|vet\b|checkup|appt|appointment|physical|therapy|eye\s*exam|haircut|mri|radiology|ultrasound|x-ray)\b/.test(
      t,
    )
  ) {
    return 'appointment';
  }
  const endsLate = localHour(new Date(endIso)) >= 18 || localHour(new Date(startIso)) >= 18;
  if (
    /\b(late\s*office|working\s*late|work\s*dinner|client\s*dinner|offsite|flight|travel)\b/.test(t) ||
    (endsLate && /\b(office|dinner with|client)\b/.test(t))
  ) {
    return 'late_office';
  }
  return 'general';
}

function defaultAssignee(
  type: LogisticsType,
  src: SourceCalendar,
  title: string,
  description?: string | null,
): Assignee {
  const desc = (description ?? '').toLowerCase();
  if (/\bclaimed by daniela\b/.test(desc)) return 'daniela';
  if (/\bclaimed by warren\b/.test(desc)) return 'warren';
  const t = title.toLowerCase();
  if (/\bdaniela\b/.test(t) && !/\bwarren\b/.test(t)) return 'daniela';
  if (/\bwarren\b/.test(t) && !/\bdaniela\b/.test(t)) return 'warren';
  if (type === 'pickup' || src === 'family_google') return 'unassigned';
  return ownerOfCalendar(src) ?? 'unassigned';
}

export async function updateGoogleCalendarEventDescription(
  externalEventId: string,
  description: string,
  calendarId: string = FAMILY_CALENDAR_ID,
): Promise<boolean> {
  if (isBetaDeployment() || process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1') return false;
  const rawId = externalEventId
    .replace(/^(gcal|ics):/, '')
    .replace(/@google\.com$/, '')
    .trim();
  if (!rawId) return false;

  // 1. If Google Calendar REST token is configured, PATCH event description via REST API
  const token = process.env.GOOGLE_CALENDAR_ACCESS_TOKEN;
  if (token) {
    try {
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        calendarId,
      )}/events/${encodeURIComponent(rawId)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ description }),
      });
      if (res.ok) return true;
    } catch {}
  }

  // 2. Fallback to gcalendar CLI when running locally / on connected host
  try {
    await execFileAsync('gcalendar', [
      'mutate',
      'update',
      rawId,
      '--cal',
      calendarId,
      '--description',
      description,
    ]);
    return true;
  } catch {
    return false;
  }
}

function zonedWallClockToIso(
  dateISO: string,
  h = 0,
  m = 0,
  s = 0,
  tz = TZ,
): string {
  if (tz === TZ && s === 0) {
    return zonedTimeToUtc(dateISO, h, m).toISOString();
  }
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const wallMs = (ms: number) => {
      const o: Record<string, string> = {};
      for (const p of fmt.formatToParts(new Date(ms))) o[p.type] = p.value;
      return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second);
    };
    const [y, mo, d] = dateISO.split('-').map(Number);
    const target = Date.UTC(y, mo - 1, d, h, m, s);
    let guess = target - (wallMs(target) - target);
    guess = target - (wallMs(guess) - guess);
    return new Date(guess).toISOString();
  } catch {
    return zonedTimeToUtc(dateISO, h, m).toISOString();
  }
}

function parseIcsDate(raw: string, propKey = ''): string | null {
  const v = raw.trim();
  // 1. Explicit UTC: YYYYMMDDTHHMMSSZ
  const mUtc = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (mUtc) {
    return `${mUtc[1]}-${mUtc[2]}-${mUtc[3]}T${mUtc[4]}:${mUtc[5]}:${mUtc[6]}Z`;
  }
  // Extract optional TZID parameter (e.g. DTSTART;TZID=America/New_York)
  const tzMatch = propKey.match(/TZID=([^;:]+)/i);
  const tz = tzMatch ? tzMatch[1].replace(/^"|"$/g, '').trim() : TZ;

  // 2. Local wall-clock datetime: YYYYMMDDTHHMMSS
  const mLocal = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (mLocal) {
    const dateISO = `${mLocal[1]}-${mLocal[2]}-${mLocal[3]}`;
    return zonedWallClockToIso(dateISO, +mLocal[4], +mLocal[5], +mLocal[6], tz);
  }
  // 3. All-day date: YYYYMMDD (interpret as midnight in family timezone so date doesn't shift back 1 day in EST)
  const mDay = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (mDay) {
    const dateISO = `${mDay[1]}-${mDay[2]}-${mDay[3]}`;
    return zonedWallClockToIso(dateISO, 0, 0, 0, tz);
  }
  return null;
}

function normalizeExternalEventId(rawUid: string): string {
  const clean = rawUid
    .replace(/^(gcal|ics):/i, '')
    .replace(/@google\.com$/i, '')
    .trim();
  return `gcal:${clean}`;
}

export async function syncIcsCalendarsIfConfigured(): Promise<void> {
  if (isBetaDeployment() || process.env.HOME_CONSOLE_GROCERY_DEVELOPMENT === '1') return;
  const rawUrls = process.env.GOOGLE_CALENDAR_ICS_URLS;
  if (!rawUrls) return;
  if (Date.now() - lastSyncAt < SYNC_TTL_MS) return;

  const urls = rawUrls
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (!urls.length) return;

  const minMs = Date.now() - 2 * 86_400_000;
  const maxMs = Date.now() + 14 * 86_400_000;
  let anySucceeded = false;

  for (const entry of urls) {
    try {
      // Optional prefix format: "warren_outlook|https://..." or "family_google|https://..." or plain URL
      const [prefix, maybeUrl] = entry.includes('|') ? entry.split('|', 2) : ['', entry];
      const url = maybeUrl.trim();
      const src: SourceCalendar =
        prefix === 'warren_outlook' || prefix === 'family_google' || prefix === 'daniela_google' || prefix === 'manual'
          ? prefix
          : /family\d+(%40|@)group\.calendar\.google\.com/i.test(url) || urls.length === 1
            ? 'family_google'
            : 'daniela_google';
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      anySucceeded = true;
      const text = (await res.text()).replace(/\r?\n[ \t]/g, '');
      const blocks = text.split('BEGIN:VEVENT').slice(1);
      const parsed: {
        external_event_id: string;
        legacy_ics_id: string;
        source_calendar: SourceCalendar;
        title: string;
        start_time: string;
        end_time: string;
        description: string;
      }[] = [];

      for (const blk of blocks) {
        const endIdx = blk.indexOf('END:VEVENT');
        const body = endIdx >= 0 ? blk.slice(0, endIdx) : blk;
        const lines = body.split(/\r?\n/);
        let uid = '';
        let summary = '';
        let description = '';
        let dtStart = '';
        let dtEnd = '';
        let status = '';
        for (const line of lines) {
          const colon = line.indexOf(':');
          if (colon < 0) continue;
          const rawKey = line.slice(0, colon);
          const k = rawKey.toUpperCase();
          const val = line.slice(colon + 1);
          if (k === 'UID') uid = val.trim();
          else if (k.startsWith('SUMMARY')) summary = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ').trim();
          else if (k.startsWith('DESCRIPTION')) description = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ').trim();
          else if (k.startsWith('DTSTART')) dtStart = parseIcsDate(val, rawKey) ?? '';
          else if (k.startsWith('DTEND')) dtEnd = parseIcsDate(val, rawKey) ?? '';
          else if (k === 'STATUS') status = val.trim().toUpperCase();
        }
        if (!uid || !summary || !dtStart || status === 'CANCELLED') continue;
        const startMs = Date.parse(dtStart);
        if (Number.isNaN(startMs) || startMs < minMs || startMs > maxMs) continue;
        const endIso = dtEnd || new Date(startMs + 3_600_000).toISOString();
        parsed.push({
          external_event_id: normalizeExternalEventId(uid),
          legacy_ics_id: `ics:${uid}`,
          source_calendar: src,
          title: summary,
          start_time: dtStart,
          end_time: endIso,
          description,
        });
      }

      if (!parsed.length) continue;
      const ids = Array.from(
        new Set(parsed.flatMap((p) => [p.external_event_id, p.legacy_ics_id])),
      );
      const { data: existing } = await db()
        .from('family_logistics')
        .select('external_event_id, source_calendar, title, start_time, end_time, assigned_parent, logistics_type, description')
        .in('external_event_id', ids);
      const byExt = new Map((existing ?? []).map((e: any) => [e.external_event_id, e]));

      const sameInstant = (a?: string, b?: string) =>
        Boolean(a && b && Date.parse(a) === Date.parse(b));

      const rows = parsed
        .map((e) => {
          const prev = byExt.get(e.external_event_id) ?? byExt.get(e.legacy_ics_id);
          const canonicalId = prev?.external_event_id ?? e.external_event_id;
          const type = prev?.logistics_type ?? classify(e.title, e.start_time, e.end_time);
          const assigned =
            prev && prev.assigned_parent !== 'unassigned'
              ? prev.assigned_parent
              : defaultAssignee(type, e.source_calendar, e.title, e.description);
          const desc = prev?.description || e.description || null;
          const unchanged =
            prev &&
            prev.external_event_id === canonicalId &&
            prev.title === e.title &&
            prev.source_calendar === e.source_calendar &&
            prev.logistics_type === type &&
            prev.assigned_parent === assigned &&
            (prev.description ?? null) === desc &&
            sameInstant(prev.start_time, e.start_time) &&
            sameInstant(prev.end_time, e.end_time);
          if (unchanged) return null;
          return {
            external_event_id: canonicalId,
            source_calendar: e.source_calendar,
            title: e.title,
            start_time: e.start_time,
            end_time: e.end_time,
            description: desc,
            logistics_type: type,
            assigned_parent: assigned,
            updated_at: new Date().toISOString(),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      if (rows.length > 0) {
        await db().from('family_logistics').upsert(rows, { onConflict: 'external_event_id' });
      }
    } catch {}
  }

  if (anySucceeded) {
    lastSyncAt = Date.now();
  }
}
