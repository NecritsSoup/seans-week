import { useCallback, useState } from 'react';
import { HermesLayer } from '../hermes/HermesLayer';
import { addDays, addMonths, startOfDay } from '../lib/time';
import { ScrollsPanel } from '../scrolls/ScrollsPanel';
import { SettingsPanel } from '../settings/SettingsPanel';
import { EventsProvider } from '../state/EventsContext';
import { Stage, type ViewMode } from '../stage/Stage';
import { TasksPanel } from '../tasks/TasksPanel';
import { ToastProvider } from '../ui';
import { HermesFab } from './HermesFab';
import { TopBar } from './TopBar';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

function initialView(): ViewMode {
  return window.matchMedia('(max-width: 720px)').matches ? 'day' : 'week';
}

/** The summonable side surfaces — at most one open at a time. */
type Surface = 'scrolls' | 'tasks' | 'settings';

export function App() {
  const [view, setView] = useState<ViewMode>(initialView);
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()));
  const [surface, setSurface] = useState<Surface | null>(null);

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

  const toggleSurface = useCallback((next: Surface) => {
    setSurface((current) => (current === next ? null : next));
  }, []);
  const closeSurface = useCallback(() => setSurface(null), []);
  const openScrolls = useCallback(() => toggleSurface('scrolls'), [toggleSurface]);
  const openTasks = useCallback(() => toggleSurface('tasks'), [toggleSurface]);
  const openSettings = useCallback(() => toggleSurface('settings'), [toggleSurface]);

  useKeyboardShortcuts({
    onToday: goToday,
    onPrev: goPrev,
    onNext: goNext,
    onView: setView,
    onScrolls: openScrolls,
    onTasks: openTasks,
  });

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
            onOpenSettings={openSettings}
          />
          <Stage view={view} anchor={anchor} onZoomToDay={zoomToDay} />
          <HermesFab />
          <HermesLayer onNavigate={hermesNavigate} />
          <ScrollsPanel open={surface === 'scrolls'} onClose={closeSurface} />
          <TasksPanel open={surface === 'tasks'} onClose={closeSurface} />
          <SettingsPanel open={surface === 'settings'} onClose={closeSurface} />
        </div>
      </ToastProvider>
    </EventsProvider>
  );
}
