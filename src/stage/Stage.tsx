import { useMemo } from 'react';
import { addDays, startOfDay, startOfWeek } from '../lib/time';
import { MonthView } from './MonthView';
import { TimeGrid } from './TimeGrid';

export type ViewMode = 'day' | 'week' | 'month';

interface StageProps {
  view: ViewMode;
  anchor: Date;
  onZoomToDay: (day: Date) => void;
}

/** The Stage: the calendar itself, filling all space under the topbar. */
export function Stage({ view, anchor, onZoomToDay }: StageProps) {
  const days = useMemo(() => {
    if (view === 'day') return [startOfDay(anchor)];
    const monday = startOfWeek(anchor);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [view, anchor]);

  return (
    <main className="stage">
      <div className="stage-view" key={view}>
        {view === 'month' ? (
          <MonthView anchor={anchor} onSelectDay={onZoomToDay} />
        ) : (
          <TimeGrid days={days} pxPerMin={view === 'day' ? 1.1 : 0.9} />
        )}
      </div>
    </main>
  );
}
