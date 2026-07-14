import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addDays,
  dateAtMinutes,
  fmtClock,
  fmtRange,
  minutesOfDay,
  startOfDay,
} from '../lib/time';
import { isSignedIn } from '../google/auth';
import { categoryById } from '../state/categories';
import { useEventActions, useEvents } from '../state/EventsContext';
import { weekdayName, type RecurrenceScope } from '../state/recurrence';
import {
  createWeeklyRhythm,
  endSeries,
  moveOccurrenceOnly,
  moveWholeTemplate,
  skipOccurrence,
} from '../state/recurringOps';
import { addTodo } from '../state/todos';
import type { CalendarEvent } from '../state/types';
import type { ViewMode } from '../stage/Stage';
import { useToast } from '../ui';
import {
  fmtEventFrom,
  fmtMoveTo,
  listNames,
  narrateBatch,
  performBatchOp,
} from './batch';
import { findAllEventsByQuery, findEventsByQuery } from './intents/findEvent';
import {
  batchMeridian,
  parseCommand,
  resolveBatchMoveTimes,
  resolveMoveTimes,
} from './intents/parse';
import type {
  CancelIntent,
  MoveIntent,
  RecurIntent,
  SingleIntent,
  TimeMatch,
} from './intents/types';
import {
  appendLedger,
  markLedgerUndone,
  type LedgerUndo,
  type RestorableEvent,
} from './ledgerStore';
import {
  clearPendingAction,
  setPendingAction,
  setPendingActions,
  type PendingAction,
} from './pending';

/**
 * A staged action handed to the palette from another surface (a scroll's
 * "Schedule" button, for example): the palette opens straight into its
 * confirm step, ghost on the grid, and runs onCommit after a confirmed save.
 */
export interface PaletteSeed {
  action: PendingAction;
  summary: string;
  onCommit?: () => void;
}

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  /** Moves the Stage: a day to anchor on and/or a view to switch to. */
  onNavigate: (day: Date | null, view: ViewMode | null) => void;
  /** Optional pre-staged confirmation (see PaletteSeed). */
  seed?: PaletteSeed | null;
  /** Optional pre-staged batch of operations (see stageBatch in batch.ts). */
  batchSeed?: SingleIntent[] | null;
}

/** One reviewable operation in a staged batch. */
interface BatchRow {
  key: string;
  op: SingleIntent;
  /** Resolved target for move/cancel rows; null while ambiguous/missing. */
  event: CalendarEvent | null;
  /** Tied-top matches when more than one — resolved inline per row. */
  candidates: CalendarEvent[];
  scope: RecurrenceScope;
  /** The executable action, once the row is resolved. */
  action: PendingAction | null;
  /** The query matched nothing on the calendar. */
  missing: boolean;
}

interface BatchState {
  rows: BatchRow[];
  /** A bare shared time ("all be at 5:30") — its meridian is toggleable. */
  bareTime: TimeMatch | null;
  meridian: 'am' | 'pm';
  /** Key of the row whose inline chooser is open. */
  choosing: string | null;
}

type PaletteMode =
  | { kind: 'input' }
  | {
      kind: 'choose';
      intent: MoveIntent | CancelIntent | RecurIntent;
      candidates: CalendarEvent[];
    }
  | { kind: 'confirm'; action: PendingAction; summary: string }
  | { kind: 'batch'; batch: BatchState }
  | { kind: 'message'; text: string };

const SUGGESTIONS = [
  'add gym friday 8am',
  'add stretching every monday 7pm',
  'move friday’s gym to 9am',
  'cancel dinner thursday',
  'todo: email advisor',
  'dispatches',
  'next week',
];

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

