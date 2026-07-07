import { useEffect, useMemo, useRef, useState } from 'react';
import { signIn, useGoogleAuth } from '../google/auth';
import { HERMES_ART, type HermesStyle } from '../hermes/art';
import { categoryFor } from '../hermes/intents/parse';
import { appendLedger, markLedgerUndone, useLedger } from '../hermes/ledgerStore';
import type { PaletteSeed } from '../hermes/Palette';
import type { PendingAction } from '../hermes/pending';
import { HABIT_LABELS } from '../hermes/streaks';
import type {
  ScrollSuggestion,
  StreakSuggestion,
  Suggestion,
  SuggestionKind,
  TodoSuggestion,
} from '../hermes/suggest';
import {
  dismissSuggestion,
  markSuggestionHandled,
  refreshSuggestions,
  useSuggestions,
} from '../hermes/suggestStore';
import { useLedgerUndo } from '../hermes/useLedgerUndo';
import { addDays, fmtClock, fmtRange, minutesOfDay, startOfDay } from '../lib/time';
import {
  dismissScroll,
  refreshScrolls,
  useScrolls,
  useScrollsStatus,
  type Scroll,
} from '../scrolls/scrollsStore';
import { categoryById } from '../state/categories';
import { useEvents } from '../state/EventsContext';
import { createTemplate, deleteTemplate, parseDateKey, weekdayName } from '../state/recurrence';
import { addTodo, toggleTodo, useTodos } from '../state/todos';
import type { CalendarEvent } from '../state/types';
import type { ViewMode } from '../stage/Stage';
import { useTheme, type ThemeName } from '../theme/theme';
import { Panel, useToast } from '../ui';

interface DispatchesPanelProps {
  open: boolean;
  onClose: () => void;
  /** Moves the Stage: a day to anchor on and/or a view to switch to. */
  onNavigate: (day: Date | null, view: ViewMode | null) => void;
}

type Lane = 'scrolls' | 'suggestions' | 'upenn';

const LANE_LABELS: Record<Lane, string> = {
  scrolls: 'Scrolls',
  suggestions: 'Suggestions',
  upenn: 'UPenn',
};

const STYLE_FOR_THEME: Record<ThemeName, HermesStyle> = {
  vase: 'vase',
  fresco: 'fresco',
  amphora: 'amphora',
  nyx: 'vase',
};

const KIND_HEADINGS: Record<Scroll['kind'], string> = {
  meeting: 'Meetings & reports',
  penn: 'From Penn',
};

const SUGGESTION_ICONS: Record<SuggestionKind, string> = {
  pattern: '↻',
  streak: '❧',
  todo: '✎',
  scroll: '✉',
};

const ACCEPT_LABELS: Record<SuggestionKind, string> = {
  pattern: 'Make it weekly',
  streak: 'Add it',
  todo: 'Schedule',
  scroll: 'Schedule',
};

/** How far back the pattern scan reaches / ahead the UPenn lane looks. */
const LOOKBACK_DAYS = 42;
const LOOKAHEAD_DAYS = 15;

/** Card entrance stagger, capped so long lists don't crawl. */
const STAGGER_MS = 45;
const STAGGER_CAP = 8;

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];

function countWord(n: number): string {
  return n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n);
}

