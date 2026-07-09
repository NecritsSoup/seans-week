import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  TOTAL_MIN,
  addDays,
  dateAtMinutes,
  fmtClock,
  isSameDay,
  minutesOfDay,
  snapMinutes,
} from '../lib/time';
import { appendLedger, markLedgerUndone } from '../hermes/ledgerStore';
import { usePendingAction, type PendingAction } from '../hermes/pending';
import { useEventActions, useEvents } from '../state/EventsContext';
import { weekdayName, type RecurrenceScope } from '../state/recurrence';
import {
  moveOccurrenceOnly,
  moveWholeTemplate,
  type RecurringOpResult,
} from '../state/recurringOps';
import { getTodos, toggleTodo } from '../state/todos';
import type { CalendarEvent, CategoryId } from '../state/types';
import { getDraggedTodo, TODO_DRAG_TYPE } from '../tasks/todoDrag';
import { CreatePopover } from './CreatePopover';
import { EventBlock } from './EventBlock';
import { EventPopover } from './EventPopover';
import { GhostBlock } from './GhostBlock';
import { NowLine } from './NowLine';
import { ScopeChooser } from './ScopeChooser';
import { HourLines, TimeAxis } from './TimeAxis';
import { layoutDayEvents } from './layout';
import { columnAnchorRect, gridPointAt, useGridDrag } from './useGridDrag';
import { popoverPosition, type AnchorRect } from './popoverPosition';
import { useToast } from '../ui';

interface TimeGridProps {
  /** The visible days: one for Day view, seven (Monday-start) for Week view. */
  days: Date[];
  pxPerMin?: number;
}

interface PendingCreate {
  dayIndex: number;
  startMin: number;
  endMin: number;
  anchor: AnchorRect;
  /** Prefill from a dropped to-do; confirming also completes the to-do. */
  title?: string;
  categoryId?: CategoryId;
  todoId?: string;
}

/** Default span for a to-do dropped on the grid: one hour. */
const TODO_DROP_MIN = 60;

interface SelectedEvent {
  event: CalendarEvent;
  anchor: AnchorRect;
}

/** A dropped move/resize of a recurring occurrence, awaiting its scope. */
interface ScopeAsk {
  kind: 'move' | 'resize';
  event: CalendarEvent;
  dayIndex: number;
  startMin: number;
  endMin: number;
  anchor: AnchorRect;
}

interface HermesGhost {
  startMin: number;
  endMin: number;
  categoryId: CategoryId;
  title: string;
}

/** The ghost a pending Hermes create/move projects onto `day`, if any. */
function hermesGhostForDay(pending: PendingAction | null, day: Date): HermesGhost | null {
  if (!pending || pending.kind === 'cancel' || pending.kind === 'recur') return null;
  if (!isSameDay(pending.day, day)) return null;
  return {
    startMin: pending.startMin,
    endMin: pending.endMin,
    categoryId: pending.kind === 'create' ? pending.categoryId : pending.event.categoryId,
    title: pending.kind === 'create' ? pending.title : pending.event.title,
  };
}

/** How a pending Hermes action marks an existing event, if at all. */
function hermesMarkFor(pending: PendingAction | null, eventId: string): 'cancel' | 'source' | null {
  if (!pending || pending.kind === 'create') return null;
  if (pending.event.id !== eventId) return null;
  return pending.kind === 'cancel' ? 'cancel' : 'source';
}

// Legibility floor for the fit-to-viewport day: never compress below this
// (~36px/hour). Past it the grid scrolls, auto-scrolled to the current hour —
// the way Google Calendar and other calendars handle a too-short window.
const MIN_PX_PER_MIN = 0.6;