function capitalizeFirst(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function fmtDay(day: Date): string {
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function fmtWhen(day: Date, startMin: number, endMin: number): string {
  return `${fmtDay(day)}, ${fmtRange(startMin, endMin)}`;
}

function fmtEventWhen(event: CalendarEvent): string {
  const start = new Date(event.start);
  return fmtWhen(start, minutesOfDay(start), minutesOfDay(new Date(event.end)));
}

/** 'Friday' for the day an event occurrence sits on. */
function eventDayName(event: CalendarEvent): string {
  return weekdayName(new Date(event.start).getDay());
}

/** "5:30pm" — how batch hints and the meridian toggle show a time. */
function fmtAmPm(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;
}

/** The name a batch row goes by before/after resolution. */
function batchRowName(row: { op: SingleIntent; event: CalendarEvent | null }): string {
  if (row.event) return row.event.title;
  return row.op.kind === 'create' ? row.op.title : row.op.query;
}

/** The restore shape for undoing a delete of `event`. */
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

/** The day a pending action's ghost (or marked event) sits on. */
function actionDay(action: PendingAction): Date {
  return action.kind === 'cancel' || action.kind === 'recur'
    ? startOfDay(new Date(action.event.start))
    : action.day;
}

/** Loose title search for the QUERY intent — every hit, soonest first. */
function searchEvents(events: CalendarEvent[], query: string): CalendarEvent[] {
  const q = query.toLowerCase().trim();
  if (q.length < 2) return [];
  const keywords = q.split(/\s+/).filter((w) => w.length > 2);
  const matches = events.filter((ev) => {
    const title = ev.title.toLowerCase();
    return title.includes(q) || keywords.some((k) => title.includes(k));
  });
  const nowMs = Date.now();
  return matches
    .sort((a, b) => {
      const aUp = new Date(a.start).getTime() >= nowMs;
      const bUp = new Date(b.start).getTime() >= nowMs;
      if (aUp !== bUp) return aUp ? -1 : 1;
      return a.start.localeCompare(b.start);
    })
    .slice(0, 8);
}

/**
 * The Hermes Palette: one input that creates, moves, cancels, searches,
 * navigates and captures. Destructive intents preview as a ghost on the
 * grid and commit only on a second Enter.
 */
export function Palette({ open, onClose, onNavigate, seed = null, batchSeed = null }: PaletteProps) {
  const [text, setText] = useState('');
  const [mode, setMode] = useState<PaletteMode>({ kind: 'input' });
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const seedCommitRef = useRef<(() => void) | null>(null);

  const [rangeStart] = useState(() => addDays(startOfDay(new Date()), -14));
  const [rangeEnd] = useState(() => addDays(startOfDay(new Date()), 90));
  const events = useEvents(rangeStart, rangeEnd);
  const { createEvent, updateEvent, deleteEvent } = useEventActions();
  const { showToast } = useToast();

  const intent = useMemo(() => parseCommand(text, new Date(), events), [text, events]);
  const searchResults = useMemo(
    () => (intent?.kind === 'search' ? searchEvents(events, intent.query) : []),
    [intent, events]
  );

  // Reset on close; focus the input on open and whenever we return to it.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setText('');
      setMode({ kind: 'input' });
      setHighlight(0);
      clearPendingAction();
    }
  }, [open]);

  // Keep focus on the input in every mode so ⏎ / esc always land on the
  // dialog's key handler — clicking a row (which unmounts under the cursor)
  // would otherwise drop focus to the body and strand the keyboard.
  useEffect(() => {
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => setHighlight(0), [text]);

  // A seeded action skips straight to the confirm step, ghost and all.
  useEffect(() => {
    if (!open || !seed) return;
    const { action, summary, onCommit } = seed;
    seedCommitRef.current = onCommit ?? null;
    setPendingAction(action);
    onNavigate(actionDay(action), null);
    setMode({ kind: 'confirm', action, summary });
  }, [open, seed, onNavigate]);

  // An injected batch (stageBatch from batch.ts) opens straight into review.
  const stagedBatchRef = useRef<SingleIntent[] | null>(null);
  useEffect(() => {
    if (!open || !batchSeed || batchSeed.length === 0) return;
    if (stagedBatchRef.current === batchSeed) return;
    stagedBatchRef.current = batchSeed;
    stageBatchReview(batchSeed);
    // stageBatchReview is re-created per render but only reads current state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batchSeed]);

  if (!open) return null;

  function backToInput() {
    clearPendingAction();
    seedCommitRef.current = null;
    setMode({ kind: 'input' });
  }

  function close() {
    clearPendingAction();
    onClose();
  }

  function stageConfirm(action: PendingAction, summary: string) {
    setPendingAction(action);
    // Bring the affected day on stage so the ghost preview is visible.
    onNavigate(actionDay(action), null);
    setMode({ kind: 'confirm', action, summary });
  }

  function resolveTarget(intent: MoveIntent | CancelIntent | RecurIntent, event: CalendarEvent) {
    if (intent.kind === 'recur') {
      if (event.recurring) {
        setMode({
          kind: 'message',
          text: `“${event.title}” already repeats every ${eventDayName(event)}.`,
        });
        return;
      }
      if (event.source === 'google' && !isSignedIn()) {
        // The session lapsed: the event shows, but Google will not take writes.
        setMode({
          kind: 'message',
          text: 'The Google session has expired — reconnect in Settings and I will weave it into the weekly rhythm.',
        });
        return;
      }
      const startMin = minutesOfDay(new Date(event.start));
      stageConfirm(
        { kind: 'recur', event },
        `Make “${event.title}” repeat every ${eventDayName(event)} at ${fmtClock(startMin)}`
      );
      return;
    }
    if (intent.kind === 'cancel') {
      stageConfirm(
        { kind: 'cancel', event },
        `Cancel “${event.title}” — ${fmtEventWhen(event)}${
          event.recurring ? ` · repeats every ${eventDayName(event)}` : ''
        }`
      );
      return;
    }
    const origStart = new Date(event.start);
    const origStartMin = minutesOfDay(origStart);
    const origEndMin = minutesOfDay(new Date(event.end));
    const { startMin, endMin } = resolveMoveTimes(
      intent.targetTime,
      origStartMin,
      origEndMin,
      intent.raw.toLowerCase()
    );
    const day = intent.targetDay ?? startOfDay(origStart);
    stageConfirm(
      { kind: 'move', event, day, startMin, endMin },
      `Move “${event.title}” to ${fmtWhen(day, startMin, endMin)}${
        event.recurring ? ` · repeats every ${eventDayName(event)}` : ''
      }`
    );
  }

  function runFind(intent: MoveIntent | CancelIntent | RecurIntent) {
    const candidates = findEventsByQuery(events, intent.query, intent.queryDay);
    if (candidates.length === 0) {
      setMode({
        kind: 'message',
        text: 'I searched the calendar and found nothing like that. Try naming it another way?',
      });
    } else if (candidates.length === 1) {
      resolveTarget(intent, candidates[0]);
    } else {
      setHighlight(0);
      setMode({ kind: 'choose', intent, candidates });
    }
  }

  /* ------------------------------------------------------------- batches ---- */

  function moveTimesForRow(
    op: MoveIntent,
    event: CalendarEvent,
    bareTime: TimeMatch | null,
    meridian: 'am' | 'pm'
  ): { startMin: number; endMin: number } {
    const origStartMin = minutesOfDay(new Date(event.start));
    const origEndMin = minutesOfDay(new Date(event.end));
    const shared =
      bareTime !== null &&
      op.targetTime !== null &&
      !op.targetTime.startExplicit &&
      op.targetTime.startMin === bareTime.startMin;
    // A shared bare time resolves to the SAME side of the clock on every
    // row; a row-specific or explicit time keeps the single-move inference.
    return shared
      ? resolveBatchMoveTimes(op.targetTime, origStartMin, origEndMin, meridian)
      : resolveMoveTimes(op.targetTime, origStartMin, origEndMin, op.raw.toLowerCase());
  }

  function actionForBatchRow(
    row: BatchRow,
    bareTime: TimeMatch | null,
    meridian: 'am' | 'pm'
  ): PendingAction | null {
    const { op, event } = row;
    if (op.kind === 'create') {
      return {
        kind: 'create',
        title: op.title,
        categoryId: op.categoryId,
        day: op.day,
        startMin: op.startMin,
        endMin: op.endMin,
        repeatWeekly: op.repeatWeekly,
      };
    }
    if (!event) return null;
    if (op.kind === 'cancel') return { kind: 'cancel', event };
    const { startMin, endMin } = moveTimesForRow(op, event, bareTime, meridian);
    const day = op.targetDay ?? startOfDay(new Date(event.start));
    return { kind: 'move', event, day, startMin, endMin };
  }

  function buildBatchState(ops: SingleIntent[]): BatchState {
    let counter = 0;
    const rows: BatchRow[] = [];
    const push = (partial: Pick<BatchRow, 'op'> & Partial<BatchRow>) =>
      rows.push({
        key: `b${counter++}`,
        event: null,
        candidates: [],
        scope: 'occurrence',
        action: null,
        missing: false,
        ...partial,
      });

    for (const op of ops) {
      if (op.kind === 'create') {
        push({ op });
        continue;
      }
      const scope: RecurrenceScope = op.scopeHint === 'template' ? 'template' : 'occurrence';
      if (op.matchAll) {
        const targets = findAllEventsByQuery(events, op.query, op.queryDay);
        if (targets.length === 0) push({ op, scope, missing: true });
        else for (const target of targets) push({ op, scope, event: target });
      } else {
        const candidates = findEventsByQuery(events, op.query, op.queryDay);
        if (candidates.length === 0) push({ op, scope, missing: true });
        else if (candidates.length === 1) push({ op, scope, event: candidates[0] });
        else push({ op, scope, candidates });
      }
    }

    // Two ops landing on the same event collapse to the first.
    const seen = new Set<string>();
    const deduped = rows.filter((row) => {
      if (!row.event) return true;
      if (seen.has(row.event.id)) return false;
      seen.add(row.event.id);
      return true;
    });

    // A bare time shared by every move op gets one meridian for all rows,
    // shown in the header and flippable there (only 1–11 o'clock is ambiguous).
    const bareMoves = deduped
      .map((row) => row.op)
      .filter(
        (op): op is MoveIntent =>
          op.kind === 'move' && op.targetTime !== null && !op.targetTime.startExplicit
      );
    let bareTime: TimeMatch | null = null;
    if (
      bareMoves.length > 0 &&
      bareMoves.every((op) => op.targetTime!.startMin === bareMoves[0].targetTime!.startMin)
    ) {
      const t = bareMoves[0].targetTime!;
      const h = Math.floor(t.startMin / 60);
      if (h >= 1 && h <= 11) bareTime = t;
    }
    const origStarts = deduped
      .filter((row) => row.op.kind === 'move' && row.event)
      .map((row) => minutesOfDay(new Date(row.event!.start)));
    const meridian: 'am' | 'pm' = bareTime
      ? batchMeridian(bareTime, bareMoves[0].raw.toLowerCase(), origStarts)
      : 'am';

    for (const row of deduped) {
      row.action = actionForBatchRow(row, bareTime, meridian);
    }
    return { rows: deduped, bareTime, meridian, choosing: null };
  }

  /** Put a batch on stage: ghosts for every row, review list in the palette. */
  function applyBatch(batch: BatchState, navigate = false) {
    setPendingActions(batch.rows.map((row) => row.action).filter((a): a is PendingAction => a !== null));
    if (navigate) {
      const first = batch.rows.find((row) => row.action);
      if (first?.action) onNavigate(actionDay(first.action), null);
    }
    setMode({ kind: 'batch', batch });
  }

  /** Entry point for parsed AND injected batches (see stageBatch in batch.ts). */
  function stageBatchReview(ops: SingleIntent[]) {
    const batch = buildBatchState(ops);
    if (batch.rows.length === 0 || batch.rows.every((row) => row.missing)) {
      setMode({
        kind: 'message',
        text: 'I searched the calendar and found nothing like that. Try naming them another way?',
      });
      return;
    }
    applyBatch(batch, true);
  }

  function updateBatch(batch: BatchState, mutate: (rows: BatchRow[]) => BatchRow[]) {
    const rows = mutate(batch.rows);
    if (rows.length === 0) {
      backToInput();
      return;
    }
    applyBatch({ ...batch, rows });
  }

  function flipBatchMeridian(batch: BatchState) {
    const meridian: 'am' | 'pm' = batch.meridian === 'pm' ? 'am' : 'pm';
    const rows = batch.rows.map((row) =>
      row.op.kind === 'move'
        ? { ...row, action: actionForBatchRow(row, batch.bareTime, meridian) }
        : row
    );
    applyBatch({ ...batch, meridian, rows });
  }

  function flipBatchScope(batch: BatchState, key: string) {
    updateBatch(batch, (rows) =>
      rows.map((row) =>
        row.key === key
          ? { ...row, scope: row.scope === 'template' ? 'occurrence' : 'template' }
          : row
      )
    );
  }

  function dropBatchRow(batch: BatchState, key: string) {
    updateBatch(batch, (rows) => rows.filter((row) => row.key !== key));
  }

  function chooseBatchTarget(batch: BatchState, key: string, event: CalendarEvent) {
    const rows = batch.rows.map((row) =>
      row.key === key
        ? {
            ...row,
            event,
            candidates: [],
            action: actionForBatchRow(
              { ...row, event },
              batch.bareTime,
              batch.meridian
            ),
          }
        : row
    );
    applyBatch({ ...batch, rows, choosing: null });
  }

  async function executeBatch(batch: BatchState) {
    const rows = batch.rows.filter((row) => row.action !== null);
    if (rows.length === 0) return;
    const undos: LedgerUndo[] = [];
    const reverts: Array<() => void | Promise<void>> = [];
    const done: BatchRow[] = [];
    const failed: BatchRow[] = [];
    for (const row of rows) {
      try {
        const result = await performBatchOp(row.action!, row.scope, {
          createEvent,
          updateEvent,
          deleteEvent,
        });
        if (!result) {
          failed.push(row);
          continue;
        }
        undos.push(result.undo);
        reverts.push(result.revert);
        done.push(row);
      } catch {
        failed.push(row);
      }
    }

    if (done.length === 0) {
      appendLedger('error', 'A batch of changes could not be saved — the calendar is unchanged.');
      setMode({
        kind: 'message',
        text: 'None of those changes would take — the calendar is as it was.',
      });
      clearPendingAction();
      return;
    }

    const entry = appendLedger(
      'batch',
      narrateBatch(done.map((row) => ({ action: row.action!, scope: row.scope }))),
      { kind: 'batch', children: undos }
    );
    if (failed.length > 0) {
      appendLedger(
        'error',
        `${listNames(failed.map(batchRowName))} could not be changed — the rest of the batch went through.`
      );
    }

    const kinds = new Set(done.map((row) => row.action!.kind));
    const verb =
      kinds.size > 1 ? 'done' : kinds.has('move') ? 'moved' : kinds.has('cancel') ? 'cancelled' : 'added';
    const undoAll = () => {
      void (async () => {
        for (let i = reverts.length - 1; i >= 0; i--) {
          await Promise.resolve(reverts[i]()).catch(() => {});
        }
      })();
      markLedgerUndone(entry.id);
    };
    showToast({
      message:
        failed.length > 0
          ? `${done.length} of ${rows.length} ${verb} — ${listNames(failed.map(batchRowName))} was declined.`
          : done.length === 1
            ? `One change made.`
            : `${capitalizeFirst(countWord(done.length))} changes made.`,
      actionLabel: 'Undo',
      onAction: undoAll,
    });
    close();
  }

  async function execute(action: PendingAction, scope: RecurrenceScope = 'occurrence') {
    try {
      if (action.kind === 'create') {
        if (action.repeatWeekly) {
          const dayName = weekdayName(action.day.getDay());
          const rhythm = await createWeeklyRhythm({
            title: action.title,
            categoryId: action.categoryId,
            weekday: action.day.getDay(),
            startMin: action.startMin,
            endMin: action.endMin,
            sinceDay: action.day,
          });
          const entry = appendLedger(
            'create',
            `“${action.title}” now repeats every ${dayName} at ${fmtClock(action.startMin)}${
              rhythm.where === 'google' ? ' — a real series on Google Calendar' : ''
            }.`,
            rhythm.undo
          );
          showToast({
            message: `Added “${action.title}” — every ${dayName}.`,
            actionLabel: 'Undo',
            onAction: () => {
              void Promise.resolve(rhythm.revert()).catch(() => {});
              markLedgerUndone(entry.id);
            },
          });
        } else {
          const created = await createEvent({
            title: action.title,
            categoryId: action.categoryId,
            start: dateAtMinutes(action.day, action.startMin).toISOString(),
            end: dateAtMinutes(action.day, action.endMin).toISOString(),
          });
          const entry = appendLedger(
            'create',
            `Added “${action.title}” — ${fmtWhen(action.day, action.startMin, action.endMin)} — at your request.`,
            { kind: 'delete-created', eventId: created.id }
          );
          showToast({
            message: `Added “${action.title}”.`,
            actionLabel: 'Undo',
            onAction: () => {
              void deleteEvent(created.id);
              markLedgerUndone(entry.id);
            },
          });
        }
      } else if (action.kind === 'recur') {
        const { event } = action;
        const start = new Date(event.start);
        const dayName = weekdayName(start.getDay());
        const startMin = minutesOfDay(start);
        const restoreEvent = restorable(event);
        const rhythm = await createWeeklyRhythm({
          title: event.title,
          categoryId: event.categoryId,
          weekday: start.getDay(),
          startMin,
          endMin: minutesOfDay(new Date(event.end)),
          sinceDay: startOfDay(start),
          restoreEvent,
        });
        await deleteEvent(event.id);
        const entry = appendLedger(
          'create',
          `“${event.title}” now repeats every ${dayName} at ${fmtClock(startMin)}${
            rhythm.where === 'google' ? ' — a real series on Google Calendar' : ''
          }.`,
          rhythm.undo
        );
        showToast({
          message: `“${event.title}” now repeats every ${dayName}.`,
          actionLabel: 'Undo',
          onAction: () => {
            void Promise.resolve(rhythm.revert())
              .then(() => createEvent(restoreEvent))
              .catch(() => {});
            markLedgerUndone(entry.id);
          },
        });
      } else if (action.kind === 'move') {
        const { event, day, startMin, endMin } = action;
        if (event.recurring) {
          const dayName = eventDayName(event);
          const result =
            scope === 'template'
              ? await moveWholeTemplate(event, day, startMin, endMin)
              : await moveOccurrenceOnly(event, day, startMin, endMin, {
                  createEvent,
                  deleteEvent,
                });
          if (result) {
            const entry =
              scope === 'template'
                ? appendLedger(
                    'move',
                    `“${event.title}” now repeats every ${weekdayName(day.getDay())} at ${fmtClock(startMin)}.`,
                    result.undo
                  )
                : appendLedger(
                    'move',
                    `Moved “${event.title}” to ${fmtWhen(day, startMin, endMin)} — other weeks keep their place.`,
                    result.undo
                  );
            showToast({
              message:
                scope === 'template'
                  ? `Moved “${event.title}” — every week.`
                  : `Moved “${event.title}” — just this ${dayName}.`,
              actionLabel: 'Undo',
              onAction: () => {
                void result.revert();
                markLedgerUndone(entry.id);
              },
            });
          }
        } else {
          const prevStart = event.start;
          const prevEnd = event.end;
          await updateEvent(event.id, {
            start: dateAtMinutes(day, startMin).toISOString(),
            end: dateAtMinutes(day, endMin).toISOString(),
          });
          const entry = appendLedger(
            'move',
            `Moved “${event.title}” to ${fmtWhen(day, startMin, endMin)} at your request.`,
            { kind: 'restore-times', eventId: event.id, prevStart, prevEnd }
          );
          showToast({
            message: `Moved “${event.title}” to ${fmtClock(startMin)}.`,
            actionLabel: 'Undo',
            onAction: () => {
              void updateEvent(event.id, { start: prevStart, end: prevEnd });
              markLedgerUndone(entry.id);
            },
          });
        }
      } else {
        const { event } = action;
        if (event.recurring) {
          const dayName = eventDayName(event);
          const result =
            scope === 'template' ? await endSeries(event) : await skipOccurrence(event);
          if (result) {
            const entry =
              scope === 'template'
                ? appendLedger(
                    'cancel',
                    `“${event.title}” no longer repeats every ${dayName} — past weeks remain.`,
                    result.undo
                  )
                : appendLedger(
                    'cancel',
                    `Skipped “${event.title}” for ${fmtDay(new Date(event.start))} — the weekly rhythm continues.`,
                    result.undo
                  );
            showToast({
              message:
                scope === 'template'
                  ? `“${event.title}” no longer repeats.`
                  : `Skipped “${event.title}” this ${dayName}.`,
              actionLabel: 'Undo',
              onAction: () => {
                void result.revert();
                markLedgerUndone(entry.id);
              },
            });
          }
        } else {
          await deleteEvent(event.id);
          const entry = appendLedger(
            'cancel',
            `Cancelled “${event.title}” (${fmtEventWhen(event)}) at your request.`,
            { kind: 'restore-event', event: restorable(event) }
          );
          showToast({
            message: `Cancelled “${event.title}”.`,
            actionLabel: 'Undo',
            onAction: () => {
              void createEvent(restorable(event));
              markLedgerUndone(entry.id);
            },
          });
        }
      }
      seedCommitRef.current?.();
      seedCommitRef.current = null;
      close();
    } catch {
      appendLedger('error', 'A change could not be saved — the calendar is unchanged.');
      setMode({
        kind: 'message',
        text: 'Something slipped from my hands and the change was not saved. The calendar is as it was.',
      });
      clearPendingAction();
    }
  }

  function submit() {
    if (!intent) return;
    switch (intent.kind) {
      case 'navigate':
        if (intent.surface === 'dispatches') {
          window.dispatchEvent(new CustomEvent('hermes:dispatches'));
        } else {
          onNavigate(intent.day, intent.view);
        }
        close();
        break;
      case 'todo': {
        addTodo(intent.text);
        appendLedger('todo', `Captured a to-do: “${intent.text}”.`);
        showToast({ message: `Noted: “${intent.text}”.` });
        close();
        break;
      }
      case 'search': {
        const target = searchResults[highlight] ?? searchResults[0];
        if (target) {
          onNavigate(startOfDay(new Date(target.start)), null);
          close();
        }
        break;
      }
      case 'create': {
        const action: PendingAction = {
          kind: 'create',
          title: intent.title,
          categoryId: intent.categoryId,
          day: intent.day,
          startMin: intent.startMin,
          endMin: intent.endMin,
          repeatWeekly: intent.repeatWeekly,
        };
        stageConfirm(
          action,
          intent.repeatWeekly
            ? `Create “${intent.title}” — every ${weekdayName(intent.day.getDay())}, ${fmtRange(intent.startMin, intent.endMin)} · ${categoryById(intent.categoryId).label}`
            : `Create “${intent.title}” — ${fmtWhen(intent.day, intent.startMin, intent.endMin)}`
        );
        break;
      }
      case 'batch':
        stageBatchReview(intent.ops);
        break;
      case 'move':
      case 'cancel':
      case 'recur':
        runFind(intent);
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (mode.kind === 'input') close();
      else backToInput();
      return;
    }
    const listLength =
      mode.kind === 'choose'
        ? mode.candidates.length
        : mode.kind === 'input' && intent?.kind === 'search'
          ? searchResults.length
          : 0;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && listLength > 0) {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      setHighlight((h) => (h + delta + listLength) % listLength);
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (mode.kind === 'confirm') void execute(mode.action);
    else if (mode.kind === 'batch') {
      if (mode.batch.rows.every((row) => row.action !== null)) void executeBatch(mode.batch);
    } else if (mode.kind === 'choose') resolveTarget(mode.intent, mode.candidates[highlight]);
    else if (mode.kind === 'message') backToInput();
    else submit();
  }

  const hint = (() => {
    if (!intent || mode.kind !== 'input') return null;
    if (intent.kind === 'batch') {
      const ops = intent.ops;
      const first = ops[0];
      const destOf = (op: SingleIntent): string => {
        if (op.kind !== 'move') return '';
        const day = op.targetDay ? weekdayName(op.targetDay.getDay()) : '';
        let time = '';
        if (op.targetTime) {
          const t = op.targetTime;
          const h = Math.floor(t.startMin / 60);
          const pm =
            !t.startExplicit &&
            h >= 1 &&
            h <= 11 &&
            batchMeridian(t, op.raw.toLowerCase(), []) === 'pm';
          time = fmtAmPm(pm ? t.startMin + 12 * 60 : t.startMin);
        }
        const where = [day, time].filter(Boolean).join(' ');
        return where ? ` to ${where}` : '';
      };
      if (first.kind !== 'create' && first.matchAll) {
        return first.kind === 'move'
          ? `Move every ${first.query}${destOf(first)} — I will gather them for review.`
          : `Cancel every ${first.query} — I will gather them for review.`;
      }
      const names = ops.map((op) => (op.kind === 'create' ? op.title : op.query));
      const kinds = new Set(ops.map((op) => op.kind));
      const verb =
        kinds.size > 1 ? 'change' : first.kind === 'move' ? 'move' : first.kind === 'cancel' ? 'cancel' : 'add';
      return `${capitalizeFirst(countWord(ops.length))} changes: ${verb} ${listNames(names)}${destOf(first)}.`;
    }
    switch (intent.kind) {
      case 'create':
        return intent.repeatWeekly
          ? `Create “${intent.title}” — every ${weekdayName(intent.day.getDay())}, ${fmtRange(intent.startMin, intent.endMin)} · ${categoryById(intent.categoryId).label}`
          : `Create “${intent.title}” — ${fmtWhen(intent.day, intent.startMin, intent.endMin)} · ${categoryById(intent.categoryId).label}`;
      case 'move':
        return `Move ${intent.query || 'an event'}${intent.queryDay ? ` (${fmtDay(intent.queryDay)})` : ''}…`;
      case 'cancel':
        return `Cancel ${intent.query || 'an event'}${intent.queryDay ? ` (${fmtDay(intent.queryDay)})` : ''}…`;
      case 'recur':
        return `Make ${intent.query || 'an event'}${intent.queryDay ? ` (${fmtDay(intent.queryDay)})` : ''} repeat weekly…`;
      case 'navigate':
        return `Go to ${intent.label}`;
      case 'todo':
        return `Capture to-do: “${intent.text}”`;
      default:
        return null;
    }
  })();

  /** Recurring cancel/move confirms ask scope: "this friday" / "every friday". */
  const confirmScopes =
    mode.kind === 'confirm' &&
    (mode.action.kind === 'move' || mode.action.kind === 'cancel') &&
    mode.action.event.recurring
      ? eventDayName(mode.action.event)
      : null;

  return createPortal(
    <>
      <div className="palette-backdrop" onClick={close} aria-hidden="true" />
      <div
        className="palette"
        role="dialog"
        aria-modal="true"
        aria-label="Speak to Hermes"
        onKeyDown={handleKeyDown}
      >
        <div className="meander palette-meander" />
        <div className="palette-input-row">
          <span className="palette-sigil" aria-hidden="true">
            ⚚
          </span>
          <input
            ref={inputRef}
            type="text"
            value={text}
            placeholder="Speak to Hermes — add, move, cancel, find, go to…"
            onChange={(e) => {
              setText(e.target.value);
              if (mode.kind !== 'input') backToInput();
            }}
            aria-label="Command"
          />
        </div>

        {mode.kind === 'input' && (
          <div className="palette-body">
            {text.trim() === '' && (
              <>
                <div className="palette-section">Try telling Hermes</div>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="palette-row" onClick={() => setText(s)}>
                    <span className="palette-row-title">{s}</span>
                  </button>
                ))}
              </>
            )}
            {hint && (
              <button className="palette-row action" onClick={submit}>
                <span className="palette-row-title">{hint}</span>
                <kbd>⏎</kbd>
              </button>
            )}
            {intent?.kind === 'search' && text.trim().length > 0 && (
              <>
                {searchResults.map((ev, i) => (
                  <button
                    key={ev.id}
                    className={`palette-row ${categoryById(ev.categoryId).colorToken}${i === highlight ? ' highlighted' : ''}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => {
                      onNavigate(startOfDay(new Date(ev.start)), null);
                      close();
                    }}
                  >
                    <span className="cat-dot" />
                    <span className="palette-row-title">{ev.title}</span>
                    <span className="palette-row-when tnum">{fmtEventWhen(ev)}</span>
                  </button>
                ))}
                {searchResults.length === 0 && text.trim().length >= 2 && (
                  <div className="palette-voice">
                    Nothing on the calendar answers to that. Try another word, or ask me to add
                    it.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {mode.kind === 'choose' && (
          <div className="palette-body">
            <div className="palette-voice">
              You have {countWord(mode.candidates.length)} events matching “
              {mode.intent.query}” — which one?
            </div>
            {mode.candidates.map((ev, i) => (
              <button
                key={ev.id}
                className={`palette-row ${categoryById(ev.categoryId).colorToken}${i === highlight ? ' highlighted' : ''}`}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => resolveTarget(mode.intent, ev)}
              >
                <span className="cat-dot" />
                <span className="palette-row-title">{ev.title}</span>
                <span className="palette-row-when tnum">{fmtEventWhen(ev)}</span>
              </button>
            ))}
          </div>
        )}

        {mode.kind === 'confirm' && (
          <div className="palette-body">
            <div className="palette-confirm">
              <span className="palette-row-title">{mode.summary}</span>
              <div className="palette-confirm-actions">
                <button className="btn" onClick={backToInput}>
                  Back <kbd>esc</kbd>
                </button>
                {confirmScopes ? (
                  <>
                    <button
                      className="btn primary"
                      onClick={() => void execute(mode.action, 'occurrence')}
                    >
                      This {confirmScopes} <kbd>⏎</kbd>
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => void execute(mode.action, 'template')}
                    >
                      Every {confirmScopes}
                    </button>
                  </>
                ) : (
                  <button className="btn primary" onClick={() => void execute(mode.action)}>
                    Confirm <kbd>⏎</kbd>
                  </button>
                )}
              </div>
            </div>
            <div className="palette-note">A ghost of the change is on the grid behind me.</div>
          </div>
        )}

        {mode.kind === 'batch' &&
          (() => {
            const batch = mode.batch;
            const resolved = batch.rows.filter((row) => row.action !== null);
            const allResolved = resolved.length === batch.rows.length;
            const otherMeridianMin =
              batch.bareTime === null
                ? 0
                : batch.meridian === 'pm'
                  ? batch.bareTime.startMin
                  : batch.bareTime.startMin + 12 * 60;
            const shownMeridianMin =
              batch.bareTime === null
                ? 0
                : batch.meridian === 'pm'
                  ? batch.bareTime.startMin + 12 * 60
                  : batch.bareTime.startMin;
            return (
              <div className="palette-body">
                <div className="palette-voice">
                  {capitalizeFirst(countWord(batch.rows.length))}{' '}
                  {batch.rows.length === 1 ? 'change' : 'changes'} staged — each one shows as a
                  ghost on the grid. Drop or adjust any row, then confirm the lot.
                </div>
                {batch.bareTime && (
                  <div className="batch-meridian">
                    <span>
                      That time reads as <strong>{fmtAmPm(shownMeridianMin)}</strong>
                    </span>
                    <button className="batch-pill" onClick={() => flipBatchMeridian(batch)}>
                      use {fmtAmPm(otherMeridianMin)}
                    </button>
                  </div>
                )}
                {batch.rows.map((row) => {
                  const icon =
                    row.op.kind === 'create' ? '+' : row.op.kind === 'move' ? '→' : '⊘';
                  const colorToken = row.event
                    ? categoryById(row.event.categoryId).colorToken
                    : row.op.kind === 'create'
                      ? categoryById(row.op.categoryId).colorToken
                      : '';
                  const summary = (() => {
                    if (row.missing) return 'nothing matches';
                    if (!row.action) return 'which one?';
                    if (row.action.kind === 'move' && row.event)
                      return `${fmtEventFrom(row.event)} → ${fmtMoveTo(row.action.day, row.action.startMin)}`;
                    if (row.action.kind === 'cancel' && row.event)
                      return fmtEventFrom(row.event);
                    if (row.action.kind === 'create')
                      return fmtWhen(row.action.day, row.action.startMin, row.action.endMin);
                    return '';
                  })();
                  return (
                    <div key={row.key} className="batch-row-wrap">
                      <div className={`batch-row ${colorToken}${row.missing ? ' missing' : ''}`}>
                        <span className="batch-icon" aria-hidden="true">
                          {icon}
                        </span>
                        <span className="cat-dot" />
                        <span className="palette-row-title">{batchRowName(row)}</span>
                        <span className="palette-row-when tnum">{summary}</span>
                        {row.event?.recurring && (
                          <button
                            className={`batch-pill${row.scope === 'template' ? ' active' : ''}`}
                            onClick={() => flipBatchScope(batch, row.key)}
                            title="Toggle whether this reaches every week"
                          >
                            {row.scope === 'template' ? 'every week' : 'this day'}
                          </button>
                        )}
                        <button
                          className="batch-x"
                          onClick={() => dropBatchRow(batch, row.key)}
                          aria-label={`Drop ${batchRowName(row)} from the batch`}
                        >
                          ✕
                        </button>
                      </div>
                      {row.missing && (
                        <div className="batch-note">
                          Nothing on the calendar answers to “
                          {row.op.kind === 'create' ? row.op.title : row.op.query}” — drop this
                          row to continue.
                        </div>
                      )}
                      {row.candidates.length > 1 && (
                        <div className="batch-choose">
                          {row.candidates.map((ev) => (
                            <button
                              key={ev.id}
                              className={`palette-row ${categoryById(ev.categoryId).colorToken}`}
                              onClick={() => chooseBatchTarget(batch, row.key, ev)}
                            >
                              <span className="cat-dot" />
                              <span className="palette-row-title">{ev.title}</span>
                              <span className="palette-row-when tnum">{fmtEventWhen(ev)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div className="palette-confirm-actions">
                  <button className="btn" onClick={backToInput}>
                    Back <kbd>esc</kbd>
                  </button>
                  <button
                    className="btn primary"
                    disabled={!allResolved || resolved.length === 0}
                    onClick={() => void executeBatch(batch)}
                  >
                    Confirm {resolved.length} {resolved.length === 1 ? 'change' : 'changes'}{' '}
                    <kbd>⏎</kbd>
                  </button>
                </div>
                <div className="palette-note">
                  Ghosts of every change are on the grid behind me.
                </div>
              </div>
            );
          })()}

        {mode.kind === 'message' && (
          <div className="palette-body">
            <div className="palette-voice">{mode.text}</div>
            <div className="palette-confirm-actions">
              <button className="btn" onClick={backToInput}>
                Back <kbd>esc</kbd>
              </button>
            </div>
          </div>
        )}
      </div>
    </>,
    document.body
  );
}
