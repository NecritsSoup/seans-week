import type { GoogleParentPatch } from '../hermes/ledgerStore';
import { addDays, dateAtMinutes, minutesOfDay, startOfDay } from '../lib/time';
import type { RecurringOpResult } from '../state/recurringOps';
import type { CalendarEvent, CategoryId } from '../state/types';
import { getGoogleCalendarStore, localTimeZone } from './googleStore';

// Scope-aware mutations on Google recurring series, mirroring the local
// recurringOps semantics with Google Calendar's own model: "just this day"
// PATCHes or DELETEs the individually-addressable instance; "every week"
// PATCHes the parent (start/end shift, RRULE intact); ending a series sets
// RRULE UNTIL to the last past occurrence — past weeks remain, exactly like
// endTemplate — or DELETEs the parent when the series has no past yet.
// Every operation returns the same { undo, revert } shape recurringOps does,
// so the Ledger and the undo toasts treat both worlds alike.

/** SU..SA by Date.getDay() — RFC 5545 weekday codes. */
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** 'RRULE:FREQ=WEEKLY;BYDAY=MO' — one event, one weekday, every week. */
export function weeklyRRule(weekday: number, until?: Date): string {
  const base = `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[((weekday % 7) + 7) % 7]}`;
  return until ? `${base};UNTIL=${untilStamp(until)}` : base;
}

/** An expanded instance of a Google recurring event (or its fresh stand-in). */
export function isGoogleSeriesInstance(event: CalendarEvent): boolean {
  return Boolean(event.googleSeriesId);
}

