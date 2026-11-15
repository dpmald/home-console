// Zero-OAuth Google Calendar iCal (.ics) feed sync for Vercel.
// Supports comma-separated Secret iCal URLs in GOOGLE_CALENDAR_ICS_URLS
// (e.g. Daniela's primary calendar + Google Family calendar + Warren's calendar).
import { db } from './supabase/server';
import { ownerOfCalendar } from './family';
import { localHour } from './time';
import type { Assignee, LogisticsType, SourceCalendar } from './types';

let lastSyncAt = 0;
const SYNC_TTL_MS = 5 * 60_000; // Refresh at most every 5 minutes per serverless instance

function classify(title: string, startIso: string, endIso: string): LogisticsType {
  const t = title.toLowerCase();
  if (/\b(pick\s*up|drop\s*off|carpool|bus|aftercare|camp|school\s*run|wesley\s*from|wesley\s*to)\b/.test(t)) {
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

function defaultAssignee(type: LogisticsType, src: SourceCalendar, title: string): Assignee {
  const t = title.toLowerCase();
  if (/\bdaniela\b/.test(t) && !/\bwarren\b/.test(t)) return 'daniela';
  if (/\bwarren\b/.test(t) && !/\bdaniela\b/.test(t)) return 'warren';
  if (type === 'pickup') return 'unassigned';
  if (type === 'appointment' && /\bwesley\b/.test(t)) return 'unassigned';
  return ownerOfCalendar(src) ?? 'unassigned';
}

function parseIcsDate(raw: string): string | null {
  const v = raw.trim();
  // YYYYMMDDTHHMMSSZ or YYYYMMDD
  const mUtc = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (mUtc) {
    return `${mUtc[1]}-${mUtc[2]}-${mUtc[3]}T${mUtc[4]}:${mUtc[5]}:${mUtc[6]}Z`;
  }
  const mLocal = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (mLocal) {
    return new Date(`${mLocal[1]}-${mLocal[2]}-${mLocal[3]}T${mLocal[4]}:${mLocal[5]}:${mLocal[6]}`).toISOString();
  }
  const mDay = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (mDay) {
    return `${mDay[1]}-${mDay[2]}-${mDay[3]}T00:00:00Z`;
  }
  return null;
}

export async function syncIcsCalendarsIfConfigured(): Promise<void> {
  const rawUrls = process.env.GOOGLE_CALENDAR_ICS_URLS;
  if (!rawUrls) return;
  if (Date.now() - lastSyncAt < SYNC_TTL_MS) return;
  lastSyncAt = Date.now();

  const urls = rawUrls
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (!urls.length) return;

  const minMs = Date.now() - 2 * 86_400_000;
  const maxMs = Date.now() + 14 * 86_400_000;

  for (const entry of urls) {
    try {
      // Optional prefix format: "warren_outlook|https://..." or plain URL (defaults to daniela_google)
      const [prefix, maybeUrl] = entry.includes('|') ? entry.split('|', 2) : ['daniela_google', entry];
      const src: SourceCalendar =
        prefix === 'warren_outlook' || prefix === 'manual' ? prefix : 'daniela_google';
      const url = maybeUrl.trim();
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const text = (await res.text()).replace(/\r?\n[ \t]/g, '');
      const blocks = text.split('BEGIN:VEVENT').slice(1);
      const parsed: {
        external_event_id: string;
        source_calendar: SourceCalendar;
        title: string;
        start_time: string;
        end_time: string;
      }[] = [];

      for (const blk of blocks) {
        const endIdx = blk.indexOf('END:VEVENT');
        const body = endIdx >= 0 ? blk.slice(0, endIdx) : blk;
        const lines = body.split(/\r?\n/);
        let uid = '';
        let summary = '';
        let dtStart = '';
        let dtEnd = '';
        let status = '';
        for (const line of lines) {
          const colon = line.indexOf(':');
          if (colon < 0) continue;
          const k = line.slice(0, colon).toUpperCase();
          const val = line.slice(colon + 1);
          if (k === 'UID') uid = val.trim();
          else if (k.startsWith('SUMMARY')) summary = val.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/g, ' ').trim();
          else if (k.startsWith('DTSTART')) dtStart = parseIcsDate(val) ?? '';
          else if (k.startsWith('DTEND')) dtEnd = parseIcsDate(val) ?? '';
          else if (k === 'STATUS') status = val.trim().toUpperCase();
        }
        if (!uid || !summary || !dtStart || status === 'CANCELLED') continue;
        const startMs = Date.parse(dtStart);
        if (Number.isNaN(startMs) || startMs < minMs || startMs > maxMs) continue;
        const endIso = dtEnd || new Date(startMs + 3_600_000).toISOString();
        parsed.push({
          external_event_id: `ics:${uid}`,
          source_calendar: src,
          title: summary,
          start_time: dtStart,
          end_time: endIso,
        });
      }

      if (!parsed.length) continue;
      const ids = parsed.map((p) => p.external_event_id);
      const { data: existing } = await db()
        .from('family_logistics')
        .select('external_event_id, assigned_parent, logistics_type')
        .in('external_event_id', ids);
      const byExt = new Map((existing ?? []).map((e: any) => [e.external_event_id, e]));

      const rows = parsed.map((e) => {
        const prev = byExt.get(e.external_event_id);
        const type = prev?.logistics_type ?? classify(e.title, e.start_time, e.end_time);
        const assigned =
          prev && prev.assigned_parent !== 'unassigned'
            ? prev.assigned_parent
            : defaultAssignee(type, e.source_calendar, e.title);
        return {
          ...e,
          logistics_type: type,
          assigned_parent: assigned,
          updated_at: new Date().toISOString(),
        };
      });

      await db().from('family_logistics').upsert(rows, { onConflict: 'external_event_id' });
    } catch {}
  }
}
