import type { NextRequest } from 'next/server';
import { hasBearer } from './auth';
import { localHour, localWeekday } from './time';

/**
 * Vercel crons are UTC, so each job is scheduled at two UTC hours (EST/EDT)
 * and this guard only lets the one matching the local hour through.
 * `?force=1` skips the hour/weekday check (for manual testing).
 */
export function cronGate(
  req: NextRequest,
  opts: { hour: number; weekday?: string },
): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  if (!hasBearer(req, process.env.CRON_SECRET)) return { ok: false, status: 401, body: { error: 'unauthorized' } };
  if (req.nextUrl.searchParams.get('force') === '1') return { ok: true };
  const h = localHour();
  if (h !== opts.hour) return { ok: false, status: 200, body: { skipped: 'not the scheduled local hour', localHour: h } };
  if (opts.weekday && localWeekday() !== opts.weekday) {
    return { ok: false, status: 200, body: { skipped: 'not the scheduled weekday', weekday: localWeekday() } };
  }
  return { ok: true };
}