/** RFC 5545 UNTIL: the moment in UTC, basic format — '20260707T230000Z'. */
function untilStamp(d: Date): string {
  return `${d.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

/** Smallest day shift (−3..+3) that lands `from` weekday on `to` weekday. */
function weekdayDelta(from: number, to: number): number {
  let delta = (to - from) % 7;
  if (delta > 3) delta -= 7;
  else if (delta < -3) delta += 7;
  return delta;
}

function rruleIndex(recurrence: string[]): number {
  return recurrence.findIndex((line) => line.startsWith('RRULE'));
}

/** The RRULE's UNTIL stamp, if it carries one. */
function currentUntil(recurrence: string[]): string | null {
  const i = rruleIndex(recurrence);
  if (i === -1) return null;
  const match = /;UNTIL=([0-9TZ]+)/.exec(recurrence[i]);
  return match ? match[1] : null;
}

/** The recurrence with UNTIL set (COUNT dropped) on its RRULE, or null without one. */
function withUntil(recurrence: string[], stamp: string): string[] | null {
  const i = rruleIndex(recurrence);
  if (i === -1) return null;
  const next = [...recurrence];
  next[i] = `${next[i].replace(/;(?:UNTIL|COUNT)=[^;]*/g, '')};UNTIL=${stamp}`;
  return next;
}

/** The recurrence with its RRULE's BYDAY moved to `weekday`, EXDATEs kept. */
function withByday(recurrence: string[] | undefined, weekday: number): string[] | undefined {
  if (!recurrence) return undefined;
  const i = rruleIndex(recurrence);
  if (i === -1) return undefined;
  const code = BYDAY[((weekday % 7) + 7) % 7];
  const next = [...recurrence];
  next[i] = next[i].includes('BYDAY=')
    ? next[i].replace(/BYDAY=[^;]*/, `BYDAY=${code}`)
    : `${next[i]};BYDAY=${code}`;
  return next;
}

/** Maps a cached instance onto `weekday` at the given times, its week kept. */
function shiftInstances(weekday: number, startMin: number, endMin: number) {
  return (ev: CalendarEvent): CalendarEvent => {
    const evStart = new Date(ev.start);
    const day = addDays(startOfDay(evStart), weekdayDelta(evStart.getDay(), weekday));
    return {
      ...ev,
      start: dateAtMinutes(day, startMin).toISOString(),
      end: dateAtMinutes(day, endMin).toISOString(),
    };
  };
}

/**
 * A brand-new series is briefly a stand-in under the parent's own id, until
 * the sync engine delivers the real instances; those are not individually
 * addressable yet, so this-day operations decline (return null) for the
 * few seconds the stand-in lives.
 */
function isSeriesStandIn(event: CalendarEvent): boolean {
  return event.googleSeriesId !== undefined && event.id === event.googleSeriesId;
}

export interface GoogleWeeklyInput {
  title: string;
  categoryId: CategoryId;
  /** The first occurrence's day — its weekday becomes the BYDAY. */
  day: Date;
  startMin: number;
  endMin: number;
  /** Optional series end (a migrated template's untilISO), inclusive. */
  until?: Date;
}

/** Create a real Google recurring event; the first occurrence is `day`. */
export async function createGoogleWeekly(input: GoogleWeeklyInput): Promise<CalendarEvent> {
  return getGoogleCalendarStore().createSeries({
    title: input.title,
    categoryId: input.categoryId,
    start: dateAtMinutes(input.day, input.startMin).toISOString(),
    end: dateAtMinutes(input.day, input.endMin).toISOString(),
    recurrence: [weeklyRRule(input.day.getDay(), input.until)],
  });
}

/** "Just this day" move/resize: PATCH the instance — other weeks keep their place. */
export async function moveGoogleInstanceOnly(
  event: CalendarEvent,
  targetDay: Date,
  startMin: number,
  endMin: number
): Promise<RecurringOpResult | null> {
  if (isSeriesStandIn(event)) return null;
  const store = getGoogleCalendarStore();
  const prevStart = event.start;
  const prevEnd = event.end;
  await store.update(event.id, {
    start: dateAtMinutes(targetDay, startMin).toISOString(),
    end: dateAtMinutes(targetDay, endMin).toISOString(),
  });
  return {
    undo: { kind: 'restore-times', eventId: event.id, prevStart, prevEnd },
    revert: async () => {
      await store.update(event.id, { start: prevStart, end: prevEnd });
    },
  };
}

/** "Every week" move/resize: shift the parent's start/end, RRULE's BYDAY along. */
export async function moveGoogleSeries(
  event: CalendarEvent,
  targetDay: Date,
  startMin: number,
  endMin: number
): Promise<RecurringOpResult | null> {
  const seriesId = event.googleSeriesId;
  if (!seriesId) return null;
  const store = getGoogleCalendarStore();
  const parent = await store.getSeries(seriesId);
  if (!parent.start?.dateTime || !parent.end?.dateTime) return null;
  const parentStart = new Date(parent.start.dateTime);
  const parentEnd = new Date(parent.end.dateTime);
  const targetWeekday = targetDay.getDay();
  const firstDay = addDays(
    startOfDay(parentStart),
    weekdayDelta(parentStart.getDay(), targetWeekday)
  );
  const timeZone = localTimeZone();
  const recurrence = withByday(parent.recurrence, targetWeekday);
  const body: Record<string, unknown> = {
    start: { dateTime: dateAtMinutes(firstDay, startMin).toISOString(), timeZone },
    end: { dateTime: dateAtMinutes(firstDay, endMin).toISOString(), timeZone },
    ...(recurrence ? { recurrence } : {}),
  };
  const undoBody: GoogleParentPatch = {
    start: { dateTime: parent.start.dateTime, timeZone: parent.start.timeZone ?? timeZone },
    end: { dateTime: parent.end.dateTime, timeZone: parent.end.timeZone ?? timeZone },
    ...(parent.recurrence ? { recurrence: parent.recurrence } : {}),
  };
  await store.patchSeries(seriesId, body, shiftInstances(targetWeekday, startMin, endMin));
  return {
    undo: { kind: 'g-restore-parent', seriesId, title: event.title, body: undoBody },
    revert: async () => {
      await store.patchSeries(
        seriesId,
        undoBody as Record<string, unknown>,
        shiftInstances(parentStart.getDay(), minutesOfDay(parentStart), minutesOfDay(parentEnd))
      );
    },
  };
}

/** "Just this day" title/category edit on one instance. */
export async function editGoogleInstanceOnly(
  event: CalendarEvent,
  patch: { title?: string; categoryId?: CategoryId }
): Promise<RecurringOpResult | null> {
  if (isSeriesStandIn(event)) return null;
  const store = getGoogleCalendarStore();
  await store.update(event.id, patch);
  const prev = { title: event.title, categoryId: event.categoryId };
  return {
    undo: { kind: 'restore-patch', eventId: event.id, patch: prev },
    revert: async () => {
      await store.update(event.id, prev);
    },
  };
}

/** "Every week" title/category edit: the parent takes the new name. */
export async function editGoogleSeries(
  event: CalendarEvent,
  patch: { title?: string; categoryId?: CategoryId }
): Promise<RecurringOpResult | null> {
  const seriesId = event.googleSeriesId;
  if (!seriesId) return null;
  const store = getGoogleCalendarStore();
  const title = patch.title ?? event.title;
  await store.patchSeries(seriesId, { summary: title }, (ev) => ({ ...ev, ...patch, title }));
  const prev = { title: event.title, categoryId: event.categoryId };
  return {
    undo: { kind: 'g-restore-parent', seriesId, title: event.title, body: { summary: event.title } },
    revert: async () => {
      await store.patchSeries(seriesId, { summary: prev.title }, (ev) => ({ ...ev, ...prev }));
    },
  };
}

/** "Just this day" delete: DELETE the instance — the weekly rhythm continues. */
export async function skipGoogleInstance(event: CalendarEvent): Promise<RecurringOpResult | null> {
  if (isSeriesStandIn(event)) return null;
  const store = getGoogleCalendarStore();
  const restore = {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    categoryId: event.categoryId,
  };
  await store.remove(event.id);
  return {
    undo: { kind: 'restore-event', event: restore },
    revert: async () => {
      await store.create(restore); // a 'g:' id revives the soft-deleted instance
    },
  };
}

/**
 * "Every week" delete / stop repeating, with the past preserved: RRULE UNTIL
 * becomes the last occurrence before today (UTC, per RFC 5545). A series
 * with no past occurrences is deleted whole — parent and all.
 */
export async function endGoogleSeries(
  event: CalendarEvent,
  now: Date = new Date()
): Promise<RecurringOpResult | null> {
  const seriesId = event.googleSeriesId;
  if (!seriesId) return null;
  const store = getGoogleCalendarStore();
  const parent = await store.getSeries(seriesId);
  if (!parent.start?.dateTime) return null;
  const parentStart = new Date(parent.start.dateTime);
  const today = startOfDay(now);
  let back = (today.getDay() - parentStart.getDay() + 7) % 7;
  if (back === 0) back = 7; // strictly before today
  const lastStart = dateAtMinutes(addDays(today, -back), minutesOfDay(parentStart));

  const stamp = untilStamp(lastStart);
  const ended = withUntil(parent.recurrence ?? [], stamp);
  if (lastStart.getTime() < parentStart.getTime() || !ended) {
    // Nothing behind us to keep (or no RRULE to amend): the series goes whole.
    await store.removeSeries(seriesId, event.title);
    return {
      undo: { kind: 'g-restore-parent', seriesId, title: event.title, body: { status: 'confirmed' } },
      revert: async () => {
        await store.patchSeries(seriesId, { status: 'confirmed' });
      },
    };
  }
  const existing = currentUntil(parent.recurrence ?? []);
  if (existing && existing <= stamp) return null; // already ended further back
  const cutoffMs = lastStart.getTime();
  await store.patchSeries(seriesId, { recurrence: ended }, (ev) =>
    new Date(ev.start).getTime() > cutoffMs ? null : ev
  );
  const undoBody: GoogleParentPatch = { recurrence: parent.recurrence };
  return {
    undo: { kind: 'g-restore-parent', seriesId, title: event.title, body: undoBody },
    revert: async () => {
      await store.patchSeries(seriesId, undoBody as Record<string, unknown>);
    },
  };
}

/** Ledger-undo executor: PATCH the parent back (see 'g-restore-parent'). */
export async function restoreGoogleParent(seriesId: string, body: GoogleParentPatch): Promise<void> {
  await getGoogleCalendarStore().patchSeries(seriesId, body as Record<string, unknown>);
}

/** Ledger-undo executor: DELETE a created series (see 'g-remove-series'). */
export async function removeGoogleSeries(seriesId: string, title: string): Promise<void> {
  await getGoogleCalendarStore().removeSeries(seriesId, title);
}
