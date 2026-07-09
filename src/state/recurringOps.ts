import { dateAtMinutes, dateKey } from '../lib/time';
import type { LedgerUndo, RestorableEvent } from '../hermes/ledgerStore';
import { isSignedIn } from '../google/auth';
import {
  createGoogleWeekly,
  editGoogleInstanceOnly,
  editGoogleSeries,
  endGoogleSeries,
  isGoogleSeriesInstance,
  moveGoogleInstanceOnly,
  moveGoogleSeries,
  skipGoogleInstance,
} from '../google/googleSeriesOps';
import { getGoogleCalendarStore } from '../google/googleStore';
import {
  createTemplate,
  deleteTemplate,
  endTemplate,
  getException,
  getTemplateById,
  mergeOverride,
  nextOccurrenceOf,
  parseOccurrenceId,
  restoreException,
  setException,
  updateTemplate,
  upsertTemplate,
  type RecurringTemplate,
} from './recurrence';
import type { CalendarEvent, CategoryId, EventInput } from './types';

// Scope-aware mutations on recurring occurrences, shared by the grid, the
// event popover and the Hermes palette. Every operation returns the ledger
// undo shape plus a revert() the undo toast can call — both restore the
// exact exception/template state, so undo works for either scope.
//
// Two recurrence worlds hide behind one door: local weekly templates
// (expanded client-side) and Google recurring events (instances carrying
// googleSeriesId). Each operation routes by the event itself, so callers
// never ask which world they are in. Google operations reach the network
// and may reject; local ones cannot — hence everything is async now.

/** The event actions a this-day detach needs (from useEventActions). */
export interface DetachActions {
  createEvent: (input: EventInput) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
}

export interface RecurringOpResult {
  undo: LedgerUndo;
  revert: () => void | Promise<void>;
}

function snapshot(template: RecurringTemplate): RecurringTemplate {
  return { ...template, exceptions: { ...template.exceptions } };
}

/**
 * "Just this day" move/resize. Local: on the occurrence's own date it becomes
 * a this-day override; on another date the occurrence is skipped and a
 * detached one-off takes its place. Google: the instance is PATCHed directly.
 */
export async function moveOccurrenceOnly(
  event: CalendarEvent,
  targetDay: Date,
  startMin: number,
  endMin: number,
  actions: DetachActions
): Promise<RecurringOpResult | null> {
  if (isGoogleSeriesInstance(event)) {
    return moveGoogleInstanceOnly(event, targetDay, startMin, endMin);
  }
  const occ = parseOccurrenceId(event.id);
  if (!occ) return null;
  const prev = getException(occ.templateId, occ.dateKey);
  if (dateKey(targetDay) === occ.dateKey) {
    setException(occ.templateId, occ.dateKey, mergeOverride(prev, { startMin, endMin }));
    return {
      undo: { kind: 'restore-exception', templateId: occ.templateId, dateKey: occ.dateKey, prev },
      revert: () => restoreException(occ.templateId, occ.dateKey, prev),
    };
  }
  setException(occ.templateId, occ.dateKey, 'skip');
  const created = await actions.createEvent({
    title: event.title,
    categoryId: event.categoryId,
    start: dateAtMinutes(targetDay, startMin).toISOString(),
    end: dateAtMinutes(targetDay, endMin).toISOString(),
  });
  return {
    undo: {
      kind: 'restore-exception',
      templateId: occ.templateId,
      dateKey: occ.dateKey,
      prev,
      removeEventId: created.id,
    },
    revert: async () => {
      restoreException(occ.templateId, occ.dateKey, prev);
      await actions.deleteEvent(created.id);
    },
  };
}

/** "Every week" move/resize: the template (or Google parent) changes weekday and times. */
export async function moveWholeTemplate(
  event: CalendarEvent,
  targetDay: Date,
  startMin: number,
  endMin: number
): Promise<RecurringOpResult | null> {
  if (isGoogleSeriesInstance(event)) {
    return moveGoogleSeries(event, targetDay, startMin, endMin);
  }
  const occ = parseOccurrenceId(event.id);
  const template = occ ? getTemplateById(occ.templateId) : null;
  if (!template) return null;
  const prev = snapshot(template);
  updateTemplate(template.id, { weekday: targetDay.getDay(), startMin, endMin });
  return {
    undo: { kind: 'restore-template', template: prev },
    revert: () => upsertTemplate(prev),
  };
}

