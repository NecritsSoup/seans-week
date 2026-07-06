// Day bounds mirror the legacy app: 6:00–23:30.
export const DAY_START_MIN = 6 * 60;
export const DAY_END_MIN = 23 * 60 + 30;
export const TOTAL_MIN = DAY_END_MIN - DAY_START_MIN;
export const SNAP_MIN = 15;

export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

/** Monday-start week. */
export function startOfWeek(d: Date): Date {
  const out = startOfDay(d);
  const day = out.getDay();
  out.setDate(out.getDate() + (day === 0 ? -6 : 1 - day));
  return out;
}

export function startOfMonth(d: Date): Date {
  const out = startOfDay(d);
  out.setDate(1);
  return out;
}

export function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(1);
  out.setMonth(out.getMonth() + n);
  return out;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Minutes since local midnight. */
export function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

/** A Date on `day` at `minutes` past midnight. */
export function dateAtMinutes(day: Date, minutes: number): Date {
  const out = startOfDay(day);
  out.setMinutes(minutes);
  return out;
}

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MIN) * SNAP_MIN;
}

export function clampToDayBounds(minutes: number): number {
  return Math.min(Math.max(minutes, DAY_START_MIN), DAY_END_MIN);
}

/** "6 AM", "12 PM", "11 PM" — for the time axis. */
export function fmtHourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const suffix = h < 12 ? 'AM' : 'PM';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display} ${suffix}`;
}

/** "7:00", "14:30" — compact 24h clock time. */
export function fmtClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

/** "7:00 – 8:30" */
export function fmtRange(startMin: number, endMin: number): string {
  return `${fmtClock(startMin)} – ${fmtClock(endMin)}`;
}
