import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DAY_END_MIN,
  DAY_START_MIN,
  TOTAL_MIN,
  addDays,
  dateAtMinutes,
  isSameDay,
  minutesOfDay,
  snapMinutes,
} from '../lib/time';
import { appendLedger } from '../hermes/ledgerStore';
import { usePendingAction, type PendingAction } from '../hermes/pending';
import { useEventActions, useEvents } from '../state/EventsContext';
import { getTodos, toggleTodo } from '../state/todos';
import type { CalendarEvent, CategoryId } from '../state/types';
import { getDraggedTodo, TODO_DRAG_TYPE } from '../tasks/todoDrag';
import { CreatePopover } from './CreatePopover';
import { EventBlock } from './EventBlock';
import { EventPopover } from './EventPopover';
import { GhostBlock } from './GhostBlock';
import { NowLine } from './NowLine';
import { HourLines, TimeAxis } from './TimeAxis';
import { layoutDayEvents } from './layout';
import { columnAnchorRect, gridPointAt, useGridDrag } from './useGridDrag';
import type { AnchorRect } from './popoverPosition';

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

interface HermesGhost {
  startMin: number;
  endMin: number;
  categoryId: CategoryId;
  title: string;
}

/** The ghost a pending Hermes create/move projects onto `day`, if any. */
function hermesGhostForDay(pending: PendingAction | null, day: Date): HermesGhost | null {
  if (!pending || pending.kind === 'cancel' || !isSameDay(pending.day, day)) return null;
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

export function TimeGrid({ days, pxPerMin = 0.9 }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [selected, setSelected] = useState<SelectedEvent | null>(null);
  const [todoDrop, setTodoDrop] = useState<{ dayIndex: number; startMin: number } | null>(null);
  const hermesPending = usePendingAction();

  const rangeStart = days[0];
  const rangeEnd = useMemo(() => addDays(days[days.length - 1], 1), [days]);
  const events = useEvents(rangeStart, rangeEnd);
  const { createEvent, updateEvent } = useEventActions();

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
      void updateEvent(event.id, {
        start: dateAtMinutes(days[dayIndex], startMin).toISOString(),
        end: dateAtMinutes(days[dayIndex], endMin).toISOString(),
      });
    },
    onResize: (event, startMin, endMin) => {
      const day = new Date(event.start);
      void updateEvent(event.id, {
        start: dateAtMinutes(day, startMin).toISOString(),
        end: dateAtMinutes(day, endMin).toISOString(),
      });
    },
    onEventClick: (event, anchor) => setSelected({ event, anchor }),
  });

  // Initial scroll: bring the morning (or the current hour on today) into view.
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const now = new Date();
    const showsToday = days.some((d) => isSameDay(d, now));
    const focusMin = showsToday
      ? Math.max(minutesOfDay(now) - 90, DAY_START_MIN)
      : 8 * 60;
    scroller.scrollTop = (focusMin - DAY_START_MIN) * pxPerMin;
    // Mount-only by design: keep the user's scroll position afterwards.
  }, []);

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
  const dragSourceId = drag?.kind === 'move' ? drag.event.id : null;

  return (
    <div className="grid-scroll" ref={scrollRef}>
      <div className={`grid-header${weekClass}`} style={{ gridTemplateColumns }}>
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
    </div>
  );
}
