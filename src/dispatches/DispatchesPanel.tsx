import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
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
  TodoSuggestion,
} from '../hermes/suggest';
import {
  dismissSuggestion,
  getSuggestionsComputedAt,
  markSuggestionHandled,
  refreshSuggestions,
  subscribeSuggestions,
  useSuggestions,
} from '../hermes/suggestStore';
import { useLedgerUndo } from '../hermes/useLedgerUndo';
import { addDays, fmtClock, fmtRange, minutesOfDay, relTime, startOfDay } from '../lib/time';
import {
  dismissScroll,
  getScrollsRefreshedAt,
  refreshScrolls,
  subscribeScrolls,
  useScrolls,
  useScrollsStatus,
  type Scroll,
} from '../scrolls/scrollsStore';
import { categoryById } from '../state/categories';
import { useEvents } from '../state/EventsContext';
import { parseDateKey, weekdayName } from '../state/recurrence';
import { createWeeklyRhythm } from '../state/recurringOps';
import { addTodo, toggleTodo, useTodos } from '../state/todos';
import type { CalendarEvent } from '../state/types';
import type { ViewMode } from '../stage/Stage';
import { useTheme, type ThemeName } from '../theme/theme';
import { Panel, useToast } from '../ui';
import { GhostCard } from './GhostCard';
import { markDispatchesIntroduced } from './introStore';
import { ScrollCard } from './ScrollCard';
import { SuggestionCard } from './SuggestionCard';

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

