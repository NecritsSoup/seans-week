import { useCallback, useState } from 'react';
import { HermesLayer } from '../hermes/HermesLayer';
import { addDays, addMonths, startOfDay } from '../lib/time';
import { EventsProvider } from '../state/EventsContext';
import { Stage, type ViewMode } from '../stage/Stage';
import { ToastProvider } from '../ui';
import { HermesFab } from './HermesFab';
import { TopBar } from './TopBar';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function initialView(): ViewMode {
  return window.matchMedia('(max-width: 720px)').matches ? 'day' : 'week';
}

export function App() {
  const [view, setView] = useState<ViewMode>(initialView);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));

  const navigate = useCallback(
    (delta: number) => {
      setAnchor((current) => {
        if (view === 'day') return addDays(current, delta);
        if (view === 'week') return addDays(current, 7 * delta);
        return addMonths(current, delta);
      });
    },
    [view]
  );

  const goPrev = useCallback(() => navigate(-1), [navigate]);
  const goNext = useCallback(() => navigate(1), [navigate]);
  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), []);
  const zoomToDay = useCallback((day: Date) => {
    setAnchor(startOfDay(day));
    setView('day');
  }, []);

  useKeyboardShortcuts({ onToday: goToday, onPrev: goPrev, onNext: goNext, onView: setView });

  /** Hermes moves the stage: to a day, a view, or both. */
  const hermesNavigate = useCallback((day: Date | null, nextView: ViewMode | null) => {
    if (day) setAnchor(startOfDay(day));
    if (nextView) setView(nextView);
  }, []);

  return (
    <EventsProvider>
      <ToastProvider>
        <div className="agora">
          <TopBar
            view={view}
            anchor={anchor}
            onPrev={goPrev}
            onNext={goNext}
            onToday={goToday}
            onViewChange={setView}
          />
          <Stage view={view} anchor={anchor} onZoomToDay={zoomToDay} />
          <HermesFab />
          <HermesLayer onNavigate={hermesNavigate} />
        </div>
      </ToastProvider>
    </EventsProvider>
  );
}