/** "Just this day" title/category edit: a this-day override (or instance PATCH). */
export async function editOccurrenceOnly(
  event: CalendarEvent,
  patch: { title?: string; categoryId?: CategoryId }
): Promise<RecurringOpResult | null> {
  if (isGoogleSeriesInstance(event)) return editGoogleInstanceOnly(event, patch);
  const occ = parseOccurrenceId(event.id);
  if (!occ) return null;
  const prev = getException(occ.templateId, occ.dateKey);
  setException(occ.templateId, occ.dateKey, mergeOverride(prev, patch));
  return {
    undo: { kind: 'restore-exception', templateId: occ.templateId, dateKey: occ.dateKey, prev },
    revert: () => restoreException(occ.templateId, occ.dateKey, prev),
  };
}

/** "Every week" title/category edit on the template (or Google parent). */
export async function editWholeTemplate(
  event: CalendarEvent,
  patch: { title?: string; categoryId?: CategoryId }
): Promise<RecurringOpResult | null> {
  if (isGoogleSeriesInstance(event)) return editGoogleSeries(event, patch);
  const occ = parseOccurrenceId(event.id);
  const template = occ ? getTemplateById(occ.templateId) : null;
  if (!template) return null;
  const prev = snapshot(template);
  updateTemplate(template.id, patch);
  return {
    undo: { kind: 'restore-template', template: prev },
    revert: () => upsertTemplate(prev),
  };
}

/** "Just this day" delete: skip the occurrence (or DELETE the instance). */
export async function skipOccurrence(event: CalendarEvent): Promise<RecurringOpResult | null> {
  if (isGoogleSeriesInstance(event)) return skipGoogleInstance(event);
  const occ = parseOccurrenceId(event.id);
  if (!occ) return null;
  const prev = getException(occ.templateId, occ.dateKey);
  setException(occ.templateId, occ.dateKey, 'skip');
  return {
    undo: { kind: 'restore-exception', templateId: occ.templateId, dateKey: occ.dateKey, prev },
    revert: () => restoreException(occ.templateId, occ.dateKey, prev),
  };
}

/** "Every week" delete / stop repeating: end the series, keep its past. */
export async function endSeries(
  event: CalendarEvent,
  now: Date = new Date()
): Promise<RecurringOpResult | null> {
  if (isGoogleSeriesInstance(event)) return endGoogleSeries(event, now);
  const occ = parseOccurrenceId(event.id);
  const template = occ ? getTemplateById(occ.templateId) : null;
  if (!template) return null;
  const prev = snapshot(template);
  endTemplate(template.id, now);
  return {
    undo: { kind: 'restore-template', template: prev },
    revert: () => upsertTemplate(prev),
  };
}

/* -------------------------------------------------------- weekly creation ---- */

export interface WeeklyRhythmInput {
  title: string;
  categoryId: CategoryId;
  /** 0 = Sunday … 6 = Saturday (Date.getDay). */
  weekday: number;
  startMin: number;
  endMin: number;
  /** First occurrence; defaults to the next `weekday` from today. */
  sinceDay?: Date;
  /** When set, its restoration joins the undo (one-off → weekly conversions). */
  restoreEvent?: RestorableEvent;
}

export interface WeeklyRhythmResult extends RecurringOpResult {
  /** Where the rhythm lives — Google Calendar while signed in, else here. */
  where: 'google' | 'local';
}

/**
 * Create a weekly rhythm where it belongs: signed in to Google, a real
 * recurring event (RRULE on the parent, the professional standard); signed
 * out, a local RecurringTemplate exactly as before.
 */
export async function createWeeklyRhythm(input: WeeklyRhythmInput): Promise<WeeklyRhythmResult> {
  const day = input.sinceDay ?? nextOccurrenceOf(input.weekday);
  if (isSignedIn()) {
    const created = await createGoogleWeekly({
      title: input.title,
      categoryId: input.categoryId,
      day,
      startMin: input.startMin,
      endMin: input.endMin,
    });
    const seriesId = created.googleSeriesId ?? created.id;
    return {
      where: 'google',
      undo: {
        kind: 'g-remove-series',
        seriesId,
        title: input.title,
        ...(input.restoreEvent ? { restoreEvent: input.restoreEvent } : {}),
      },
      revert: async () => {
        await getGoogleCalendarStore().removeSeries(seriesId, input.title);
      },
    };
  }
  const template = createTemplate({
    title: input.title,
    categoryId: input.categoryId,
    weekday: input.weekday,
    startMin: input.startMin,
    endMin: input.endMin,
    sinceISO: dateKey(day),
  });
  return {
    where: 'local',
    undo: {
      kind: 'remove-template',
      templateId: template.id,
      ...(input.restoreEvent ? { restoreEvent: input.restoreEvent } : {}),
    },
    revert: () => deleteTemplate(template.id),
  };
}
