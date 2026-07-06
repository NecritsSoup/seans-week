import { useMemo } from 'react';
import {
  DOW_SHORT,
  addDays,
  addMonths,
  isSameDay,
  startOfMonth,
  startOfWeek,
} from '../lib/time';
import { CATEGORIES } from '../state/categories';
import { useEvents } from '../state/EventsContext';
import type { CategoryId } from '../state/types';

interface MonthViewProps {
  anchor: Date;
  onSelectDay: (day: Date) => void;
}

/** Mosaic of mini-day cells with per-category density chips. */
export function MonthView({ anchor, onSelectDay }: MonthViewProps) {
  const monthStart = useMemo(() => startOfMonth(anchor), [anchor]);
  const nextMonth = useMemo(() => addMonths(monthStart, 1), [monthStart]);
  const gridStart = useMemo(() => startOfWeek(monthStart), [monthStart]);

  const cells = useMemo(() => {
    const out: Date[] = [];
    let day = gridStart;
    while (day.getTime() < nextMonth.getTime() || out.length % 7 !== 0) {
      out.push(day);
      day = addDays(day, 1);
    }
    return out;
  }, [gridStart, nextMonth]);

  const gridEnd = useMemo(() => addDays(cells[cells.length - 1], 1), [cells]);
  const events = useEvents(gridStart, gridEnd);

  const countsByDay = useMemo(() => {
    const map = new Map<string, Map<CategoryId, number>>();
    for (const ev of events) {
      const key = new Date(ev.start).toDateString();
      const counts = map.get(key) ?? new Map<CategoryId, number>();
      counts.set(ev.categoryId, (counts.get(ev.categoryId) ?? 0) + 1);
      map.set(key, counts);
    }
    return map;
  }, [events]);

  const today = new Date();
  const weeks = cells.length / 7;

  return (
    <div className="month-grid" style={{ gridTemplateRows: `auto repeat(${weeks}, 1fr)` }}>
      {DOW_SHORT.map((dow) => (
        <div key={dow} className="month-dow">
          {dow}
        </div>
      ))}
      {cells.map((day) => {
        const counts = countsByDay.get(day.toDateString());
        const outside = day.getMonth() !== monthStart.getMonth();
        const isToday = isSameDay(day, today);
        return (
          <button
            key={day.toDateString()}
            className={`month-cell${outside ? ' outside' : ''}${isToday ? ' today' : ''}`}
            onClick={() => onSelectDay(day)}
            aria-label={day.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          >
            <span className="cell-num">{day.getDate()}</span>
            {counts && (
              <span className="density-chips">
                {CATEGORIES.filter((c) => counts.has(c.id)).map((c) => (
                  <span
                    key={c.id}
                    className={`density-chip ${c.colorToken}`}
                    style={{ width: 8 + Math.min(counts.get(c.id) ?? 0, 5) * 6 }}
                    title={c.label}
                  />
                ))}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
