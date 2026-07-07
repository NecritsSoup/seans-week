import { dateAtMinutes, dateKey } from '../lib/time';
import type { LedgerUndo } from '../hermes/ledgerStore';
import {
  endTemplate,
  getException,
  getTemplateById,
  mergeOverride,
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
 * "Just this day" move/resize. On the occurrence's own date it becomes a
 * this-day override; on another date the occurrence is skipped and a
 * detached one-off takes its place.
 */
export async function moveOccurrenceOnly(
  event: CalendarEvent,
  targetDay: Date,
  startMin: number,
  endMin: number,
  actions: DetachActions
): Promise<RecurringOpResult | null> {
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

/** "Every week" move/resize: the template itself changes weekday and times. */
export function moveWholeTemplate(
  event: CalendarEvent,
  targetDay: Date,
  startMin: number,
  endMin: number
): RecurringOpResult | null {
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

/** "Just this day" title/category edit: a this-day override. */
export function editOccurrenceOnly(
  event: CalendarEvent,
  patch: { title?: string; categoryId?: CategoryId }
): RecurringOpResult | null {
  const occ = parseOccurrenceId(event.id);
  if (!occ) return null;
  const prev = getException(occ.templateId, occ.dateKey);
  setException(occ.templateId, occ.dateKey, mergeOverride(prev, patch));
  return {
    undo: { kind: 'restore-exception', templateId: occ.templateId, dateKey: occ.dateKey, prev },
    revert: () => restoreException(occ.templateId, occ.dateKey, prev),
  };
}

/** "Every week" title/category edit on the template. */
export function editWholeTemplate(
  event: CalendarEvent,
  patch: { title?: string; categoryId?: CategoryId }
): RecurringOpResult | null {
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

/** "Just this day" delete: skip the occurrence, other weeks untouched. */
export function skipOccurrence(event: CalendarEvent): RecurringOpResult | null {
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
export function endSeries(event: CalendarEvent, now: Date = new Date()): RecurringOpResult | null {
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