/** "just now", "5h ago", "3d ago" — ports the legacy relTime. */
function relTime(ms: number): string {
  const hrs = Math.round((Date.now() - ms) / 3_600_000);
  if (hrs < 1) return 'just now';
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function fmtDay(day: Date): string {
  return day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** Tomorrow, 9:00–10:00 — the suggested slot for a scheduled scroll. */
function suggestedSlot() {
  return { day: addDays(startOfDay(new Date()), 1), startMin: 9 * 60, endMin: 10 * 60 };
}

function staggerStyle(index: number): React.CSSProperties {
  return { animationDelay: `${Math.min(index, STAGGER_CAP) * STAGGER_MS}ms` };
}

/** One line in Hermes's voice, name used sparingly — two sentences at most. */
function greetingText(scrollCount: number, suggestionCount: number): string {
  const total = scrollCount + suggestionCount;
  if (total === 0) return 'The roads are quiet — nothing needs your seal.';
  const head =
    total === 1 ? 'One dispatch awaits, Sean.' : `${countWord(total)} dispatches await, Sean.`;
  if (suggestionCount === 0) return head;
  const tail =
    suggestionCount === 1
      ? 'One is a thought of my own.'
      : `${countWord(suggestionCount)} are thoughts of my own.`;
  return suggestionCount === total ? `${head} All thoughts of my own.` : `${head} ${tail}`;
}

/**
 * Hermes's Dispatches: the one summoned place where everything he carries
 * or proposes lands — email scrolls, his own suggestions, and Penn matters
 * — each transparent, each reversible. Replaces the old Scrolls panel as
 * the `I` surface.
 */
export function DispatchesPanel({ open, onClose, onNavigate }: DispatchesPanelProps) {
  const auth = useGoogleAuth();
  const scrolls = useScrolls();
  const scrollsStatus = useScrollsStatus();
  const suggestions = useSuggestions();
  const todos = useTodos();
  const ledger = useLedger();
  const theme = useTheme();
  const { showToast } = useToast();
  const performUndo = useLedgerUndo();

  const [lane, setLane] = useState<Lane>('scrolls');
  const [leaving, setLeaving] = useState<string[]>([]);
  const [acceptedId, setAcceptedId] = useState<string | null>(null);
  const [todoText, setTodoText] = useState('');

  // Enough history for the pattern scan, enough future for the UPenn lane.
  const [rangeStart] = useState(() => addDays(startOfDay(new Date()), -LOOKBACK_DAYS));
  const [rangeEnd] = useState(() => addDays(startOfDay(new Date()), LOOKAHEAD_DAYS));
  const events = useEvents(rangeStart, rangeEnd);
  const eventsRef = useRef<CalendarEvent[]>(events);
  eventsRef.current = events;

  // Recompute whenever the evidence changes (events, to-dos, scrolls)…
  useEffect(() => {
    refreshSuggestions(events, { force: true });
  }, [events, todos, scrolls]);

  // …and lazily on open: a fresh look at the scrolls, a TTL-gated pass here.
  useEffect(() => {
    if (!open) return;
    if (auth.status === 'signed-in') void refreshScrolls();
    refreshSuggestions(eventsRef.current);
  }, [open, auth.status]);

  const art = HERMES_ART[STYLE_FOR_THEME[theme]];
  const pendingTodos = useMemo(() => todos.filter((t) => !t.done), [todos]);
  const pennScrolls = useMemo(() => scrolls.filter((s) => s.kind === 'penn'), [scrolls]);
  const upennEvents = useMemo(() => {
    const todayMs = startOfDay(new Date()).getTime();
    return events
      .filter((ev) => ev.categoryId === 'upenn' && new Date(ev.start).getTime() >= todayMs)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events]);
  const handledEntries = useMemo(
    () => ledger.filter((e) => e.type === 'suggest' || e.type === 'scroll').slice(0, 5),
    [ledger]
  );

  const laneCounts: Record<Lane, number> = {
    scrolls: scrolls.length,
    suggestions: suggestions.length,
    upenn: pendingTodos.length + upennEvents.length + pennScrolls.length,
  };

  /* -------------------------------------------------------- scroll actions ---- */

  function slideOut(id: string, after: () => void) {
    setLeaving((ids) => [...ids, id]);
    window.setTimeout(() => {
      after();
      setLeaving((ids) => ids.filter((left) => left !== id));
    }, 230);
  }

  function makeTodo(scroll: Scroll) {
    slideOut(scroll.id, () => {
      addTodo(scroll.subject);
      dismissScroll(scroll.id);
      appendLedger('scroll', `Turned a scroll into a to-do: “${scroll.subject}”.`);
      showToast({ message: `Noted: “${scroll.subject}”.` });
    });
  }

  function scheduleScroll(scroll: Scroll) {
    const { day, startMin, endMin } = suggestedSlot();
    const action: PendingAction = {
      kind: 'create',
      title: scroll.subject,
      categoryId: categoryFor(scroll.subject) ?? (scroll.kind === 'penn' ? 'upenn' : 'work'),
      day,
      startMin,
      endMin,
    };
    const seed: PaletteSeed = {
      action,
      summary: `Schedule “${scroll.subject}” — tomorrow, ${fmtRange(startMin, endMin)}`,
      onCommit: () => {
        dismissScroll(scroll.id);
        appendLedger('scroll', `Scheduled a scroll onto the calendar: “${scroll.subject}”.`);
      },
    };
    onClose();
    window.dispatchEvent(new CustomEvent<PaletteSeed>('hermes:palette', { detail: seed }));
  }

  /* ---------------------------------------------------- suggestion actions ---- */

  function dismiss(suggestion: Suggestion) {
    slideOut(suggestion.id, () => dismissSuggestion(suggestion.id));
  }

  function accept(suggestion: Suggestion) {
    if (suggestion.kind === 'pattern') {
      const dayName = weekdayName(suggestion.weekday);
      const template = createTemplate({
        title: suggestion.eventTitle,
        categoryId: suggestion.categoryId,
        weekday: suggestion.weekday,
        startMin: suggestion.startMin,
        endMin: suggestion.endMin,
      });
      const entry = appendLedger(
        'suggest',
        `Noticed the rhythm and made “${suggestion.eventTitle}” weekly — every ${dayName} at ${fmtClock(suggestion.startMin)}.`,
        { kind: 'remove-template', templateId: template.id }
      );
      showToast({
        message: `“${suggestion.eventTitle}” — every ${dayName} now.`,
        actionLabel: 'Undo',
        onAction: () => {
          deleteTemplate(template.id);
          markLedgerUndone(entry.id);
        },
      });
      // Let the gold flash land before the card goes.
      setAcceptedId(suggestion.id);
      window.setTimeout(() => {
        setAcceptedId((id) => (id === suggestion.id ? null : id));
        markSuggestionHandled(suggestion.id);
      }, 360);
      return;
    }
    acceptSeeded(suggestion);
  }

  /** Streak/todo/scroll accepts stage the palette's ghost-and-confirm flow. */
  function acceptSeeded(suggestion: StreakSuggestion | TodoSuggestion | ScrollSuggestion) {
    const day = parseDateKey(suggestion.dayKey);
    const title =
      suggestion.kind === 'todo'
        ? suggestion.text
        : suggestion.kind === 'scroll'
          ? suggestion.subject
          : suggestion.eventTitle;
    const action: PendingAction = {
      kind: 'create',
      title,
      categoryId: suggestion.categoryId,
      day,
      startMin: suggestion.startMin,
      endMin: suggestion.endMin,
    };
    const seed: PaletteSeed = {
      action,
      summary: `Schedule “${title}” — ${fmtDay(day)}, ${fmtRange(suggestion.startMin, suggestion.endMin)}`,
      onCommit: () => {
        markSuggestionHandled(suggestion.id);
        if (suggestion.kind === 'todo') {
          toggleTodo(suggestion.todoId);
          appendLedger('suggest', `Scheduled “${suggestion.text}” and checked it off the list.`);
        } else if (suggestion.kind === 'scroll') {
          dismissScroll(suggestion.scrollId);
          appendLedger('suggest', `Followed up the Penn scroll “${suggestion.subject}” with an hour on the calendar.`);
        } else {
          appendLedger(
            'suggest',
            `Kept the ${HABIT_LABELS[suggestion.habit].toLowerCase()} streak alive — placed “${title}”.`
          );
        }
      },
    };
    onClose();
    window.dispatchEvent(new CustomEvent<PaletteSeed>('hermes:palette', { detail: seed }));
  }

  /* ------------------------------------------------------------ upenn lane ---- */

  function submitTodo(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = todoText.trim();
    if (!trimmed) return;
    addTodo(trimmed);
    appendLedger('todo', `Captured a to-do: “${trimmed}”.`);
    setTodoText('');
  }

  function goToEvent(ev: CalendarEvent) {
    onNavigate(startOfDay(new Date(ev.start)), null);
    onClose();
  }

  function openLedger() {
    onClose();
    window.dispatchEvent(new CustomEvent('hermes:ledger'));
  }

  /* --------------------------------------------------------------- pieces ---- */

  function scrollCard(scroll: Scroll, index: number) {
    return (
      <article
        key={scroll.id}
        className={`dispatch-card${leaving.includes(scroll.id) ? ' leaving' : ''}`}
        style={staggerStyle(index)}
      >
        <div className="dispatch-card-head">
          <span className="dispatch-icon" aria-hidden="true">
            ✉
          </span>
          <span className="dispatch-title">{scroll.subject}</span>
          <span className="dispatch-meta tnum">{relTime(new Date(scroll.date).getTime())}</span>
        </div>
        <div className="dispatch-because">{scroll.from}</div>
        <div className="dispatch-actions">
          <button
            className="btn small"
            onClick={() => slideOut(scroll.id, () => dismissScroll(scroll.id))}
          >
            Dismiss
          </button>
          <button className="btn small" onClick={() => makeTodo(scroll)}>
            Make to-do
          </button>
          <button className="btn small primary" onClick={() => scheduleScroll(scroll)}>
            Schedule
          </button>
        </div>
      </article>
    );
  }

  function suggestionCard(suggestion: Suggestion, index: number) {
    const classes = [
      'dispatch-card',
      leaving.includes(suggestion.id) ? 'leaving' : '',
      acceptedId === suggestion.id ? 'accepted' : '',
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <article key={suggestion.id} className={classes} style={staggerStyle(index)}>
        <div className="dispatch-card-head">
          <span className="dispatch-icon" aria-hidden="true">
            {SUGGESTION_ICONS[suggestion.kind]}
          </span>
          <span className="dispatch-title">{suggestion.title}</span>
          <span className="dispatch-meta tnum">{suggestion.meta}</span>
        </div>
        <div className="dispatch-because">{suggestion.because}</div>
        <div className="dispatch-actions">
          <button className="btn small" onClick={() => dismiss(suggestion)}>
            Dismiss
          </button>
          <button className="btn small primary" onClick={() => accept(suggestion)}>
            {ACCEPT_LABELS[suggestion.kind]}
          </button>
        </div>
      </article>
    );
  }

  const scrollsLane = (
    <>
      {auth.status !== 'signed-in' ? (
        <div className="scrolls-empty">
          <p>
            Hermes carries word from your inbox — meeting notes, reports, and anything new from
            Penn — but he needs the seal broken first.
          </p>
          <button
            className="btn primary"
            onClick={() => void signIn()}
            disabled={auth.status === 'connecting'}
          >
            {auth.status === 'connecting' ? 'Connecting…' : 'Sign in with Google'}
          </button>
        </div>
      ) : (
        <>
          {scrollsStatus === 'loading' && scrolls.length === 0 && (
            <div className="scrolls-loading" aria-label="Checking for scrolls">
              <div className="scroll-skeleton" />
              <div className="scroll-skeleton" />
              <div className="scroll-skeleton" />
            </div>
          )}
          {scrollsStatus === 'error' && (
            <p className="scrolls-note">
              The scrolls could not be fetched just now — Hermes will try again shortly.
            </p>
          )}
          {scrollsStatus === 'ready' && scrolls.length === 0 && (
            <p className="scrolls-note">No scrolls today — the roads are quiet.</p>
          )}
          {(['meeting', 'penn'] as const).map((kind) => {
            const rows = scrolls.filter((s) => s.kind === kind);
            if (rows.length === 0) return null;
            return (
              <section key={kind} className="dispatch-section">
                <h3 className="scrolls-heading">{KIND_HEADINGS[kind]}</h3>
                {rows.map((scroll, i) => scrollCard(scroll, i))}
              </section>
            );
          })}
        </>
      )}
    </>
  );

  const suggestionsLane = (
    <>
      {suggestions.length === 0 ? (
        <p className="scrolls-note">Nothing to propose — your rhythm keeps itself.</p>
      ) : (
        suggestions.map((s, i) => suggestionCard(s, i))
      )}
      {handledEntries.length > 0 && (
        <details className="dispatch-handled">
          <summary>Recently handled</summary>
          {handledEntries.map((entry) => (
            <div key={entry.id} className="ledger-entry">
              <span className="ledger-time tnum">{relTime(entry.t)}</span>
              <span className="ledger-text">
                {entry.text}
                {entry.undone && <em className="ledger-undone"> (undone)</em>}
              </span>
              {entry.undo && !entry.undone && (
                <button className="ledger-undo" onClick={() => void performUndo(entry)}>
                  Undo
                </button>
              )}
            </div>
          ))}
          <button className="hermes-link" onClick={openLedger}>
            See all in the Ledger <kbd>L</kbd>
          </button>
        </details>
      )}
    </>
  );

  const upennLane = (
    <>
      <section className="dispatch-section">
        <h3 className="scrolls-heading">Owed</h3>
        <form className="todo-add" onSubmit={submitTodo}>
          <input
            type="text"
            value={todoText}
            placeholder="Add a Penn to-do…"
            onChange={(e) => setTodoText(e.target.value)}
            aria-label="New Penn to-do"
          />
          <button className="btn primary" type="submit">
            Add
          </button>
        </form>
        {pendingTodos.length === 0 ? (
          <p className="scrolls-note">Nothing owed. A rare and enviable state.</p>
        ) : (
          <ul className="todo-list">
            {pendingTodos.map((todo, i) => (
              <li key={todo.id} className="todo-row dispatch-row" style={staggerStyle(i)}>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => toggleTodo(todo.id)}
                  aria-label={`Mark “${todo.text}” done`}
                />
                <span className="todo-text">{todo.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="dispatch-section">
        <h3 className="scrolls-heading">On the calendar — next two weeks</h3>
        {upennEvents.length === 0 ? (
          <p className="scrolls-note">No Penn hours ahead — the quad is calm.</p>
        ) : (
          upennEvents.map((ev, i) => {
            const start = new Date(ev.start);
            return (
              <button
                key={ev.id}
                className={`upenn-event dispatch-row ${categoryById(ev.categoryId).colorToken}`}
                style={staggerStyle(i)}
                onClick={() => goToEvent(ev)}
              >
                <span className="cat-dot" aria-hidden="true" />
                <span className="upenn-event-title">{ev.title}</span>
                <span className="upenn-event-when tnum">
                  {fmtDay(start)} · {fmtClock(minutesOfDay(start))}
                </span>
              </button>
            );
          })
        )}
      </section>

      <section className="dispatch-section">
        <h3 className="scrolls-heading">From Penn</h3>
        {auth.status !== 'signed-in' ? (
          <p className="scrolls-note">Sign in on the Scrolls lane and Penn's letters land here.</p>
        ) : pennScrolls.length === 0 ? (
          <p className="scrolls-note">No word from Penn — enjoy the quiet.</p>
        ) : (
          pennScrolls.map((scroll, i) => scrollCard(scroll, i))
        )}
      </section>
    </>
  );

  return (
    <Panel open={open} onClose={onClose} title="Dispatches" width={560}>
      <div className="dispatch-head">
        <img className="dispatch-seal" src={art.icon} alt="" />
        <p className="dispatch-greeting">{greetingText(scrolls.length, suggestions.length)}</p>
      </div>

      <div className="dispatch-tabs" role="tablist" aria-label="Dispatch lanes">
        {(Object.keys(LANE_LABELS) as Lane[]).map((id) => (
          <button
            key={id}
            role="tab"
            aria-selected={lane === id}
            className={`dispatch-tab${lane === id ? ' active' : ''}`}
            onClick={() => setLane(id)}
          >
            {LANE_LABELS[id]}
            {laneCounts[id] > 0 && (
              <span className="dispatch-tab-count tnum">{laneCounts[id]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="dispatch-lane" key={lane} role="tabpanel" aria-label={LANE_LABELS[lane]}>
        {lane === 'scrolls' && scrollsLane}
        {lane === 'suggestions' && suggestionsLane}
        {lane === 'upenn' && upennLane}
      </div>
    </Panel>
  );
}
