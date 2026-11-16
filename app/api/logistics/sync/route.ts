import { NextResponse, type NextRequest } from 'next/server';
import { hasBearer, unauthorized } from '@/lib/auth';
import { db, unwrap } from '@/lib/supabase/server';
import { ownerOfCalendar } from '@/lib/family';
import { localHour } from '@/lib/time';
import type { Assignee, LogisticsType, SourceCalendar } from '@/lib/types';

export const dynamic = 'force-dynamic';

interface RawEvent {
  external_event_id: string;
  source_calendar: SourceCalendar;
  title: string;
  description?: string | null;
  start_time: string;
  end_time: string;
  logistics_type?: LogisticsType;
  assigned_parent?: Assignee;
}

function classify(title: string, startIso: string, endIso: string): LogisticsType {
  const t = title.toLowerCase();
  if (
    /\b(pick\s*up|pickup|drop\s*off|dropoff|carpool|bus|aftercare|camp|school\s*run|wesley\s*from|wesley\s*to|lachlan\s*from|lachlan\s*to|goddard\s*early\s*closure)\b/.test(
      t,
    )
  ) {
    return 'pickup';
  }
  if (/\b(dentist|doctor|dr\.?\b|orthodont|pediatric|vet\b|checkup|appt|appointment|physical|therapy|eye\s*exam|haircut|mri|radiology|ultrasound|x-ray)\b/.test(t)) {
    return 'appointment';
  }
  const endsLate = localHour(new Date(endIso)) >= 18 || localHour(new Date(startIso)) >= 18;
  if (/\b(late\s*office|working\s*late|work\s*dinner|client\s*dinner|offsite|flight|travel)\b/.test(t) || (endsLate && /\b(office|dinner with|client)\b/.test(t))) {
    return 'late_office';
  }
  return 'general';
}

function defaultAssignee(type: LogisticsType, src: SourceCalendar, title: string): Assignee {
  const t = title.toLowerCase();
  if (/\bdaniela\b/.test(t) && !/\bwarren\b/.test(t)) return 'daniela';
  if (/\bwarren\b/.test(t) && !/\bdaniela\b/.test(t)) return 'warren';
  // Pickups and Family Calendar items are shared until someone claims them; personal calendars belong to the calendar owner.
  if (type === 'pickup' || src === 'family_google') return 'unassigned';
  return ownerOfCalendar(src) ?? 'unassigned';
}

/**
 * Webhook called by n8n with Outlook + Google Calendar events.
 * Preserves any parent assignment already set in Slack or on the kiosk.
 */
export async function POST(req: NextRequest) {
  if (!hasBearer(req, process.env.SYNC_API_KEY)) return unauthorized();
  const body = await req.json();
  const incoming: RawEvent[] = Array.isArray(body?.events) ? body.events : [body];

  const ids = incoming.map((e) => e.external_event_id).filter(Boolean);
  const existing = ids.length
    ? unwrap<
        {
          external_event_id: string;
          assigned_parent: Assignee;
          logistics_type: LogisticsType;
          description: string | null;
        }[]
      >(
        await db()
          .from('family_logistics')
          .select('external_event_id, assigned_parent, logistics_type, description')
          .in('external_event_id', ids),
        'existing events',
      )
    : [];
  const byExt = new Map(existing.map((e) => [e.external_event_id, e]));

  const rows = incoming
    .filter((e) => e.external_event_id && e.title && e.start_time && e.end_time)
    .map((e) => {
      const prev = byExt.get(e.external_event_id);
      const type = e.logistics_type ?? prev?.logistics_type ?? classify(e.title, e.start_time, e.end_time);
      const assigned =
        e.assigned_parent ??
        (prev && prev.assigned_parent !== 'unassigned' ? prev.assigned_parent : defaultAssignee(type, e.source_calendar, e.title));
      return {
        external_event_id: e.external_event_id,
        source_calendar: e.source_calendar,
        title: e.title,
        description: prev?.description ?? e.description ?? null,
        start_time: e.start_time,
        end_time: e.end_time,
        logistics_type: type,
        assigned_parent: assigned,
        updated_at: new Date().toISOString(),
      };
    });

  if (rows.length) {
    unwrap(await db().from('family_logistics').upsert(rows, { onConflict: 'external_event_id' }), 'upsert logistics');
  }
  if (Array.isArray(body?.deleted_external_ids) && body.deleted_external_ids.length) {
    await db().from('family_logistics').delete().in('external_event_id', body.deleted_external_ids);
  }
  return NextResponse.json({ ok: true, upserted: rows.length });
}