/** "refreshed just now" / "refreshed 4m ago" — the live freshness caption. */
function refreshedLabel(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  if (mins < 1) return 'refreshed just now';
  if (mins < 60) return `refreshed ${mins}m ago`;
  return `refreshed ${Math.floor(mins / 60)}h ago`;
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
  // Opening through any door also counts as meeting the hub (coach mark).
  useEffect(() => {
    if (!open) return;
    markDispatchesIntroduced();
    if (auth.status === 'signed-in') void refreshScrolls();
    refreshSuggestions(eventsRef.current);
  }, [open, auth.status]);

  // The freshness caption: last successful fetch / suggestion pass, re-read
  // every half minute while the panel is open so "just now" ages honestly.
  const scrollsRefreshedAt = useSyncExternalStore(subscribeScrolls, getScrollsRefreshedAt);
  const suggestionsComputedAt = useSyncExternalStore(
    subscribeSuggestions,
    getSuggestionsComputedAt
  );
  const refreshedAt = Math.max(scrollsRefreshedAt, suggestionsComputedAt);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [open]);

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

  /* ------------------------------------------------- roving card focus ---- */

  // One card per lane holds tabindex 0; ArrowUp/Down walk the list.
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const [rovingId, setRovingId] = useState<string | null>(null);
  useEffect(() => setRovingId(null), [lane]);

  const laneCardIds = useMemo(() => {
    if (lane === 'scrolls')
      return [
        ...scrolls.filter((s) => s.kind === 'meeting'),
        ...scrolls.filter((s) => s.kind === 'penn'),
      ].map((s) => s.id);
    if (lane === 'suggestions') return suggestions.map((s) => s.id);
    return pennScrolls.map((s) => s.id);
  }, [lane, scrolls, suggestions, pennScrolls]);

  const activeCardId =
    rovingId && laneCardIds.includes(rovingId) ? rovingId : (laneCardIds[0] ?? null);

  function registerCard(id: string) {
    return (el: HTMLElement | null) => {
      if (el) cardRefs.current.set(id, el);
      else cardRefs.current.delete(id);
    };
  }

  function moveFocus(fromId: string, delta: number) {
    const idx = laneCardIds.indexOf(fromId);
    if (idx === -1 || laneCardIds.length === 0) return;
    const next = laneCardIds[(idx + delta + laneCardIds.length) % laneCardIds.length];
    setRovingId(next);
    cardRefs.current.get(next)?.focus();
  }

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
      // Signed in this becomes a real Google series; signed out, a template.
      void createWeeklyRhythm({
        title: suggestion.eventTitle,
        categoryId: suggestion.categoryId,
        weekday: suggestion.weekday,
        startMin: suggestion.startMin,
        endMin: suggestion.endMin,
      })
        .then((rhythm) => {
          const entry = appendLedger(
            'suggest',
            `Noticed the rhythm and made “${suggestion.eventTitle}” weekly — every ${dayName} at ${fmtClock(suggestion.startMin)}${
              rhythm.where === 'google' ? ', on Google Calendar' : ''
            }.`,
            rhythm.undo
          );
          showToast({
            message: `“${suggestion.eventTitle}” — every ${dayName} now.`,
            actionLabel: 'Undo',
            onAction: () => {
              void Promise.resolve(rhythm.revert()).catch(() => {});
              markLedgerUndone(entry.id);
            },
          });
        })
        .catch(() => {
          // Google declined the series — the store already spoke up.
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
      <ScrollCard
        key={scroll.id}
        scroll={scroll}
        entranceStyle={staggerStyle(index)}
        leaving={leaving.includes(scroll.id)}
        tabIndex={scroll.id === activeCardId ? 0 : -1}
        registerRef={registerCard(scroll.id)}
        onFocusCard={() => setRovingId(scroll.id)}
        onArrow={(delta) => moveFocus(scroll.id, delta)}
        onDismiss={() => slideOut(scroll.id, () => dismissScroll(scroll.id))}
        onSwipeDismiss={() => dismissScroll(scroll.id)}
        onMakeTodo={() => makeTodo(scroll)}
        onSchedule={() => scheduleScroll(scroll)}
      />
    );
  }

  function suggestionCard(suggestion: Suggestion, index: number) {
    return (
      <SuggestionCard
        key={suggestion.id}
        suggestion={suggestion}
        entranceStyle={staggerStyle(index)}
        leaving={leaving.includes(suggestion.id)}
        accepted={acceptedId === suggestion.id}
        tabIndex={suggestion.id === activeCardId ? 0 : -1}
        registerRef={registerCard(suggestion.id)}
        onFocusCard={() => setRovingId(suggestion.id)}
        onArrow={(delta) => moveFocus(suggestion.id, delta)}
        onDismiss={() => dismiss(suggestion)}
        onSwipeDismiss={() => dismissSuggestion(suggestion.id)}
        onAccept={() => accept(suggestion)}
      />
    );
  }

  const scrollsLane = (
    <>
      {auth.status !== 'signed-in' ? (
        <div className="scrolls-empty">
          {/* Ghosted examples: the shape of the lane before the seal breaks. */}
          <div className="ghost-stack">
            <GhostCard
              icon="✉"
              title="Advance registration opens Monday"
              meta="2h ago"
              because="Registrar, UPenn"
              actions={[
                { label: 'Dismiss' },
                { label: 'Make to-do' },
                { label: 'Schedule', primary: true },
              ]}
            />
            <GhostCard
              icon="✉"
              title="Notes from Tuesday’s project sync"
              meta="1d ago"
              because="Read.ai"
              actions={[
                { label: 'Dismiss' },
                { label: 'Make to-do' },
                { label: 'Schedule', primary: true },
              ]}
            />
            <GhostCard
              icon="✉"
              title="Fall workshop calendar posted"
              meta="3d ago"
              because="Weingarten Center, UPenn"
              actions={[
                { label: 'Dismiss' },
                { label: 'Make to-do' },
                { label: 'Schedule', primary: true },
              ]}
            />
          </div>
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
            <>
              <p className="scrolls-note">No scrolls today — the roads are quiet.</p>
              <GhostCard
                icon="✉"
                title="Advance registration opens Monday"
                meta="2h ago"
                because="Registrar, UPenn"
                actions={[
                  { label: 'Dismiss' },
                  { label: 'Make to-do' },
                  { label: 'Schedule', primary: true },
                ]}
              />
              <p className="scrolls-note">
                When word arrives — meeting notes, reports, Penn letters — it lands here looking
                like this.
              </p>
            </>
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
        <>
          <p className="scrolls-note">Nothing to propose — your rhythm keeps itself.</p>
          <div className="ghost-stack">
            <GhostCard
              icon="↻"
              title="Make “Coffee with Dana” weekly"
              meta="Every Tuesday, 9:00 – 10:00"
              because="You’ve had “Coffee with Dana” on Tuesdays three weeks running."
              actions={[{ label: 'Dismiss' }, { label: 'Make it weekly', primary: true }]}
            />
            <GhostCard
              icon="❧"
              title="Keep the reading streak"
              meta="Thursday, 20:00 – 21:00"
              because="Your reading streak is five days — nothing on the calendar this week yet."
              actions={[{ label: 'Dismiss' }, { label: 'Add it', primary: true }]}
            />
          </div>
          <p className="scrolls-note">
            Hermes watches your last six weeks for rhythms worth keeping.
          </p>
        </>
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
          <>
            <p className="scrolls-note">Nothing owed. A rare and enviable state.</p>
            <div className="ghost-row" aria-hidden="true">
              <input type="checkbox" disabled tabIndex={-1} />
              <span className="todo-text">Email Dr. Alvarez about the seminar paper</span>
              <span className="ghost-flag inline">Example</span>
            </div>
          </>
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
          <>
            <p className="scrolls-note">No Penn hours ahead — the quad is calm.</p>
            <div className="ghost-row cat-upenn" aria-hidden="true">
              <span className="cat-dot" />
              <span className="upenn-event-title">STAT 4300 office hours</span>
              <span className="upenn-event-when tnum">Wed · 14:00</span>
              <span className="ghost-flag inline">Example</span>
            </div>
          </>
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
        {auth.status !== 'signed-in' || pennScrolls.length === 0 ? (
          <>
            <div className="ghost-row" aria-hidden="true">
              <span className="dispatch-icon">✉</span>
              <span className="upenn-event-title">Move-out inspection windows posted</span>
              <span className="upenn-event-when">College Houses</span>
              <span className="ghost-flag inline">Example</span>
            </div>
            <p className="scrolls-note">
              {auth.status !== 'signed-in'
                ? "Sign in on the Scrolls lane and Penn's letters land here."
                : 'No word from Penn — enjoy the quiet.'}
            </p>
          </>
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
        <div className="dispatch-head-words">
          <p className="dispatch-greeting">{greetingText(scrolls.length, suggestions.length)}</p>
          {refreshedAt > 0 && (
            <p className="dispatch-refreshed tnum">{refreshedLabel(refreshedAt)}</p>
          )}
        </div>
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
