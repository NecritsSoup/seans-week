import { dateAtMinutes, fmtClock, minutesOfDay, startOfDay } from '../lib/time';
import { weekdayName, type RecurrenceScope } from '../state/recurrence';
import {
  createWeeklyRhythm,
  endSeries,
  moveOccurrenceOnly,
  moveWholeTemplate,
  skipOccurrence,
} from '../state/recurringOps';
import type { CalendarEvent, EventInput, EventPatch } from '../state/types';
import type { SingleIntent } from './intents/types';
import type { LedgerUndo, RestorableEvent } from './ledgerStore';
import type { PendingAction } from './pending';

// The batch execution layer under the palette's review UI: one routed
// executor per operation (recurring scope, Google series and one-offs all
// go through the same doors the single-intent path uses), plus the public
// stageBatch() entry point other brains — an LLM fallback, a scroll button —
// can use to inject a list of operations into the same review pipeline.

/** The event actions batch execution needs (from useEventActions). */
export interface BatchDeps {
  createEvent: (input: EventInput) => Promise<CalendarEvent>;
  updateEvent: (id: string, patch: EventPatch) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
}

/** One executed operation: its undo shape and a direct revert for the toast. */
export interface BatchOpResult {
  undo: LedgerUndo;
  revert: () => void | Promise<void>;
}

function restorable(event: CalendarEvent): RestorableEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    categoryId: event.categoryId,
    allDay: event.allDay,
  };
}

/**
 * Execute one pending action through the existing routed ops (recurring
 * scope and Google optimistic/rollback included). Throws — or returns
 * null when a recurring target has vanished — on failure; the caller
 * collects successes into one composite ledger entry.
 */
export async function performBatchOp(
  action: PendingAction,
  scope: RecurrenceScope,
  deps: BatchDeps
): Promise<BatchOpResult | null> {
  if (action.kind === 'create') {
    if (action.repeatWeekly) {
      const rhythm = await createWeeklyRhythm({
        title: action.title,
        categoryId: action.categoryId,
        weekday: action.day.getDay(),
        startMin: action.startMin,
        endMin: action.endMin,
        sinceDay: action.day,
      });
      return { undo: rhythm.undo, revert: rhythm.revert };
    }
    const created = await deps.createEvent({
      title: action.title,
      categoryId: action.categoryId,
      start: dateAtMinutes(action.day, action.startMin).toISOString(),
      end: dateAtMinutes(action.day, action.endMin).toISOString(),
    });
    return {
      undo: { kind: 'delete-created', eventId: created.id },
      revert: () => deps.deleteEvent(created.id),
    };
  }

  if (action.kind === 'move') {
    const { event, day, startMin, endMin } = action;
    if (event.recurring) {
      return scope === 'template'
        ? moveWholeTemplate(event, day, startMin, endMin)
        : moveOccurrenceOnly(event, day, startMin, endMin, deps);
    }
    const prevStart = event.start;
    const prevEnd = event.end;
    await deps.updateEvent(event.id, {
      start: dateAtMinutes(day, startMin).toISOString(),
      end: dateAtMinutes(day, endMin).toISOString(),
    });
    return {
      undo: { kind: 'restore-times', eventId: event.id, prevStart, prevEnd },
      revert: async () => {
        await deps.updateEvent(event.id, { start: prevStart, end: prevEnd });
      },
    };
  }

  if (action.kind === 'cancel') {
    const { event } = action;
    if (event.recurring) {
      return scope === 'template' ? endSeries(event) : skipOccurrence(event);
    }
    await deps.deleteEvent(event.id);
    return {
      undo: { kind: 'restore-event', event: restorable(event) },
      revert: async () => {
        await deps.createEvent(restorable(event));
      },
    };
  }

  // 'recur' never reaches a batch — the parser only fans out create/move/cancel.
  return null;
}

/* -------------------------------------------------------------- narration ---- */

/** "Gym — push day, Gym — pull day and Gym — legs day" */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** One ledger sentence for a confirmed batch, in Hermes's voice. */
export function narrateBatch(
  rows: Array<{ action: PendingAction; scope: RecurrenceScope }>
): string {
  const moved = rows.filter((r) => r.action.kind === 'move');
  const cancelled = rows.filter((r) => r.action.kind === 'cancel');
  const created = rows.filter((r) => r.action.kind === 'create');
  const parts: string[] = [];
  if (moved.length > 0) {
    const names = moved.map((r) => (r.action as { event: CalendarEvent }).event.title);
    const first = moved[0].action as Extract<PendingAction, { kind: 'move' }>;
    const sameTime = moved.every(
      (r) => (r.action as Extract<PendingAction, { kind: 'move' }>).startMin === first.startMin
    );
    const everyWeek = moved.every((r) => r.scope === 'template');
    parts.push(
      `Moved ${listNames(names)}${sameTime ? ` to ${fmtClock(first.startMin)}` : ''}${
        everyWeek && (moved[0].action as { event: CalendarEvent }).event.recurring
          ? ' — every week'
          : ''
      }`
    );
  }
  if (cancelled.length > 0) {
    const names = cancelled.map((r) => (r.action as { event: CalendarEvent }).event.title);
    parts.push(`cancelled ${listNames(names)}`);
  }
  if (created.length > 0) {
    const names = created.map((r) => (r.action as { title: string }).title);
    parts.push(`added ${listNames(names)}`);
  }
  const sentence = parts.join('; ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)} — one batch, at your request.`;
}

/* --------------------------------------------------------------- staging ---- */

export const BATCH_STAGE_EVENT = 'hermes:batch';

/**
 * Public entry point for other brains (the coming LLM fallback, buttons on
 * other surfaces): stage a list of operations into the palette's batch
 * review. The palette opens, resolves each op against the calendar (fuzzy
 * queries, ambiguity choosers, recurrence scope pills), previews every row
 * as a ghost on the grid and executes on one confirm with one undo.
 *
 * Ops are the parser's own shapes (SingleIntent = create/move/cancel from
 * src/hermes/intents/types.ts) — an LLM layer should emit exactly these.
 */
export function stageBatch(ops: SingleIntent[]): void {
  if (ops.length === 0) return;
  window.dispatchEvent(new CustomEvent<SingleIntent[]>(BATCH_STAGE_EVENT, { detail: ops }));
}

/** A compact "from" summary for a review row ("Mon 7:00–8:00"). */
export function fmtEventFrom(event: CalendarEvent): string {
  const start = new Date(event.start);
  return `${start.toLocaleDateString(undefined, { weekday: 'short' })} ${fmtClock(
    minutesOfDay(start)
  )}`;
}

/** A compact "to" summary for a move row ("Fri 17:30"). */
export function fmtMoveTo(day: Date, startMin: number): string {
  return `${startOfDay(day).toLocaleDateString(undefined, { weekday: 'short' })} ${fmtClock(startMin)}`;
}

/** 'Friday' for the day an event occurrence sits on. */
export function eventWeekday(event: CalendarEvent): string {
  return weekdayName(new Date(event.start).getDay());
}
