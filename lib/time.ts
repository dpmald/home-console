// Timezone-safe date helpers (no deps). Works on server and client.
export const TZ = process.env.NEXT_PUBLIC_FAMILY_TIMEZONE || 'America/New_York';

const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

function parts(d: Date): Record<string, string> {
  const o: Record<string, string> = {};
  for (const p of partsFmt.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** YYYY-MM-DD in the family timezone. */
export function todayISO(d = new Date()): string {
  const p = parts(d);
  return `${p.year}-${p.month}-${p.day}`;
}

export const localHour = (d = new Date()) => Number(parts(d).hour);
/** Minutes since local midnight (e.g. 14:30 → 870). */
export const localMinutes = (d = new Date()) => {
  const p = parts(d);
  return Number(p.hour) * 60 + Number(p.minute);
};
/** 'Mon' | 'Tue' | … */
export const localWeekday = (d = new Date()) => parts(d).weekday;

function wallClockMs(ms: number): number {
  const p = parts(new Date(ms));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

/** Convert a local wall-clock time in TZ to a UTC Date (DST-safe). */
export function zonedTimeToUtc(dateISO: string, h = 0, m = 0): Date {
  const [y, mo, d] = dateISO.split('-').map(Number);
  const target = Date.UTC(y, mo - 1, d, h, m);
  let guess = target - (wallClockMs(target) - target);
  guess = target - (wallClockMs(guess) - guess);
  return new Date(guess);
}

export function addDays(dateISO: string, n: number): string {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dayBoundsUTC(dateISO: string): [Date, Date] {
  return [zonedTimeToUtc(dateISO), zonedTimeToUtc(addDays(dateISO, 1))];
}

/** 0 = Sunday */
export const dowOf = (dateISO: string) => new Date(`${dateISO}T12:00:00Z`).getUTCDay();

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round(
    (Date.parse(`${toISO}T12:00:00Z`) - Date.parse(`${fromISO}T12:00:00Z`)) / 86_400_000,
  );
}

export function nextSaturday(fromISO: string): string {
  const delta = (6 - dowOf(fromISO) + 7) % 7 || 7;
  return addDays(fromISO, delta);
}

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const fmtTime = (iso: string | Date) => timeFmt.format(new Date(iso));

export function fmtEventTime(iso: string | Date, refDate = todayISO()): string {
  const d = new Date(iso);
  const evDate = todayISO(d);
  if (evDate === refDate) return fmtTime(d);
  if (evDate === addDays(refDate, 1)) return `Tomorrow ${fmtTime(d)}`;
  return `${fmtShortDate(evDate)} ${fmtTime(d)}`;
}

const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
export const fmtDay = (dateISO: string) => dayFmt.format(new Date(`${dateISO}T12:00:00Z`));

const shortFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', month: 'numeric', day: 'numeric' });
export const fmtShortDate = (dateISO: string) => shortFmt.format(new Date(`${dateISO}T12:00:00Z`));

export function isAllDay(startIso: string, endIso: string): boolean {
  return Date.parse(endIso) - Date.parse(startIso) >= 20 * 3_600_000;
}
