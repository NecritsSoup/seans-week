import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DAY_START_MIN,
  TOTAL_MIN,
  addDays,
  dateAtMinutes,
  isSameDay,
  minutesOfDay,
} from '../lib/time';
import { useEventActions, useEvents } from '../state/EventsContext';
import type { CalendarEvent, CategoryId } from '../state/types';
import { CreatePopover } from './CreatePopover';
import { EventBlock } from './EventBlock';
import { EventPopover } from './EventPopover';
import { GhostBlock } from './GhostBlock';
import { NowLine } from './NowLine';
import { HourLines, TimeAxis } from './TimeAxis';
import { layoutDayEvents } from './layout';
import { useGridDrag } from './useGridDrag';
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
}

interface SelectedEvent {
  event: CalendarEvent;
  anchor: AnchorRect;
}

export function TimeGrid({ days, pxPerMin = 0.9 }: TimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [pendingCreate, setPendingCreate] = useState<PendingCreate | null>(null);
  const [selected, setSelected] = useState<SelectedEvent | null>(null);

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
    setPendingCreate(null);
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
      >
        <TimeAxis pxPerMin={pxPerMin} />
        {days.map((day, dayIndex) => {
          const isToday = isSameDay(day, today);
          const showDragGhost = drag !== null && drag.dayIndex === dayIndex;
          const showPendingGhost = pendingCreate !== null && pendingCreate.dayIndex === dayIndex;
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
                />
              ))}
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
                  categoryId="work"
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
