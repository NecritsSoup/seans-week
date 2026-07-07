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
import { categoryById } from '../state/categories';
import { useEventActions, useEvents } from '../state/EventsContext';
import { addTodo } from '../state/todos';
import type { CalendarEvent } from '../state/types';
import type { ViewMode } from '../stage/Stage';
import { useToast } from '../ui';
import { findEventsByQuery } from './intents/findEvent';
import { parseCommand, resolveMoveTimes } from './intents/parse';
import type { CancelIntent, MoveIntent } from './intents/types';
import { appendLedger, markLedgerUndone } from './ledgerStore';
import { clearPendingAction, setPendingAction, type PendingAction } from './pending';

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
}

type PaletteMode =
  | { kind: 'input' }
  | { kind: 'choose'; intent: MoveIntent | CancelIntent; candidates: CalendarEvent[] }
  | { kind: 'confirm'; action: PendingAction; summary: string }
  | { kind: 'message'; text: string };

const SUGGESTIONS = [
  'add gym friday 8am',
  'move friday’s gym to 9am',
  'cancel dinner thursday',
  'todo: email advisor',
  'next week',
];

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
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
export function Palette({ open, onClose, onNavigate, seed = null }: PaletteProps) {
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

  const intent = useMemo(() => parseCommand(text), [text]);
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

  useEffect(() => {
    if (mode.kind === 'input') inputRef.current?.focus();
  }, [mode.kind]);

  useEffect(() => setHighlight(0), [text]);

  // A seeded action skips straight to the confirm step, ghost and all.
  useEffect(() => {
    if (!open || !seed) return;
    const { action, summary, onCommit } = seed;
    seedCommitRef.current = onCommit ?? null;
    setPendingAction(action);
    const day = action.kind === 'cancel' ? startOfDay(new Date(action.event.start)) : action.day;
    onNavigate(day, null);
    setMode({ kind: 'confirm', action, summary });
  }, [open, seed, onNavigate]);

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
    const day =
      action.kind === 'cancel' ? startOfDay(new Date(action.event.start)) : action.day;
    onNavigate(day, null);
    setMode({ kind: 'confirm', action, summary });
  }

  function resolveTarget(intent: MoveIntent | CancelIntent, event: CalendarEvent) {
    if (intent.kind === 'cancel') {
      stageConfirm(
        { kind: 'cancel', event },
        `Cancel “${event.title}” — ${fmtEventWhen(event)}`
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
      `Move “${event.title}” to ${fmtWhen(day, startMin, endMin)}`
    );
  }

  function runFind(intent: MoveIntent | CancelIntent) {
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

  async function execute(action: PendingAction) {
    try {
      if (action.kind === 'create') {
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
      } else if (action.kind === 'move') {
        const { event, day, startMin, endMin } = action;
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
      } else {
        const { event } = action;
        await deleteEvent(event.id);
        const entry = appendLedger(
          'cancel',
          `Cancelled “${event.title}” (${fmtEventWhen(event)}) at your request.`,
          {
            kind: 'restore-event',
            event: {
              id: event.id,
              title: event.title,
              start: event.start,
              end: event.end,
              categoryId: event.categoryId,
              allDay: event.allDay,
            },
          }
        );
        showToast({
          message: `Cancelled “${event.title}”.`,
          actionLabel: 'Undo',
          onAction: () => {
            void createEvent({
              id: event.id,
              title: event.title,
              start: event.start,
              end: event.end,
              categoryId: event.categoryId,
              allDay: event.allDay,
            });
            markLedgerUndone(entry.id);
          },
        });
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
        onNavigate(intent.day, intent.view);
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
        };
        stageConfirm(
          action,
          `Create “${intent.title}” — ${fmtWhen(intent.day, intent.startMin, intent.endMin)}`
        );
        break;
      }
      case 'move':
      case 'cancel':
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
    else if (mode.kind === 'choose') resolveTarget(mode.intent, mode.candidates[highlight]);
    else if (mode.kind === 'message') backToInput();
    else submit();
  }

  const hint = (() => {
    if (!intent || mode.kind !== 'input') return null;
    switch (intent.kind) {
      case 'create':
        return `Create “${intent.title}” — ${fmtWhen(intent.day, intent.startMin, intent.endMin)} · ${categoryById(intent.categoryId).label}`;
      case 'move':
        return `Move ${intent.query || 'an event'}${intent.queryDay ? ` (${fmtDay(intent.queryDay)})` : ''}…`;
      case 'cancel':
        return `Cancel ${intent.query || 'an event'}${intent.queryDay ? ` (${fmtDay(intent.queryDay)})` : ''}…`;
      case 'navigate':
        return `Go to ${intent.label}`;
      case 'todo':
        return `Capture to-do: “${intent.text}”`;
      default:
        return null;
    }
  })();

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
                <button className="btn primary" onClick={() => void execute(mode.action)}>
                  Confirm <kbd>⏎</kbd>
                </button>
              </div>
            </div>
            <div className="palette-note">A ghost of the change is on the grid behind me.</div>
          </div>
        )}

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