export function TimeGrid({ days, pxPerMin: pxPerMinProp = 0.9 }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // On desktop, size the day to the available height so the whole span fits
  // with no vertical scroll; on mobile fall back to the fixed density + scroll.
  const [fitPxPerMin, setFitPxPerMin] = useState<number | null>(null);
  const pxPerMin = fitPxPerMin ?? pxPerMinProp;
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [selected, setSelected] = useState<SelectedEvent | null>(null);
  const [todoDrop, setTodoDrop] = useState<{ dayIndex: number; startMin: number } | null>(null);
  const [scopeAsk, setScopeAsk] = useState<ScopeAsk | null>(null);
  const hermesPending = usePendingAction();
  const { showToast } = useToast();

  const rangeStart = days[0];
  const rangeEnd = useMemo(() => addDays(days[days.length - 1], 1), [days]);
  const events = useEvents(rangeStart, rangeEnd);
  const { createEvent, updateEvent, deleteEvent } = useEventActions();

  const eventsById = useMemo(() => new Map(events.map((ev) => [ev.id, ev])), [events]);

  const eventsPerDay = useMemo(
    () =>
      days.map((day) =>
        layoutDayEvents(events.filter((ev) => isSameDay(new Date(ev.start), day)))
      ),
    [days, events]
  );

  const { drag, handlers } = useGridDrag({
    bodyRef,
    days,
    pxPerMin,
    eventsById,
    onCreate: (dayIndex, startMin, endMin, anchor) =>
      setPendingCreate({ dayIndex, startMin, endMin, anchor }),
    onMove: (event, dayIndex, startMin, endMin) => {
      if (event.recurring) {
        askScope('move', event, dayIndex, startMin, endMin);
        return;
      }
      void updateEvent(event.id, {
        start: dateAtMinutes(days[dayIndex], startMin).toISOString(),
        end: dateAtMinutes(days[dayIndex], endMin).toISOString(),
      });
    },
    onResize: (event, startMin, endMin) => {
      const day = new Date(event.start);
      if (event.recurring) {
        const dayIndex = Math.max(days.findIndex((d) => isSameDay(d, day)), 0);
        askScope('resize', event, dayIndex, startMin, endMin);
        return;
      }
      void updateEvent(event.id, {
        start: dateAtMinutes(day, startMin).toISOString(),
        end: dateAtMinutes(day, endMin).toISOString(),
      });
    },
    onEventClick: (event, anchor) => setSelected({ event, anchor }),
  });

  // Fit the day to the viewport on desktop: recompute px-per-minute from the
  // scroll container's height whenever the window or surrounding panels resize.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const header = headerRef.current;
    if (!scroller || !header) return;
    const desktop = window.matchMedia('(min-width: 721px)');
    const measure = () => {
      if (!desktop.matches) {
        setFitPxPerMin(null);
        return;
      }
      const avail = scroller.clientHeight - header.offsetHeight - 1;
      if (avail <= 60) {
        setFitPxPerMin(null);
        return;
      }
      // Fill the window when it legibly can; clamp at the floor otherwise so
      // the day stays readable and scrolls (see MIN_PX_PER_MIN) instead.
      setFitPxPerMin(Math.max(avail / TOTAL_MIN, MIN_PX_PER_MIN));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    desktop.addEventListener('change', measure);
    return () => {
      ro.disconnect();
      desktop.removeEventListener('change', measure);
    };
  }, []);

  // When the day overflows — on mobile, or a desktop window too short to fit
  // the whole span — scroll the current hour into view once. A no-op when the
  // day fits (scrollTop stays at 0). Runs after the density settles; the guard
  // then preserves the user's own scroll position.
  const didInitialScroll = useRef(false);
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || didInitialScroll.current) return;
    if (scroller.scrollHeight <= scroller.clientHeight + 1) return;
    const now = new Date();
    const showsToday = days.some((d) => isSameDay(d, now));
    const focusMin = showsToday
      ? Math.max(minutesOfDay(now) - 90, DAY_START_MIN)
      : 8 * 60;
    scroller.scrollTop = (focusMin - DAY_START_MIN) * pxPerMin;
    didInitialScroll.current = true;
  }, [pxPerMin, days]);

  /* ---- recurring occurrences: ask scope before committing a drop ---- */

  function askScope(
    kind: 'move' | 'resize',
    event: CalendarEvent,
    dayIndex: number,
    startMin: number,
    endMin: number
  ) {
    const body = bodyRef.current;
    setScopeAsk({
      kind,
      event,
      dayIndex,
      startMin,
      endMin,
      anchor: body
        ? columnAnchorRect(body, dayIndex, startMin, endMin, pxPerMin)
        : { left: 0, top: 0, width: 0, height: 0 },
    });
  }

  async function applyScopeAsk(scope: RecurrenceScope) {
    const ask = scopeAsk;
    if (!ask) return;
    setScopeAsk(null);
    const targetDay = days[ask.dayIndex];
    const dayName = weekdayName(new Date(ask.event.start).getDay());
    let result: RecurringOpResult | null;
    try {
      result =
        scope === 'template'
          ? await moveWholeTemplate(ask.event, targetDay, ask.startMin, ask.endMin)
          : await moveOccurrenceOnly(ask.event, targetDay, ask.startMin, ask.endMin, {
              createEvent,
              deleteEvent,
            });
    } catch {
      return; // Google rejected it — the store already rolled back and spoke up
    }
    if (!result) return;
    const verb = ask.kind === 'resize' ? 'Resized' : 'Moved';
    const targetLabel = targetDay.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const entry =
      scope === 'template'
        ? appendLedger(
            'move',
            `${verb} “${ask.event.title}” — now every ${weekdayName(targetDay.getDay())} at ${fmtClock(ask.startMin)}.`,
            result.undo
          )
        : appendLedger(
            'move',
            `${verb} “${ask.event.title}” for ${targetLabel} only — other weeks keep their place.`,
            result.undo
          );
    showToast({
      message:
        scope === 'template'
          ? `${verb} “${ask.event.title}” — every week.`
          : `${verb} “${ask.event.title}” — just this ${dayName}.`,
      actionLabel: 'Undo',
      onAction: () => {
        void result.revert();
        markLedgerUndone(entry.id);
      },
    });
  }

  async function savePendingCreate(title: string, categoryId: CategoryId) {
    if (!pendingCreate) return;
    const day = days[pendingCreate.dayIndex];
    await createEvent({
      title,
      categoryId,
      start: dateAtMinutes(day, pendingCreate.startMin).toISOString(),
      end: dateAtMinutes(day, pendingCreate.endMin).toISOString(),
    });
    // A confirmed to-do drop also completes the to-do.
    if (pendingCreate.todoId) {
      const todo = getTodos().find((t) => t.id === pendingCreate.todoId);
      if (todo && !todo.done) toggleTodo(todo.id);
      appendLedger(
        'todo',
        `Scheduled “${title}” from your tasks — ${day.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })} — and marked it done.`
      );
    }
    setPendingCreate(null);
  }

  /* ---- to-dos dragged in from the Tasks panel ---- */

  function todoDropPoint(e: React.DragEvent): { dayIndex: number; startMin: number } | null {
    const body = bodyRef.current;
    if (!body) return null;
    const point = gridPointAt(body, e.clientX, e.clientY, pxPerMin);
    if (!point) return null;
    const startMin = Math.min(snapMinutes(point.minute), DAY_END_MIN - TODO_DROP_MIN);
    return { dayIndex: point.dayIndex, startMin };
  }

  function onTodoDragOver(e: React.DragEvent<HTMLDivElement>) {
    if (!e.dataTransfer.types.includes(TODO_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setTodoDrop(todoDropPoint(e));
  }

  function onTodoDragLeave(e: React.DragEvent<HTMLDivElement>) {
    if (!bodyRef.current?.contains(e.relatedTarget as Node | null)) setTodoDrop(null);
  }

  function onTodoDrop(e: React.DragEvent<HTMLDivElement>) {
    setTodoDrop(null);
    if (!e.dataTransfer.types.includes(TODO_DRAG_TYPE)) return;
    e.preventDefault();
    let todo: { id: string; text: string } | null = getDraggedTodo();
    if (!todo) {
      try {
        todo = JSON.parse(e.dataTransfer.getData(TODO_DRAG_TYPE)) as { id: string; text: string };
      } catch {
        return;
      }
    }
    const point = todoDropPoint(e);
    const body = bodyRef.current;
    if (!todo || !point || !body) return;
    const endMin = point.startMin + TODO_DROP_MIN;
    setPendingCreate({
      dayIndex: point.dayIndex,
      startMin: point.startMin,
      endMin,
      anchor: columnAnchorRect(body, point.dayIndex, point.startMin, endMin, pxPerMin),
      title: todo.text,
      categoryId: 'upenn',
      todoId: todo.id,
    });
  }

  const gridTemplateColumns = `var(--axis-width) repeat(${days.length}, minmax(0, 1fr))`;
  const weekClass = days.length > 1 ? ' week' : '';
  const today = new Date();
  const dragSourceId =
    drag?.kind === 'move' ? drag.event.id : scopeAsk ? scopeAsk.event.id : null;

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div ref={headerRef} className={`grid-header${weekClass}`} style={{ gridTemplateColumns }}>
        <div className="head-cell axis-spacer" />
        {days.map((day) => (
          <div
            key={day.toDateString()}
            className={`head-cell${isSameDay(day, today) ? ' today' : ''}`}
          >
            <div className="day-name">
              {day.toLocaleDateString(undefined, { weekday: 'short' })}
            </div>
            <div className="day-num">{day.getDate()}</div>
          </div>
        ))}
      </div>
      <div
        ref={bodyRef}
        className={`grid-body${weekClass}${drag ? ' dragging' : ''}`}
        style={{ gridTemplateColumns, height: TOTAL_MIN * pxPerMin }}
        {...handlers}
        onDragOver={onTodoDragOver}
        onDragLeave={onTodoDragLeave}
        onDrop={onTodoDrop}
      >
        <TimeAxis pxPerMin={pxPerMin} />
        {days.map((day, dayIndex) => {
          const isToday = isSameDay(day, today);
          const showDragGhost = drag !== null && drag.dayIndex === dayIndex;
          const showPendingGhost = pendingCreate !== null && pendingCreate.dayIndex === dayIndex;
          const hermesGhost = hermesGhostForDay(hermesPending, day);
          return (
            <div
              key={day.toDateString()}
              className={`day-col${isToday ? ' today' : ''}`}
              data-day-index={dayIndex}
            >
              <HourLines pxPerMin={pxPerMin} />
              {eventsPerDay[dayIndex].map((positioned) => (
                <EventBlock
                  key={positioned.event.id}
                  positioned={positioned}
                  pxPerMin={pxPerMin}
                  isDragSource={positioned.event.id === dragSourceId}
                  hermesMark={hermesMarkFor(hermesPending, positioned.event.id)}
                />
              ))}
              {hermesGhost && (
                <GhostBlock
                  startMin={hermesGhost.startMin}
                  endMin={hermesGhost.endMin}
                  pxPerMin={pxPerMin}
                  categoryId={hermesGhost.categoryId}
                  title={hermesGhost.title}
                  pulse
                />
              )}
              {showDragGhost && (
                <GhostBlock
                  startMin={drag.startMin}
                  endMin={drag.endMin}
                  pxPerMin={pxPerMin}
                  categoryId={drag.kind === 'create' ? 'work' : drag.event.categoryId}
                  title={drag.kind === 'create' ? undefined : drag.event.title}
                />
              )}
              {showPendingGhost && (
                <GhostBlock
                  startMin={pendingCreate.startMin}
                  endMin={pendingCreate.endMin}
                  pxPerMin={pxPerMin}
                  categoryId={pendingCreate.categoryId ?? 'work'}
                  title={pendingCreate.title}
                />
              )}
              {scopeAsk !== null && scopeAsk.dayIndex === dayIndex && (
                <GhostBlock
                  startMin={scopeAsk.startMin}
                  endMin={scopeAsk.endMin}
                  pxPerMin={pxPerMin}
                  categoryId={scopeAsk.event.categoryId}
                  title={scopeAsk.event.title}
                  pulse
                />
              )}
              {todoDrop !== null && todoDrop.dayIndex === dayIndex && (
                <GhostBlock
                  startMin={todoDrop.startMin}
                  endMin={todoDrop.startMin + TODO_DROP_MIN}
                  pxPerMin={pxPerMin}
                  categoryId="upenn"
                  title={getDraggedTodo()?.text}
                  pulse
                />
              )}
              {isToday && <NowLine pxPerMin={pxPerMin} />}
            </div>
          );
        })}
      </div>
      {pendingCreate && (
        <CreatePopover
          anchor={pendingCreate.anchor}
          day={days[pendingCreate.dayIndex]}
          startMin={pendingCreate.startMin}
          endMin={pendingCreate.endMin}
          initialTitle={pendingCreate.title}
          initialCategoryId={pendingCreate.categoryId}
          onSave={(title, categoryId) => void savePendingCreate(title, categoryId)}
          onCancel={() => setPendingCreate(null)}
        />
      )}
      {selected && (
        <EventPopover
          event={selected.event}
          anchor={selected.anchor}
          onClose={() => setSelected(null)}
        />
      )}
      {scopeAsk && (
        <>
          <div className="popover-backdrop" onClick={() => setScopeAsk(null)} />
          <div
            className="popover"
            style={popoverPosition(scopeAsk.anchor)}
            role="dialog"
            aria-label="Repeating event"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setScopeAsk(null);
              }
            }}
          >
            <div className="meander popover-meander" />
            <ScopeChooser
              title={
                scopeAsk.kind === 'resize'
                  ? 'Resize this repeating event?'
                  : 'Move this repeating event?'
              }
              dayName={weekdayName(new Date(scopeAsk.event.start).getDay())}
              onChoose={(scope) => void applyScopeAsk(scope)}
              onCancel={() => setScopeAsk(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}
