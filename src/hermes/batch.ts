import { GApiError } from '../google/auth';
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

/**
 * The identity every instance of a recurring series shares: the local
 * RecurringTemplate id, or the Google recurring parent's id. One-off events
 * have none — their own id is their identity.
 */
export function seriesKeyOf(event: CalendarEvent): string | null {
  return event.templateId ?? event.googleSeriesId ?? null;
}

/* ---------------------------------------------------------------- dedupe ---- */

/** The fields dedupeBatchRows needs from a staged review row. */
export interface DedupableRow {
  /** Resolved target; null while ambiguous/missing (those rows pass through). */
  event: CalendarEvent | null;
  scope: RecurrenceScope;
  /** How many sibling instances of the same series this row also covers. */
  collapsed?: number;
}

/**
 * Collapse a staged batch's redundant rows — the hard guarantee that four
 * ops resolving to four instances of the SAME weekly series never become
 * four writes against one parent. Applies wherever the ops came from
 * (deterministic parser, the brain, a hermes:batch event). Rules:
 *
 * - several rows on instances of the same series, scope 'template': one row
 *   (the first) — a single parent write covers every week;
 * - an occurrence-scope row on a series that ALSO has a template-scope row
 *   is subsumed by the template row (it changes that week too);
 * - the exact same event resolved twice keeps only the first row, silently;
 * - occurrence-scope rows on the same series but different days are
 *   legitimate distinct changes and all stay.
 *
 * Kept rows gain `collapsed`: how many distinct sibling instances they now
 * cover, so the review UI can say "…and 3 more instances of the same series".
 */
export function dedupeBatchRows<T extends DedupableRow>(rows: T[]): T[] {
  // The first template-scope row per series subsumes that series' others.
  const templateWinner = new Map<string, T>();
  for (const row of rows) {
    if (!row.event || row.scope !== 'template') continue;
    const key = seriesKeyOf(row.event);
    if (key && !templateWinner.has(key)) templateWinner.set(key, row);
  }
  const seenIds = new Set<string>();
  const collapsedInto = new Map<T, number>();
  const kept: T[] = [];
  for (const row of rows) {
    if (!row.event) {
      kept.push(row); // unresolved rows keep their chooser / missing note
      continue;
    }
    const key = seriesKeyOf(row.event);
    const winner = key ? templateWinner.get(key) : undefined;
    if (winner && winner !== row) {
      // Another row already changes this whole series; count distinct
      // instances so the kept row can say how much it covers.
      if (row.event.id !== winner.event!.id) {
        collapsedInto.set(winner, (collapsedInto.get(winner) ?? 0) + 1);
      }
      continue;
    }
    if (seenIds.has(row.event.id)) continue; // the same event, resolved twice
    seenIds.add(row.event.id);
    kept.push(row);
  }
  return kept.map((row) => {
    const extra = collapsedInto.get(row);
    return extra ? { ...row, collapsed: (row.collapsed ?? 0) + extra } : row;
  });
}

function restorable(event: CalendarEvent): RestorableEvent {
  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    categoryId: event.categoryId,
    allDay: event.allDay,
    meetingUrl: event.meetingUrl,
  };
}

/**
 * Execute one pending action through the existing routed ops (recurring
 * scope and Google optimistic/rollback included). Throws — or returns
 * null when a recurring target has vanished — on failure; the caller
 * collects successes into one composite ledger entry.
 *
 * `mutatedParents` is the execution safety net under dedupeBatchRows: pass
 * one Set per batch and a second template-scope op against a series parent
 * already changed in that batch returns 'duplicate' instead of racing Google
 * into a conflict — the first write already covered every week.
 */
export async function performBatchOp(
  action: PendingAction,
  scope: RecurrenceScope,
  deps: BatchDeps,
  mutatedParents?: Set<string>
): Promise<BatchOpResult | 'duplicate' | null> {
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
      if (scope === 'template') {
        const parentKey = seriesKeyOf(event);
        if (parentKey && mutatedParents?.has(parentKey)) return 'duplicate';
        const result = await moveWholeTemplate(event, day, startMin, endMin);
        if (result && parentKey) mutatedParents?.add(parentKey);
        return result;
      }
      return moveOccurrenceOnly(event, day, startMin, endMin, deps);
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
      if (scope === 'template') {
        const parentKey = seriesKeyOf(event);
        if (parentKey && mutatedParents?.has(parentKey)) return 'duplicate';
        const result = await endSeries(event);
        if (result && parentKey) mutatedParents?.add(parentKey);
        return result;
      }
      return skipOccurrence(event);
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

/** The title an action goes by — the target's, or the new event's for creates. */
function actionTitle(action: PendingAction): string {
  return action.kind === 'create' ? action.title : action.event.title;
}

/**
 * A batch-safe display name: the bare title, disambiguated with the target
 * occurrence's day and time — "Gym (Tue 7:30)" — whenever another action in
 * the batch shares the title. "Gym and Gym" told the owner nothing.
 */
export function actionDisplayName(action: PendingAction, all: PendingAction[]): string {
  const title = actionTitle(action);
  if (action.kind !== 'create' && all.filter((a) => actionTitle(a) === title).length > 1) {
    return `${title} (${fmtEventFrom(action.event)})`;
  }
  return title;
}

/**
 * A short human phrase for why an op failed, when the error can tell us —
 * used in the partial-failure ledger line and toast. Null when unknowable.
 */
export function describeOpFailure(err: unknown): string | null {
  if (!(err instanceof GApiError)) return null;
  if (err.status === 404 || err.status === 410) return 'it was already deleted on Google Calendar';
  if (err.status === 409) return 'Google reported a conflict';
  if (err.status === 401 || err.status === 403) return 'Google declined permission';
  if (err.status === 429) return 'Google asked us to slow down';
  if (err.status === 529 || err.status >= 500) return 'Google Calendar is briefly overloaded';
  return null;
}

/** One ledger sentence for a confirmed batch, in Hermes's voice. */
export function narrateBatch(
  rows: Array<{ action: PendingAction; scope: RecurrenceScope }>
): string {
  const all = rows.map((r) => r.action);
  const moved = rows.filter((r) => r.action.kind === 'move');
  const cancelled = rows.filter((r) => r.action.kind === 'cancel');
  const created = rows.filter((r) => r.action.kind === 'create');
  const parts: string[] = [];
  if (moved.length > 0) {
    const names = moved.map((r) => actionDisplayName(r.action, all));
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
    const names = cancelled.map((r) => actionDisplayName(r.action, all));
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
