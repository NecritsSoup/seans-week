import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { CompositeEventStore } from '../google/compositeStore';
import { getGoogleCalendarStore } from '../google/googleStore';
import { LocalEventStore } from './localStore';
import { resetDemoData, seedIfNeeded } from './seed';
import type { CalendarEvent, EventInput, EventPatch, EventStore } from './types';

interface EventsContextValue {
  store: EventStore;
  /** Bumped after every mutation; range hooks re-query on change. */
  version: number;
  /** Settings → reset demo data: clear local events, reseed the demo week. */
  resetDemo: () => Promise<void>;
}

const EventsContext = createContext<EventsContextValue | null>(null);

export function EventsProvider({ children }: { children: ReactNode }) {
  // Local truth always; Google truth merged in when signed in. The Google
  // store is the shared instance the recurrence ops modules also reach.
  const stores = useMemo(() => {
    const local = new LocalEventStore();
    const google = getGoogleCalendarStore();
    return { local, google, composite: new CompositeEventStore(local, google) };
  }, []);
  const store = stores.composite;
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void seedIfNeeded(stores.local).then(() => {
      if (!cancelled) setVersion((v) => v + 1);
    });
    const unsubscribe = store.subscribe(() => setVersion((v) => v + 1));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [store, stores.local]);

  // Background Google sync: polls while visible and signed in, refreshes on
  // focus and after writes. Detaches cleanly with the provider.
  useEffect(() => {
    stores.google.startSync();
    return () => stores.google.stopSync();
  }, [stores.google]);

  const resetDemo = useCallback(() => resetDemoData(stores.local), [stores.local]);

  const value = useMemo(() => ({ store, version, resetDemo }), [store, version, resetDemo]);
  return <EventsContext.Provider value={value}>{children}</EventsContext.Provider>;
}

function useEventsContext(): EventsContextValue {
  const ctx = useContext(EventsContext);
  if (!ctx) throw new Error('useEvents must be used inside <EventsProvider>');
  return ctx;
}

/** Events overlapping [rangeStart, rangeEnd), kept fresh across mutations. */
export function useEvents(rangeStart: Date, rangeEnd: Date): CalendarEvent[] {
  const { store, version } = useEventsContext();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const fromMs = rangeStart.getTime();
  const toMs = rangeEnd.getTime();

  useEffect(() => {
    let cancelled = false;
    void store
      .list(new Date(fromMs).toISOString(), new Date(toMs).toISOString())
      .then((list) => {
        if (!cancelled) setEvents(list);
      });
    return () => {
      cancelled = true;
    };
  }, [store, version, fromMs, toMs]);

  return events;
}

export interface EventActions {
  createEvent: (input: EventInput) => Promise<CalendarEvent>;
  updateEvent: (id: string, patch: EventPatch) => Promise<CalendarEvent>;
  deleteEvent: (id: string) => Promise<void>;
}

/** The reset-demo-data action for the Settings panel. */
export function useResetDemoData(): () => Promise<void> {
  return useEventsContext().resetDemo;
}

export function useEventActions(): EventActions {
  const { store } = useEventsContext();
  const createEvent = useCallback((input: EventInput) => store.create(input), [store]);
  const updateEvent = useCallback(
    (id: string, patch: EventPatch) => store.update(id, patch),
    [store]
  );
  const deleteEvent = useCallback((id: string) => store.remove(id), [store]);
  return useMemo(
    () => ({ createEvent, updateEvent, deleteEvent }),
    [createEvent, updateEvent, deleteEvent]
  );
}
